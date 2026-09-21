import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { DEFAULT_CONFIG, GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { formatUptime, UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { SyncthingApi, SyncthingApiError } from './api.js'
import type {
	ConfigDevice,
	ConfigFolder,
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

/** Everything the feedbacks need to answer without going to the network. */
export interface ModuleState {
	connected: boolean
	errorCount: number
	devicesConnected: number
	devicesTotal: number
}

const REQUEST_TIMEOUT_MS = 10_000

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config: ModuleConfig = { ...DEFAULT_CONFIG }
	secrets: ModuleSecrets = { apiKey: '' }

	state: ModuleState = {
		connected: false,
		errorCount: 0,
		devicesConnected: 0,
		devicesTotal: 0,
	}

	#api: SyncthingApi | undefined
	#pollTimer: NodeJS.Timeout | undefined
	#pollInFlight = false
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

		this.#applyConfig()
	}

	async destroy(): Promise<void> {
		this.#stopPolling()
		this.#api = undefined
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets ?? { apiKey: '' }
		this.#applyConfig()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
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

		if (!this.config.host) {
			this.#setDisconnected()
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}
		if (!this.secrets.apiKey) {
			this.#setDisconnected()
			this.updateStatus(InstanceStatus.BadConfig, 'No API key configured')
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

	#startPolling(): void {
		const intervalMs = Math.max(1, this.config.pollInterval) * 1000
		this.#pollTimer = setInterval(() => {
			void this.poll()
		}, intervalMs)

		void this.poll()
	}

	#stopPolling(): void {
		if (this.#pollTimer) {
			clearInterval(this.#pollTimer)
			this.#pollTimer = undefined
		}
	}

	/**
	 * Reads the current state from Syncthing and publishes it as variables and feedbacks.
	 * Overlapping calls are skipped, so a slow instance cannot pile up requests.
	 */
	async poll(): Promise<void> {
		const api = this.#api
		if (!api || this.#pollInFlight) return

		this.#pollInFlight = true
		try {
			const [version, status, connections, errors, devices, folders] = await Promise.all([
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

			this.#publish(version, status, connections, errors, devices, folders)

			this.state.connected = true
			this.#lastFailureMessage = undefined
			this.updateStatus(InstanceStatus.Ok)
			this.checkFeedbacks('connected', 'has_errors')
		} catch (error) {
			this.#reportFailure('Polling failed', error)
		} finally {
			this.#pollInFlight = false
		}
	}

	#publish(
		version: SystemVersion,
		status: SystemStatus,
		connections: SystemConnections,
		errors: SystemErrors,
		devices: ConfigDevice[],
		folders: ConfigFolder[],
	): void {
		const myId = status.myID
		// The configuration lists this device alongside the remote ones, so filter it out.
		const remoteDevices = devices.filter((device) => device.deviceID !== myId)
		const ownDevice = devices.find((device) => device.deviceID === myId)

		let devicesConnected = 0
		for (const device of remoteDevices) {
			if (connections.connections[device.deviceID]?.connected) devicesConnected++
		}
		const devicesPaused = remoteDevices.filter((device) => device.paused).length
		const foldersPaused = folders.filter((folder) => folder.paused).length

		const errorList = errors.errors ?? []
		const lastError = errorList.length > 0 ? (errorList[errorList.length - 1]?.message ?? '') : ''

		this.state.errorCount = errorList.length
		this.state.devicesConnected = devicesConnected
		this.state.devicesTotal = remoteDevices.length

		this.setVariableValues({
			connected: 'true',
			version: version.version,
			version_long: version.longVersion,
			os: version.os,
			arch: version.arch,
			my_id: myId,
			my_id_short: myId.split('-')[0] ?? myId,
			device_name: ownDevice?.name ?? '',
			uptime_seconds: status.uptime,
			uptime: formatUptime(status.uptime),
			devices_total: remoteDevices.length,
			devices_connected: devicesConnected,
			devices_paused: devicesPaused,
			folders_total: folders.length,
			folders_paused: foldersPaused,
			error_count: errorList.length,
			last_error: lastError,
			bytes_in_total: connections.total.inBytesTotal,
			bytes_out_total: connections.total.outBytesTotal,
		})
	}

	/** Reports an error once, then stays quiet until the cause changes or the connection recovers. */
	#reportFailure(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error)
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
		this.state.devicesConnected = 0
		this.setVariableValues({
			connected: 'false',
			devices_connected: 0,
		})
		this.checkFeedbacks('connected', 'has_errors')
	}
}
