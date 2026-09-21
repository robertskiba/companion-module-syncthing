import type ModuleInstance from './main.js'

export type VariablesSchema = {
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
	/** Number of entries in the Syncthing error list. */
	error_count: number
	/** The most recent message from the Syncthing error list. */
	last_error: string
	/** Total bytes received since the process started. */
	bytes_in_total: number
	/** Total bytes sent since the process started. */
	bytes_out_total: number
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		connected: { name: 'Connection to Syncthing established' },
		version: { name: 'Syncthing version' },
		version_long: { name: 'Syncthing version (long)' },
		os: { name: 'Operating system' },
		arch: { name: 'CPU architecture' },
		my_id: { name: 'Own device ID' },
		my_id_short: { name: 'Own device ID (short)' },
		device_name: { name: 'Own device name' },
		uptime_seconds: { name: 'Uptime in seconds' },
		uptime: { name: 'Uptime (formatted)' },
		devices_total: { name: 'Remote devices configured' },
		devices_connected: { name: 'Remote devices connected' },
		devices_paused: { name: 'Remote devices paused' },
		folders_total: { name: 'Folders configured' },
		folders_paused: { name: 'Folders paused' },
		error_count: { name: 'Number of pending errors' },
		last_error: { name: 'Most recent error message' },
		bytes_in_total: { name: 'Bytes received in total' },
		bytes_out_total: { name: 'Bytes sent in total' },
	})
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
