/** The folder states Syncthing reports, plus the ones this module derives itself. */
export const FOLDER_STATES = [
	'idle',
	'scanning',
	'scan-waiting',
	'sync-preparing',
	'syncing',
	'sync-waiting',
	'cleaning',
	'clean-waiting',
	'error',
	'paused',
	'unknown',
] as const

export type FolderState = (typeof FOLDER_STATES)[number]

/** Everything the module knows about one folder. */
export interface FolderInfo {
	id: string
	label: string
	/** The variable name segment derived from the folder id, unique within this connection. */
	varPrefix: string
	type: string
	paused: boolean
	state: FolderState
	/** Percentage of the folder that is in sync locally, 0 to 100. */
	completion: number
	globalBytes: number
	localBytes: number
	inSyncBytes: number
	needBytes: number
	needItems: number
	pullErrors: number
	/** Files changed locally in a receive-only folder and therefore not sent to the cluster. */
	receiveOnlyChangedFiles: number
}

/** Everything the module knows about one remote device. */
export interface DeviceInfo {
	id: string
	name: string
	/** The variable name segment derived from the device name, unique within this connection. */
	varPrefix: string
	paused: boolean
	connected: boolean
	address: string
	clientVersion: string
	/** Percentage the device has of everything shared with it, 0 to 100. */
	completion: number
	needBytes: number
	needItems: number
}

/** The full picture the feedbacks answer from, without going to the network. */
export interface ModuleState {
	connected: boolean
	errorCount: number
	/** The configured name of the instance this connection talks to. */
	ownDeviceName: string
	/** Local completion across all folders, 0 to 100. */
	completion: number
	folders: FolderInfo[]
	devices: DeviceInfo[]
}

export function createEmptyState(): ModuleState {
	return {
		connected: false,
		errorCount: 0,
		ownDeviceName: '',
		completion: 0,
		folders: [],
		devices: [],
	}
}

export function findFolder(state: ModuleState, folderId: string): FolderInfo | undefined {
	return state.folders.find((folder) => folder.id === folderId)
}

export function findDevice(state: ModuleState, deviceId: string): DeviceInfo | undefined {
	return state.devices.find((device) => device.id === deviceId)
}

/**
 * Turns an arbitrary folder id or device name into something usable inside a variable name.
 * Companion variable names are restricted, so anything else collapses into underscores.
 */
export function sanitizeVarSegment(input: string): string {
	const cleaned = input
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
	return cleaned.length > 0 ? cleaned : 'unnamed'
}

/**
 * Assigns a unique variable name segment to each entry.
 * Two folders or devices can sanitize down to the same string, so later duplicates get a suffix.
 */
export function assignUniquePrefixes(names: string[]): string[] {
	const used = new Set<string>()
	return names.map((name) => {
		const base = sanitizeVarSegment(name)
		let candidate = base
		let counter = 2
		while (used.has(candidate)) {
			candidate = `${base}_${counter}`
			counter++
		}
		used.add(candidate)
		return candidate
	})
}

/** Percentage of a folder that is locally in sync, derived from the byte counts. */
export function folderCompletion(globalBytes: number, needBytes: number, needItems: number): number {
	if (globalBytes > 0) {
		const ratio = 1 - needBytes / globalBytes
		return Math.max(0, Math.min(100, Math.round(ratio * 1000) / 10))
	}
	// A folder with no data is complete unless items such as deletions are still pending.
	return needItems > 0 ? 0 : 100
}
