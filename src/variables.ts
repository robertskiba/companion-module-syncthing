import type {
	CompanionVariableDefinitions,
	CompanionVariableValue,
	CompanionVariableValues,
} from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { DeviceInfo, FolderInfo } from './state.js'

/**
 * Variables this connection always exposes.
 *
 * Per-folder and per-device variables are added on top of these once the module knows what the
 * instance is configured with, so the schema also carries an index signature.
 */
export interface VariablesSchema extends CompanionVariableValues {
	/** 'true' when the last poll reached the instance, 'false' otherwise. */
	connected: string
	/** Short version string, for example v1.29.2 */
	version: string
	/** Full version string including build details. */
	version_long: string
	/** Operating system Syncthing runs on. */
	os: string
	/** CPU architecture Syncthing runs on. */
	arch: string
	/** The device ID of the instance this connection talks to. */
	my_id: string
	/** The first segment of the device ID, which is enough to recognise it. */
	my_id_short: string
	/** The base URL of the Syncthing web interface this connection talks to. */
	gui_url: string
	/** The configured name of this device. */
	device_name: string
	/** Seconds since the Syncthing process started. */
	uptime_seconds: number
	/** Uptime formatted as a human readable duration. */
	uptime: string
	/** Number of remote devices in the configuration. */
	devices_total: number
	/** Number of remote devices currently connected. */
	devices_connected: number
	/** Number of remote devices that are paused. */
	devices_paused: number
	/** Number of folders in the configuration. */
	folders_total: number
	/** Number of folders that are paused. */
	folders_paused: number
	/** Number of folders that are currently syncing. */
	folders_syncing: number
	/** Number of folders that are not fully in sync. */
	folders_out_of_sync: number
	/** Number of remote devices that are not fully up to date. */
	devices_out_of_sync: number
	/** Local completion across all folders, 0 to 100. */
	completion: string
	/** 'true' while this machine has everything the cluster has. */
	in_sync: string
	/** 'true' while this machine and every other device are fully in sync with each other. */
	all_in_sync: string
	/** 'true' when a configuration change is waiting for a Syncthing restart. */
	restart_required: string
	/** Number of entries in the Syncthing error list. */
	error_count: number
	/** The most recent message from the Syncthing error list. */
	last_error: string
	/** Total bytes received since the process started. */
	bytes_in_total: number
	/** Total bytes sent since the process started. */
	bytes_out_total: number
}

const STATIC_DEFINITIONS: CompanionVariableDefinitions<VariablesSchema> = {
	connected: { name: 'Connection to Syncthing established' },
	version: { name: 'Syncthing version' },
	version_long: { name: 'Syncthing version (long)' },
	os: { name: 'Operating system' },
	arch: { name: 'CPU architecture' },
	my_id: { name: 'Own device ID' },
	my_id_short: { name: 'Own device ID (short)' },
	gui_url: { name: 'URL of the Syncthing web interface' },
	device_name: { name: 'Own device name' },
	uptime_seconds: { name: 'Uptime in seconds' },
	uptime: { name: 'Uptime (formatted)' },
	devices_total: { name: 'Remote devices configured' },
	devices_connected: { name: 'Remote devices connected' },
	devices_paused: { name: 'Remote devices paused' },
	folders_total: { name: 'Folders configured' },
	folders_paused: { name: 'Folders paused' },
	folders_syncing: { name: 'Folders currently syncing' },
	folders_out_of_sync: { name: 'Folders not fully in sync' },
	devices_out_of_sync: { name: 'Remote devices not up to date' },
	completion: { name: 'Overall completion in percent' },
	in_sync: { name: 'This machine is up to date' },
	all_in_sync: { name: 'In sync with all other devices' },
	restart_required: { name: 'Restart required for pending config changes' },
	error_count: { name: 'Number of pending errors' },
	last_error: { name: 'Most recent error message' },
	bytes_in_total: { name: 'Bytes received in total' },
	bytes_out_total: { name: 'Bytes sent in total' },
}

/** Builds the stable variable id for one property of one folder, based on the folder id. */
export function folderVar(folder: FolderInfo, suffix: string): string {
	return `folder_${folder.varPrefix}_${suffix}`
}

/** Builds the readable variable id for one folder property, or undefined when there is no alias. */
export function folderNameVar(folder: FolderInfo, suffix: string): string | undefined {
	return folder.namePrefix ? `folder_${folder.namePrefix}_${suffix}` : undefined
}

/** Builds the stable variable id for one property of one device, based on the device ID. */
export function deviceVar(device: DeviceInfo, suffix: string): string {
	return `device_${device.varPrefix}_${suffix}`
}

/** Builds the readable variable id for one device property, or undefined when there is no alias. */
export function deviceNameVar(device: DeviceInfo, suffix: string): string | undefined {
	return device.namePrefix ? `device_${device.namePrefix}_${suffix}` : undefined
}

const FOLDER_SUFFIXES: { suffix: string; name: string }[] = [
	{ suffix: 'id', name: 'id' },
	{ suffix: 'label', name: 'label' },
	{ suffix: 'type', name: 'type' },
	{ suffix: 'state', name: 'state' },
	{ suffix: 'paused', name: 'paused' },
	{ suffix: 'completion', name: 'completion in percent' },
	{ suffix: 'in_sync', name: 'fully in sync' },
	{ suffix: 'need_bytes', name: 'bytes still needed' },
	{ suffix: 'need_items', name: 'items still needed' },
	{ suffix: 'global_bytes', name: 'bytes in the cluster' },
	{ suffix: 'local_bytes', name: 'bytes present locally' },
	{ suffix: 'errors', name: 'error count' },
	{ suffix: 'pull_errors', name: 'files that failed to sync' },
	{ suffix: 'local_changes', name: 'local changes in a receive-only folder' },
]

const DEVICE_SUFFIXES: { suffix: string; name: string }[] = [
	{ suffix: 'id', name: 'device ID' },
	{ suffix: 'id_short', name: 'device ID (short)' },
	{ suffix: 'name', name: 'name' },
	{ suffix: 'connected', name: 'connected' },
	{ suffix: 'paused', name: 'paused' },
	{ suffix: 'completion', name: 'completion in percent' },
	{ suffix: 'in_sync', name: 'fully in sync' },
	{ suffix: 'need_bytes', name: 'bytes still needed' },
	{ suffix: 'need_items', name: 'items still needed' },
	{ suffix: 'address', name: 'current address' },
	{ suffix: 'client_version', name: 'Syncthing version' },
]

/**
 * Publishes the variable definitions for the folders and devices the module currently knows about.
 * Companion rejects values for undefined variables, so this runs before any value is set.
 */
export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = { ...STATIC_DEFINITIONS }

	for (const folder of self.state.folders) {
		const title = folder.label || folder.id
		for (const { suffix, name } of FOLDER_SUFFIXES) {
			definitions[folderVar(folder, suffix)] = { name: `Folder ${title}: ${name} (by id)` }
			const alias = folderNameVar(folder, suffix)
			if (alias) definitions[alias] = { name: `Folder ${title}: ${name} (by label)` }
		}
	}

	for (const device of self.state.devices) {
		for (const { suffix, name } of DEVICE_SUFFIXES) {
			definitions[deviceVar(device, suffix)] = { name: `Device ${device.name}: ${name} (by ID)` }
			const alias = deviceNameVar(device, suffix)
			if (alias) definitions[alias] = { name: `Device ${device.name}: ${name} (by name)` }
		}
	}

	self.setVariableDefinitions(definitions)
}

/** Writes every value under the stable prefix and, when there is one, under the readable alias. */
function underBothPrefixes(
	values: Record<string, CompanionVariableValue>,
	stablePrefix: string,
	namePrefix: string,
): CompanionVariableValues {
	const result: CompanionVariableValues = {}
	for (const [suffix, value] of Object.entries(values)) {
		result[`${stablePrefix}_${suffix}`] = value
		if (namePrefix) result[`${namePrefix}_${suffix}`] = value
	}
	return result
}

/** The values for one folder, keyed by variable id, under both naming variants. */
export function folderVariableValues(folder: FolderInfo): CompanionVariableValues {
	return underBothPrefixes(
		{
			id: folder.id,
			label: folder.label || folder.id,
			type: folder.type,
			state: folder.state,
			paused: String(folder.paused),
			completion: folder.completion,
			in_sync: String(folder.needBytes === 0 && folder.needItems === 0),
			need_bytes: folder.needBytes,
			need_items: folder.needItems,
			global_bytes: folder.globalBytes,
			local_bytes: folder.localBytes,
			errors: folder.pullErrors,
			pull_errors: folder.pullErrors,
			local_changes: folder.receiveOnlyChangedFiles,
		},
		`folder_${folder.varPrefix}`,
		folder.namePrefix ? `folder_${folder.namePrefix}` : '',
	)
}

/** The values for one device, keyed by variable id, under both naming variants. */
export function deviceVariableValues(device: DeviceInfo): CompanionVariableValues {
	return underBothPrefixes(
		{
			id: device.id,
			id_short: device.id.split('-')[0] ?? device.id,
			name: device.name,
			connected: String(device.connected),
			paused: String(device.paused),
			completion: device.completion,
			in_sync: String(device.completion >= 100),
			need_bytes: device.needBytes,
			need_items: device.needItems,
			address: device.address,
			client_version: device.clientVersion,
		},
		`device_${device.varPrefix}`,
		device.namePrefix ? `device_${device.namePrefix}` : '',
	)
}

/** Renders a number of seconds as "3d 04:15:22", dropping the day part when it is zero. */
export function formatUptime(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds))
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = seconds % 60

	const pad = (value: number): string => String(value).padStart(2, '0')
	const clock = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`

	return days > 0 ? `${days}d ${clock}` : clock
}
