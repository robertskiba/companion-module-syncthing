import type { SyncthingApi } from './api.js'
import type { LogLevel } from '@companion-module/base'

/** One entry from GET /rest/events. */
export interface SyncthingEvent {
	id: number
	globalID: number
	time: string
	type: string
	data: Record<string, unknown>
}

/**
 * The event types this module subscribes to.
 *
 * Subscribing explicitly keeps the stream quiet: the noisy per-file events are left out, and
 * LocalChangeDetected and RemoteChangeDetected are excluded by Syncthing unless asked for.
 */
export const SUBSCRIBED_EVENTS = [
	'StateChanged',
	'FolderSummary',
	'FolderCompletion',
	'FolderPaused',
	'FolderResumed',
	'FolderErrors',
	'DeviceConnected',
	'DeviceDisconnected',
	'DevicePaused',
	'DeviceResumed',
	'ConfigSaved',
	'Starting',
	'StartupComplete',
] as const

/** Seconds the server holds the request open when nothing happens. */
const LONG_POLL_SECONDS = 55
/** The client waits longer than the server, so a quiet stream is never mistaken for a failure. */
const REQUEST_TIMEOUT_MS = (LONG_POLL_SECONDS + 15) * 1000
/** How long to wait before reconnecting after the stream broke. */
const RECONNECT_DELAY_MS = 5000

export interface EventStreamOptions {
	api: SyncthingApi
	/** Called with each batch of events, in the order Syncthing produced them. */
	onEvents: (events: SyncthingEvent[]) => Promise<void> | void
	/** Called when the instance restarted, so the caller can re-read everything. */
	onRestart: () => Promise<void> | void
	/** Called when the stream connects or drops, for status reporting. */
	onConnectionChange: (connected: boolean) => void
	log: (level: LogLevel, message: string) => void
}

/**
 * Follows the Syncthing event stream with long polling.
 *
 * Each request blocks on the server until something happens or the timeout expires, so an idle
 * instance costs one open connection rather than repeated requests, and a change is reported
 * within milliseconds instead of at the next poll.
 */
export class EventStream {
	#options: EventStreamOptions
	#abort: AbortController | undefined
	#running = false
	#connected = false
	/** The id of the last event handled, which the next request continues from. */
	#since = 0
	#reconnectTimer: NodeJS.Timeout | undefined
	/** Resolves the reconnect wait early, so stopping does not leave a promise hanging. */
	#reconnectResolve: (() => void) | undefined
	/** Set once a failure has been logged, so a long outage does not fill the log. */
	#failureLogged = false

	constructor(options: EventStreamOptions) {
		this.#options = options
	}

	get connected(): boolean {
		return this.#connected
	}

	start(): void {
		if (this.#running) return
		this.#running = true
		this.#since = 0
		this.#failureLogged = false
		void this.#run()
	}

	stop(): void {
		this.#running = false
		this.#setConnected(false)

		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer)
			this.#reconnectTimer = undefined
		}
		this.#reconnectResolve?.()
		this.#reconnectResolve = undefined

		this.#abort?.abort()
		this.#abort = undefined
	}

	#setConnected(connected: boolean): void {
		if (this.#connected === connected) return
		this.#connected = connected
		this.#options.onConnectionChange(connected)
	}

	async #run(): Promise<void> {
		while (this.#running) {
			try {
				if (this.#since === 0) {
					this.#since = await this.#seed()
				}

				const events = await this.#fetch(this.#since)
				if (!this.#running) return

				this.#setConnected(true)
				this.#failureLogged = false

				if (events.length > 0) await this.#handle(events)
			} catch (error) {
				if (!this.#running) return

				this.#setConnected(false)
				if (!this.#failureLogged) {
					this.#failureLogged = true
					this.#options.log('warn', `Event stream interrupted: ${describe(error)}. Retrying.`)
				}

				await this.#wait(RECONNECT_DELAY_MS)
				// A failure may mean the instance went away, so start from a fresh position.
				this.#since = 0
			}
		}
	}

	/**
	 * Finds the newest event id without replaying the buffer.
	 * Asking for a single event with no type filter gives the latest id Syncthing has issued.
	 */
	async #seed(): Promise<number> {
		const latest = await this.#options.api.get<SyncthingEvent[]>(
			'/rest/events',
			{ since: 0, limit: 1, timeout: 1 },
			{ timeout: REQUEST_TIMEOUT_MS, signal: this.#newSignal() },
		)
		return latest.at(-1)?.id ?? 0
	}

	async #fetch(since: number): Promise<SyncthingEvent[]> {
		const events = await this.#options.api.get<SyncthingEvent[]>(
			'/rest/events',
			{
				since,
				timeout: LONG_POLL_SECONDS,
				events: SUBSCRIBED_EVENTS.join(','),
			},
			{ timeout: REQUEST_TIMEOUT_MS, signal: this.#newSignal() },
		)
		return Array.isArray(events) ? events : []
	}

	async #handle(events: SyncthingEvent[]): Promise<void> {
		const first = events[0]

		// Event ids restart from one when Syncthing restarts. Seeing an id we have already passed
		// means this is a different run of the process, so everything has to be read again.
		if (first && first.id <= this.#since) {
			this.#options.log('info', 'Syncthing restarted, reading the whole state again')
			this.#since = 0
			await this.#options.onRestart()
			return
		}

		const lastId = events.at(-1)?.id
		if (lastId !== undefined) this.#since = lastId

		if (events.some((event) => event.type === 'Starting' || event.type === 'StartupComplete')) {
			this.#options.log('info', 'Syncthing started, reading the whole state again')
			await this.#options.onRestart()
			return
		}

		await this.#options.onEvents(events)
	}

	#newSignal(): AbortSignal {
		this.#abort?.abort()
		this.#abort = new AbortController()
		return this.#abort.signal
	}

	async #wait(ms: number): Promise<void> {
		await new Promise<void>((resolve) => {
			this.#reconnectResolve = resolve
			this.#reconnectTimer = setTimeout(() => {
				this.#reconnectTimer = undefined
				this.#reconnectResolve = undefined
				resolve()
			}, ms)
		})
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** Reads a string field from event data, or undefined when it is missing or of the wrong type. */
export function eventString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = data[key]
		if (typeof value === 'string' && value.length > 0) return value
	}
	return undefined
}

/** Reads a numeric field from event data, or undefined when it is missing or of the wrong type. */
export function eventNumber(data: Record<string, unknown>, key: string): number | undefined {
	const value = data[key]
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
