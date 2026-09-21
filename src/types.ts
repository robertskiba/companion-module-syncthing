/**
 * The subset of Syncthing REST API response shapes this module relies on.
 * See https://docs.syncthing.net/dev/rest.html
 */

/** GET /rest/system/version */
export interface SystemVersion {
	arch: string
	codename: string
	container: boolean
	date: string
	extra: string
	isCandidate: boolean
	longVersion: string
	os: string
	stamp: string
	user: string
	version: string
}

/** GET /rest/system/status */
export interface SystemStatus {
	alloc: number
	connectionServiceStatus: Record<string, unknown>
	cpuPercent: number
	discoveryEnabled: boolean
	discoveryErrors: Record<string, string>
	discoveryStatus: Record<string, unknown>
	goroutines: number
	lastDialStatus: Record<string, unknown>
	myID: string
	pathSeparator: string
	startTime: string
	sys: number
	tilde: string
	uptime: number
}

/** One entry of GET /rest/system/connections -> connections */
export interface ConnectionEntry {
	address: string
	at: string
	clientVersion: string
	connected: boolean
	crypto: string
	inBytesTotal: number
	outBytesTotal: number
	paused: boolean
	type: string
}

/** GET /rest/system/connections */
export interface SystemConnections {
	connections: Record<string, ConnectionEntry>
	total: {
		at: string
		inBytesTotal: number
		outBytesTotal: number
	}
}

/** One element of GET /rest/system/error -> errors */
export interface SystemError {
	when: string
	message: string
	level?: number
}

/** GET /rest/system/error */
export interface SystemErrors {
	errors: SystemError[] | null
}

/** A device as stored in the configuration. */
export interface ConfigDevice {
	deviceID: string
	name: string
	addresses: string[]
	paused: boolean
	introducer: boolean
}

/** A folder as stored in the configuration. */
export interface ConfigFolder {
	id: string
	label: string
	path: string
	type: string
	paused: boolean
	devices: { deviceID: string }[]
}
