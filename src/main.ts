import {
	InstanceBase,
	InstanceStatus,
	type CompanionVariableValues,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { DEFAULT_CONFIG, GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
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
import {
	assignPrefixPairs,
	createEmptyState,
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
		this.#lastDetailPoll = 0

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

			this.#publish(version, status, connections, errors)

			this.state.connected = true
			this.#lastFailureMessage = undefined
			this.updateStatus(InstanceStatus.Ok)
			this.checkAllFeedbacks()
		} catch (error) {
			this.#reportFailure('Polling failed', error)
		} finally {
			this.#pollInFlight = false
		}
	}

	#shouldPollDetails(force: boolean): boolean {
		if (!this.config.pollDetails) return false
		if (force || this.#lastDetailPoll === 0) return true
		return Date.now() - this.#lastDetailPoll >= Math.max(1, this.config.detailInterval) * 1000
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

	#publish(version: SystemVersion, status: SystemStatus, connections: SystemConnections, errors: SystemErrors): void {
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
