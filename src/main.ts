import {
	InstanceBase,
	InstanceStatus,
	type CompanionVariableValues,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { DEFAULT_CONFIG, GetConfigFields, guiUrlFor, type ModuleConfig, type ModuleSecrets } from './config.js'
import {
	deviceVariableValues,
	folderVariableValues,
	formatUptime,
	UpdateVariableDefinitions,
	type VariablesSchema,
} from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { clusterInSync, localInSync, UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { SyncthingApi, SyncthingApiError } from './api.js'
import { discoverApiKey } from './discover.js'
import { EventStream, eventNumber, eventString, type SyncthingEvent } from './events.js'
import { createHttpProbe, createNameResolver, LanScanner, localIpv4Addresses, type LanHost } from './lanscan.js'
import {
	assignPrefixPairs,
	createEmptyState,
	findDevice,
	findFolder,
	folderCompletion,
	FOLDER_STATES,
	type DeviceInfo,
	type FolderInfo,
	type FolderState,
	type ModuleState,
} from './state.js'
import type {
	ConfigDevice,
	ConfigFolder,
	DbCompletion,
	DbStatus,
	RestartRequired,
	SystemConnections,
	SystemErrors,
	SystemStatus,
	SystemVersion,
} from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

const REQUEST_TIMEOUT_MS = 10_000
/** Slowest the detail poll runs while the event stream is delivering changes. */
const EVENT_FALLBACK_SECONDS = 120
/** The Syncthing web interface port, used for probing before one has been configured. */
const DEFAULT_PORT = 8384

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config: ModuleConfig = { ...DEFAULT_CONFIG }
	secrets: ModuleSecrets = { apiKey: '' }

	state: ModuleState = createEmptyState()

	#api: SyncthingApi | undefined
	#pollTimer: NodeJS.Timeout | undefined
	#pollInFlight = false
	/** Timestamp of the last successful detail poll, so details can run slower than the base poll. */
	#lastDetailPoll = 0
	/** Identifies the current folder and device list, to notice when definitions must be rebuilt. */
	#listFingerprint = ''
	/** Guards against two API key lookups running at once. */
	#discoveryRunning = false
	/** The last successful poll, so events can republish without another round of requests. */
	#lastPoll:
		{ version: SystemVersion; status: SystemStatus; connections: SystemConnections; errors: SystemErrors } | undefined
	#eventStream: EventStream | undefined
	/** Devices whose completion needs re-reading after a FolderCompletion event. */
	#devicesToRefresh = new Set<string>()
	#refreshTimer: NodeJS.Timeout | undefined
	#scanner: LanScanner | undefined
	/** The settings the found hosts were confirmed against, so a change can invalidate them. */
	#probeSettings = ''
	/** Syncthing instances found on the network whose web interface answered. */
	lanHosts: LanHost[] = []
	/** Remembers the last reported problem so the log is not flooded while an instance is down. */
	#lastFailureMessage: string | undefined

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets ?? { apiKey: '' }

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()

		this.#applyLanScan()
		this.#applyConfig()
	}

	async destroy(): Promise<void> {
		this.#scanner?.stop()
		this.#scanner = undefined
		this.#stopPolling()
		this.#api = undefined
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets ?? { apiKey: '' }
		this.#applyLanScan()
		this.#applyConfig()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields(this.config, this.lanHosts)
	}

	/**
	 * Listens for Syncthing announcements.
	 *
	 * This runs independently of the connection, so instances can be found before anything has
	 * been configured, which is the point of it. It only listens, so there is nothing to switch
	 * off: a machine with no Syncthing on the network simply never hears anything.
	 */
	#applyLanScan(): void {
		const settings = `${this.config.port || DEFAULT_PORT}|${this.config.ignoreCertErrors}`

		if (this.#scanner) {
			if (settings !== this.#probeSettings) {
				// Every entry was confirmed against the old port, so none of them can be trusted.
				this.#probeSettings = settings
				this.log('debug', `Web interface port changed, checking the network again on ${settings.split('|')[0]}`)
				this.#scanner.reset()
			} else {
				this.#scanner.retryUnreachable()
			}
			return
		}

		this.#probeSettings = settings

		this.#scanner = new LanScanner({
			createSocket: () => this.createSharedUdpSocket('udp4'),
			// Read at call time, so changing the port applies without rebuilding the scanner.
			probe: async (address) =>
				createHttpProbe(this.config.port || DEFAULT_PORT, this.config.ignoreCertErrors)(address),
			resolveName: createNameResolver(),
			ownAddresses: localIpv4Addresses,
			onChange: (hosts) => {
				this.lanHosts = hosts
			},
			log: (level, message) => this.log(level, message),
		})
		this.#scanner.start()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	/**
	 * Runs a one-shot API call on behalf of an action, turning failures into a log entry
	 * and a connection status rather than an unhandled rejection.
	 */
	async runAction(name: string, fn: (api: SyncthingApi) => Promise<void>): Promise<void> {
		const api = this.#api
		if (!api) {
			this.log('warn', `${name}: not connected to Syncthing`)
			return
		}

		try {
			await fn(api)
			this.log('debug', `${name}: ok`)
		} catch (error) {
			this.#reportFailure(`${name} failed`, error)
		}
	}

	/** Rebuilds the API client from the current config and restarts polling. */
	#applyConfig(): void {
		this.#stopPolling()
		this.#api = undefined
		this.#lastFailureMessage = undefined
		this.#lastDetailPoll = 0
		// Set before the validity checks, so the address is published even when the config is wrong.
		this.state.guiUrl = guiUrlFor(this.config)

		if (!this.config.host) {
			// Nothing is contacted until a host has been chosen, not even the local machine.
			this.#setDisconnected()
			this.updateStatus(InstanceStatus.BadConfig, 'No host chosen yet')
			return
		}
		if (!this.secrets.apiKey) {
			this.#setDisconnected()
			if (this.config.autoApiKey) {
				this.updateStatus(InstanceStatus.Connecting, 'Looking for the API key')
				void this.#tryDiscoverApiKey()
			} else {
				this.updateStatus(InstanceStatus.BadConfig, 'No API key configured')
			}
			return
		}

		this.#api = new SyncthingApi({
			host: this.config.host,
			port: this.config.port,
			apiKey: this.secrets.apiKey,
			useHttps: this.config.useHttps,
			ignoreCertErrors: this.config.ignoreCertErrors,
			timeout: REQUEST_TIMEOUT_MS,
		})

		this.updateStatus(InstanceStatus.Connecting)
		this.#startPolling()
	}

	/**
	 * Tries to read the API key from an instance whose web interface has no login, and stores it
	 * as if it had been typed in. Only ever runs while the key field is empty.
	 */
	async #tryDiscoverApiKey(): Promise<void> {
		if (this.#discoveryRunning) return
		this.#discoveryRunning = true

		try {
			const key = await discoverApiKey({
				host: this.config.host,
				port: this.config.port,
				useHttps: this.config.useHttps,
				ignoreCertErrors: this.config.ignoreCertErrors,
				timeout: REQUEST_TIMEOUT_MS,
			})

			this.log('info', `Read the API key from ${this.state.guiUrl} and saved it in the connection`)
			this.secrets = { apiKey: key }
			// Saving triggers configUpdated, which starts the connection with the key in place.
			this.saveConfig(this.config, this.secrets)
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error)
			this.log(
				'warn',
				`Could not read the API key automatically: ${reason}. ` +
					'Enter it manually from the Syncthing web interface, under Actions, Settings, General.',
			)
			this.updateStatus(InstanceStatus.BadConfig, 'No API key configured')
		} finally {
			this.#discoveryRunning = false
		}
	}

	#startPolling(): void {
		const intervalMs = Math.max(1, this.config.pollInterval) * 1000
		this.#pollTimer = setInterval(() => {
			void this.poll()
		}, intervalMs)

		void this.poll()
	}

	#stopPolling(): void {
		this.#stopEventStream()
		if (this.#pollTimer) {
			clearInterval(this.#pollTimer)
			this.#pollTimer = undefined
		}
	}

	/**
	 * Reads the current state from Syncthing and publishes it as variables and feedbacks.
	 * Overlapping calls are skipped, so a slow instance cannot pile up requests.
	 *
	 * @param forceDetails Fetch folder and device details regardless of the detail interval.
	 */
	async poll(forceDetails = false): Promise<void> {
		const api = this.#api
		if (!api || this.#pollInFlight) return

		this.#pollInFlight = true
		try {
			const [version, status, connections, errors, configDevices, configFolders] = await Promise.all([
				api.get<SystemVersion>('/rest/system/version'),
				api.get<SystemStatus>('/rest/system/status'),
				api.get<SystemConnections>('/rest/system/connections'),
				api.get<SystemErrors>('/rest/system/error'),
				api.get<ConfigDevice[]>('/rest/config/devices'),
				api.get<ConfigFolder[]>('/rest/config/folders'),
			])

			if (!this.state.connected) {
				this.log('info', `Connected to Syncthing ${version.version} at ${api.baseUrl}`)
			}

			this.#rebuildLists(status.myID, configDevices, configFolders, connections)

			if (this.#shouldPollDetails(forceDetails)) {
				await this.#pollDetails(api)
				this.#lastDetailPoll = Date.now()
			}

			this.#lastPoll = { version, status, connections, errors }
			this.#publish()

			this.state.connected = true
			this.#lastFailureMessage = undefined
			this.updateStatus(InstanceStatus.Ok)
			this.checkAllFeedbacks()
			this.#startEventStream(api)
		} catch (error) {
			this.#reportFailure('Polling failed', error)
		} finally {
			this.#pollInFlight = false
		}
	}

	#startEventStream(api: SyncthingApi): void {
		// Always followed: it is strictly better than waiting for the next poll, and polling stays
		// underneath as a floor, so there is nothing a switch would protect against.
		if (this.#eventStream) return

		this.#eventStream = new EventStream({
			api,
			onEvents: async (events) => this.#handleEvents(events),
			onRestart: async () => {
				this.#lastDetailPoll = 0
				await this.poll(true)
			},
			onConnectionChange: (connected) => {
				this.log('debug', connected ? 'Event stream connected' : 'Event stream disconnected')
			},
			log: (level, message) => this.log(level, message),
		})
		this.#eventStream.start()
	}

	#stopEventStream(): void {
		this.#eventStream?.stop()
		this.#eventStream = undefined

		if (this.#refreshTimer) {
			clearTimeout(this.#refreshTimer)
			this.#refreshTimer = undefined
		}
		this.#devicesToRefresh.clear()
	}

	/**
	 * Applies a batch of events to the state and republishes.
	 *
	 * Folder events carry everything needed, so they are applied without any request. A device
	 * completion event only covers one folder, so the affected device is re-read once per burst
	 * instead of trying to add partial numbers together.
	 */
	async #handleEvents(events: SyncthingEvent[]): Promise<void> {
		let listsChanged = false

		for (const event of events) {
			const data = event.data ?? {}

			switch (event.type) {
				case 'StateChanged': {
					const folder = this.#folderFromEvent(data)
					const to = eventString(data, 'to')
					if (folder && to) folder.state = normaliseFolderState(to)
					break
				}

				case 'FolderSummary': {
					const folder = this.#folderFromEvent(data)
					const summary = data.summary
					if (folder && typeof summary === 'object' && summary !== null) {
						this.#applySummary(folder, summary as Record<string, unknown>)
					}
					break
				}

				case 'FolderCompletion': {
					const device = eventString(data, 'device')
					if (device) this.#scheduleDeviceRefresh(device)
					break
				}

				case 'FolderPaused':
				case 'FolderResumed': {
					const folder = this.#folderFromEvent(data)
					if (folder) {
						folder.paused = event.type === 'FolderPaused'
						if (folder.paused) folder.state = 'paused'
					}
					break
				}

				case 'FolderErrors': {
					const folder = this.#folderFromEvent(data)
					const errors = data.errors
					if (folder && Array.isArray(errors)) folder.pullErrors = errors.length
					break
				}

				case 'DeviceConnected': {
					const device = findDevice(this.state, eventString(data, 'id', 'device') ?? '')
					if (device) {
						device.connected = true
						device.address = eventString(data, 'addr') ?? device.address
						device.clientVersion = eventString(data, 'clientVersion') ?? device.clientVersion
					}
					break
				}

				case 'DeviceDisconnected': {
					const device = findDevice(this.state, eventString(data, 'id', 'device') ?? '')
					if (device) {
						device.connected = false
						device.address = ''
					}
					break
				}

				case 'DevicePaused':
				case 'DeviceResumed': {
					const device = findDevice(this.state, eventString(data, 'device', 'id') ?? '')
					if (device) {
						device.paused = event.type === 'DevicePaused'
						if (device.paused) device.connected = false
					}
					break
				}

				case 'ConfigSaved':
					// The folder and device lists may have changed, which needs a full re-read.
					listsChanged = true
					break

				default:
					break
			}
		}

		if (listsChanged) {
			this.#lastDetailPoll = 0
			await this.poll(true)
			return
		}

		this.#publish()
		this.checkAllFeedbacks()
	}

	/** Looks up the folder an event refers to, allowing for the differing key names. */
	#folderFromEvent(data: Record<string, unknown>) {
		const id = eventString(data, 'folder', 'id')
		return id ? findFolder(this.state, id) : undefined
	}

	/** Copies the parts of a folder summary this module tracks. */
	#applySummary(folder: FolderInfo, summary: Record<string, unknown>): void {
		const state = eventString(summary, 'state')
		if (state) folder.state = normaliseFolderState(state)

		folder.globalBytes = eventNumber(summary, 'globalBytes') ?? folder.globalBytes
		folder.localBytes = eventNumber(summary, 'localBytes') ?? folder.localBytes
		folder.inSyncBytes = eventNumber(summary, 'inSyncBytes') ?? folder.inSyncBytes
		folder.needBytes = eventNumber(summary, 'needBytes') ?? folder.needBytes
		folder.needItems = eventNumber(summary, 'needTotalItems') ?? folder.needItems
		folder.pullErrors = eventNumber(summary, 'pullErrors') ?? folder.pullErrors
		folder.receiveOnlyChangedFiles = eventNumber(summary, 'receiveOnlyChangedFiles') ?? folder.receiveOnlyChangedFiles
		folder.completion = folderCompletion(folder.globalBytes, folder.needBytes, folder.needItems)

		if (folder.paused) folder.state = 'paused'
	}

	/** Collects devices to re-read, then fetches them once the burst of events has settled. */
	#scheduleDeviceRefresh(deviceId: string): void {
		if (!findDevice(this.state, deviceId)) return
		this.#devicesToRefresh.add(deviceId)

		if (this.#refreshTimer) return
		this.#refreshTimer = setTimeout(() => {
			this.#refreshTimer = undefined
			void this.#refreshDevices()
		}, 500)
	}

	async #refreshDevices(): Promise<void> {
		const api = this.#api
		const ids = [...this.#devicesToRefresh]
		this.#devicesToRefresh.clear()
		if (!api || ids.length === 0) return

		await Promise.all(
			ids.map(async (id) => {
				const device = findDevice(this.state, id)
				if (!device || device.paused) return
				try {
					const completion = await api.get<DbCompletion>('/rest/db/completion', { device: id })
					device.completion = Math.round(completion.completion * 10) / 10
					device.needBytes = completion.needBytes
					device.needItems = completion.needItems
				} catch (error) {
					this.log('debug', `Could not refresh completion of ${device.name}: ${describe(error)}`)
				}
			}),
		)

		this.#publish()
		this.checkAllFeedbacks()
	}

	#shouldPollDetails(force: boolean): boolean {
		if (!this.config.pollDetails) return false
		if (force || this.#lastDetailPoll === 0) return true

		// While events are flowing, folder detail arrives on its own, so the poll only has to
		// act as a safety net in case an event was missed.
		const configured = Math.max(1, this.config.detailInterval)
		const seconds = this.#eventStream?.connected ? Math.max(configured, EVENT_FALLBACK_SECONDS) : configured

		return Date.now() - this.#lastDetailPoll >= seconds * 1000
	}

	/**
	 * Replaces the folder and device lists from the configuration, keeping any detail values
	 * already gathered for entries that are still present.
	 */
	#rebuildLists(
		myId: string,
		configDevices: ConfigDevice[],
		configFolders: ConfigFolder[],
		connections: SystemConnections,
	): void {
		// Syncthing lists this device alongside the remote ones, so filter it out.
		const remotes = configDevices.filter((device) => device.deviceID !== myId)
		this.state.ownDeviceName = configDevices.find((device) => device.deviceID === myId)?.name ?? ''

		// Devices get a stable name from the first block of their device ID, plus a readable
		// alias from their configured name.
		const devicePrefixes = assignPrefixPairs(
			remotes.map((device) => ({
				stable: device.deviceID.split('-')[0] ?? device.deviceID,
				readable: device.name,
			})),
		)
		const devices: DeviceInfo[] = remotes.map((device, index) => {
			const previous = this.state.devices.find((entry) => entry.id === device.deviceID)
			const connection = connections.connections[device.deviceID]
			return {
				id: device.deviceID,
				name: device.name || device.deviceID,
				varPrefix: devicePrefixes[index]?.varPrefix ?? device.deviceID,
				namePrefix: devicePrefixes[index]?.namePrefix ?? '',
				paused: device.paused,
				connected: connection?.connected ?? false,
				address: connection?.address ?? '',
				clientVersion: connection?.clientVersion ?? '',
				completion: previous?.completion ?? 0,
				needBytes: previous?.needBytes ?? 0,
				needItems: previous?.needItems ?? 0,
			}
		})

		// Folders get a stable name from their id, plus a readable alias from their label.
		const folderPrefixes = assignPrefixPairs(
			configFolders.map((folder) => ({ stable: folder.id, readable: folder.label })),
		)
		const folders: FolderInfo[] = configFolders.map((folder, index) => {
			const previous = this.state.folders.find((entry) => entry.id === folder.id)
			return {
				id: folder.id,
				label: folder.label,
				varPrefix: folderPrefixes[index]?.varPrefix ?? folder.id,
				namePrefix: folderPrefixes[index]?.namePrefix ?? '',
				type: folder.type,
				paused: folder.paused,
				state: folder.paused ? 'paused' : (previous?.state ?? 'unknown'),
				completion: previous?.completion ?? 0,
				globalBytes: previous?.globalBytes ?? 0,
				localBytes: previous?.localBytes ?? 0,
				inSyncBytes: previous?.inSyncBytes ?? 0,
				needBytes: previous?.needBytes ?? 0,
				needItems: previous?.needItems ?? 0,
				pullErrors: previous?.pullErrors ?? 0,
				receiveOnlyChangedFiles: previous?.receiveOnlyChangedFiles ?? 0,
			}
		})

		this.state.devices = devices
		this.state.folders = folders

		// Variable definitions and dropdown choices only change when the lists themselves change.
		const fingerprint = JSON.stringify([
			folders.map((folder) => [folder.id, folder.varPrefix, folder.namePrefix, folder.label]),
			devices.map((device) => [device.id, device.varPrefix, device.namePrefix, device.name]),
		])
		if (fingerprint !== this.#listFingerprint) {
			this.#listFingerprint = fingerprint
			this.updateVariableDefinitions()
			this.updateActions()
			this.updateFeedbacks()
			this.updatePresets()
			this.log('debug', `Configuration changed: ${folders.length} folder(s), ${devices.length} remote device(s)`)
		}
	}

	/**
	 * Fetches per-folder status and per-device completion.
	 * Failures of single entries are tolerated, so one broken folder does not blank everything.
	 */
	async #pollDetails(api: SyncthingApi): Promise<void> {
		await Promise.all([
			(async () => {
				try {
					const answer = await api.get<RestartRequired>('/rest/config/restart-required')
					this.state.restartRequired = answer.requiresRestart === true
				} catch {
					// Older versions may not have this endpoint; it is not worth failing the poll over.
					this.state.restartRequired = false
				}
			})(),

			...this.state.folders.map(async (folder) => {
				if (folder.paused) {
					// A paused folder reports nothing useful and the call is expensive, so skip it.
					folder.state = 'paused'
					return
				}
				try {
					const status = await api.get<DbStatus>('/rest/db/status', { folder: folder.id })
					folder.state = normaliseFolderState(status.state)
					folder.globalBytes = status.globalBytes
					folder.localBytes = status.localBytes
					folder.inSyncBytes = status.inSyncBytes
					folder.needBytes = status.needBytes
					folder.needItems = status.needTotalItems
					folder.pullErrors = status.pullErrors
					folder.receiveOnlyChangedFiles = status.receiveOnlyChangedFiles
					folder.completion = folderCompletion(status.globalBytes, status.needBytes, status.needTotalItems)
				} catch (error) {
					this.log('warn', `Could not read status of folder ${folder.id}: ${describe(error)}`)
					folder.state = 'unknown'
				}
			}),

			...this.state.devices.map(async (device) => {
				if (device.paused) {
					device.completion = 0
					device.needBytes = 0
					device.needItems = 0
					return
				}
				try {
					const completion = await api.get<DbCompletion>('/rest/db/completion', { device: device.id })
					device.completion = Math.round(completion.completion * 10) / 10
					device.needBytes = completion.needBytes
					device.needItems = completion.needItems
				} catch (error) {
					this.log('warn', `Could not read completion of device ${device.name}: ${describe(error)}`)
				}
			}),
		])
	}

	/**
	 * Writes the whole variable set from the current state.
	 *
	 * The instance-wide values come from the last poll, which is kept so that an event can
	 * republish everything without going back to the network.
	 */
	#publish(): void {
		const poll = this.#lastPoll
		if (!poll) return

		const { version, status, connections, errors } = poll
		const myId = status.myID
		const { folders, devices } = this.state

		const devicesConnected = devices.filter((device) => device.connected).length
		const devicesPaused = devices.filter((device) => device.paused).length
		const devicesOutOfSync = devices.filter((device) => !device.paused && device.completion < 100).length
		const foldersPaused = folders.filter((folder) => folder.paused).length
		const foldersSyncing = folders.filter((folder) => folder.state === 'syncing').length
		const foldersOutOfSync = folders.filter((folder) => folder.needBytes > 0 || folder.needItems > 0).length

		const errorList = errors.errors ?? []
		const lastError = errorList.length > 0 ? (errorList[errorList.length - 1]?.message ?? '') : ''
		this.state.errorCount = errorList.length

		const globalBytes = folders.reduce((sum, folder) => sum + folder.globalBytes, 0)
		const needBytes = folders.reduce((sum, folder) => sum + folder.needBytes, 0)
		const needItems = folders.reduce((sum, folder) => sum + folder.needItems, 0)
		this.state.completion = folderCompletion(globalBytes, needBytes, needItems)

		const values: CompanionVariableValues = {
			connected: 'true',
			version: version.version,
			version_long: version.longVersion,
			os: version.os,
			arch: version.arch,
			my_id: myId,
			my_id_short: myId.split('-')[0] ?? myId,
			gui_url: this.state.guiUrl,
			device_name: this.state.ownDeviceName,
			uptime_seconds: status.uptime,
			uptime: formatUptime(status.uptime),
			devices_total: devices.length,
			devices_connected: devicesConnected,
			devices_paused: devicesPaused,
			devices_out_of_sync: devicesOutOfSync,
			folders_total: folders.length,
			folders_paused: foldersPaused,
			folders_syncing: foldersSyncing,
			folders_out_of_sync: foldersOutOfSync,
			completion: String(this.state.completion),
			in_sync: String(localInSync(this.state)),
			all_in_sync: String(clusterInSync(this.state, false)),
			restart_required: String(this.state.restartRequired),
			error_count: errorList.length,
			last_error: lastError,
			bytes_in_total: connections.total.inBytesTotal,
			bytes_out_total: connections.total.outBytesTotal,
		}

		for (const folder of folders) Object.assign(values, folderVariableValues(folder))
		for (const device of devices) Object.assign(values, deviceVariableValues(device))

		this.setVariableValues(values)
	}

	/** Reports an error once, then stays quiet until the cause changes or the connection recovers. */
	#reportFailure(context: string, error: unknown): void {
		const message = describe(error)
		const full = `${context}: ${message}`

		if (this.#lastFailureMessage !== full) {
			this.#lastFailureMessage = full
			this.log('error', full)
		}

		this.#setDisconnected()

		if (error instanceof SyncthingApiError && error.isAuthFailure) {
			this.updateStatus(InstanceStatus.AuthenticationFailure, 'API key rejected')
		} else {
			this.updateStatus(InstanceStatus.ConnectionFailure, message)
		}
	}

	#setDisconnected(): void {
		this.state.connected = false
		this.state.errorCount = 0
		for (const device of this.state.devices) device.connected = false
		this.setVariableValues({
			connected: 'false',
			devices_connected: 0,
			in_sync: 'false',
			all_in_sync: 'false',
			// Published even while down, so a button can still open the GUI to investigate.
			gui_url: this.state.guiUrl,
		})
		this.checkAllFeedbacks()
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** Maps whatever Syncthing reports into the set of states this module knows. */
function normaliseFolderState(state: string): FolderState {
	const known = FOLDER_STATES as readonly string[]
	return known.includes(state) ? (state as FolderState) : 'unknown'
}
