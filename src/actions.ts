import type { DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { deviceChoices, folderChoices } from './feedbacks.js'
import { findDevice, findFolder } from './state.js'

/** Actions that take no options at all. */
type NoOptions = Record<string, never>

/** How a pause action should act on the current state. */
export type PauseMode = 'pause' | 'resume' | 'toggle'

export type ActionsSchema = {
	rescan_all: { options: NoOptions }
	rescan_folder: { options: { folder: string } }
	folder_pause: { options: { folder: string; mode: string } }
	folder_override: { options: { folder: string } }
	folder_revert: { options: { folder: string } }
	device_pause: { options: { device: string; mode: string } }
	devices_pause_all: { options: { mode: string } }
	restart: { options: NoOptions }
	shutdown: { options: NoOptions }
	clear_errors: { options: NoOptions }
	refresh: { options: NoOptions }
}

const PAUSE_MODES: DropdownChoice[] = [
	{ id: 'pause', label: 'Pause' },
	{ id: 'resume', label: 'Resume' },
	{ id: 'toggle', label: 'Toggle' },
]

/**
 * Works out whether the target should end up paused.
 * Returns undefined when a toggle was asked for but the current state is unknown.
 */
export function resolvePause(mode: string, currentlyPaused: boolean | undefined): boolean | undefined {
	if (mode === 'pause') return true
	if (mode === 'resume') return false
	if (currentlyPaused === undefined) return undefined
	return !currentlyPaused
}

export function UpdateActions(self: ModuleInstance): void {
	const folders = folderChoices(self.state)
	const devices = deviceChoices(self.state)
	const firstFolder = String(folders[0]?.id ?? '')
	const firstDevice = String(devices[0]?.id ?? '')

	const folderOption = {
		id: 'folder' as const,
		type: 'dropdown' as const,
		label: 'Folder',
		choices: folders,
		default: firstFolder,
		allowCustom: true,
		tooltip: 'The list follows the folders configured in Syncthing',
	}

	const deviceOption = {
		id: 'device' as const,
		type: 'dropdown' as const,
		label: 'Device',
		choices: devices,
		default: firstDevice,
		allowCustom: true,
		tooltip: 'The list follows the devices configured in Syncthing',
	}

	self.setActionDefinitions({
		rescan_all: {
			name: 'Rescan all folders',
			description: 'Asks Syncthing to look for local changes in every folder',
			options: [],
			callback: async () => {
				await self.runAction('Rescan all folders', async (api) => {
					await api.post('/rest/db/scan')
				})
				await self.poll(true)
			},
		},

		rescan_folder: {
			name: 'Rescan one folder',
			description: 'Asks Syncthing to look for local changes in a single folder',
			options: [folderOption],
			callback: async (action) => {
				const folder = action.options.folder
				if (!folder) {
					self.log('warn', 'Rescan one folder: no folder selected')
					return
				}
				await self.runAction(`Rescan folder ${folder}`, async (api) => {
					await api.post('/rest/db/scan', { folder })
				})
				await self.poll(true)
			},
		},

		folder_pause: {
			name: 'Folder: pause, resume or toggle',
			description: 'A paused folder is neither scanned nor synchronised until it is resumed',
			options: [
				folderOption,
				{ id: 'mode', type: 'dropdown', label: 'Action', choices: PAUSE_MODES, default: 'toggle' },
			],
			callback: async (action) => {
				const folderId = action.options.folder
				if (!folderId) {
					self.log('warn', 'Folder pause: no folder selected')
					return
				}

				const known = findFolder(self.state, folderId)
				const paused = resolvePause(action.options.mode, known?.paused)
				if (paused === undefined) {
					self.log('warn', `Folder pause: cannot toggle ${folderId}, its current state is unknown`)
					return
				}

				const verb = paused ? 'Pause' : 'Resume'
				await self.runAction(`${verb} folder ${folderId}`, async (api) => {
					// PATCH replaces only the fields given, leaving the rest of the folder config alone.
					await api.patch(`/rest/config/folders/${encodeURIComponent(folderId)}`, { paused })
				})
				await self.poll(true)
			},
		},

		folder_override: {
			name: 'Folder: override remote changes',
			description:
				'Makes the local version the latest one, discarding changes other devices made. ' +
				'Only has an effect on send-only folders.',
			options: [folderOption],
			callback: async (action) => {
				const folderId = action.options.folder
				if (!folderId) {
					self.log('warn', 'Override: no folder selected')
					return
				}

				const known = findFolder(self.state, folderId)
				if (known && known.type !== 'sendonly') {
					self.log(
						'warn',
						`Override: folder ${folderId} is of type ${known.type}, ` +
							'so Syncthing will ignore this. Override only applies to send-only folders.',
					)
					return
				}

				await self.runAction(`Override folder ${folderId}`, async (api) => {
					await api.post('/rest/db/override', { folder: folderId })
				})
				await self.poll(true)
			},
		},

		folder_revert: {
			name: 'Folder: revert local changes',
			description:
				'Undoes changes made locally, taking the cluster version back. ' +
				'Only has an effect on receive-only folders.',
			options: [folderOption],
			callback: async (action) => {
				const folderId = action.options.folder
				if (!folderId) {
					self.log('warn', 'Revert: no folder selected')
					return
				}

				const known = findFolder(self.state, folderId)
				if (known && known.type !== 'receiveonly') {
					self.log(
						'warn',
						`Revert: folder ${folderId} is of type ${known.type}, ` +
							'so Syncthing will ignore this. Revert only applies to receive-only folders.',
					)
					return
				}

				await self.runAction(`Revert folder ${folderId}`, async (api) => {
					await api.post('/rest/db/revert', { folder: folderId })
				})
				await self.poll(true)
			},
		},

		device_pause: {
			name: 'Device: pause, resume or toggle',
			description: 'A paused device is not connected to until it is resumed',
			options: [
				deviceOption,
				{ id: 'mode', type: 'dropdown', label: 'Action', choices: PAUSE_MODES, default: 'toggle' },
			],
			callback: async (action) => {
				const deviceId = action.options.device
				if (!deviceId) {
					self.log('warn', 'Device pause: no device selected')
					return
				}

				const known = findDevice(self.state, deviceId)
				const paused = resolvePause(action.options.mode, known?.paused)
				if (paused === undefined) {
					self.log('warn', `Device pause: cannot toggle ${deviceId}, its current state is unknown`)
					return
				}

				const verb = paused ? 'Pause' : 'Resume'
				await self.runAction(`${verb} device ${known?.name ?? deviceId}`, async (api) => {
					await api.post(paused ? '/rest/system/pause' : '/rest/system/resume', { device: deviceId })
				})
				await self.poll(true)
			},
		},

		devices_pause_all: {
			name: 'All devices: pause or resume',
			description: 'Pauses or resumes every remote device at once',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Action',
					choices: PAUSE_MODES.filter((choice) => choice.id !== 'toggle'),
					default: 'pause',
				},
			],
			callback: async (action) => {
				const paused = action.options.mode !== 'resume'
				await self.runAction(paused ? 'Pause all devices' : 'Resume all devices', async (api) => {
					// Leaving the device parameter out applies the call to every device.
					await api.post(paused ? '/rest/system/pause' : '/rest/system/resume')
				})
				await self.poll(true)
			},
		},

		restart: {
			name: 'Restart Syncthing',
			description: 'Restarts the Syncthing process on the target machine',
			options: [],
			callback: async () => {
				await self.runAction('Restart Syncthing', async (api) => {
					await api.post('/rest/system/restart')
				})
			},
		},

		shutdown: {
			name: 'Shut down Syncthing',
			description: 'Stops the Syncthing process. It has to be started again on the machine itself.',
			options: [],
			callback: async () => {
				await self.runAction('Shut down Syncthing', async (api) => {
					await api.post('/rest/system/shutdown')
				})
			},
		},

		clear_errors: {
			name: 'Clear error list',
			description: 'Empties the list of errors shown in the Syncthing GUI',
			options: [],
			callback: async () => {
				await self.runAction('Clear error list', async (api) => {
					await api.post('/rest/system/error/clear')
				})
				await self.poll(true)
			},
		},

		refresh: {
			name: 'Refresh status now',
			description: 'Polls Syncthing immediately instead of waiting for the next interval',
			options: [],
			callback: async () => {
				await self.poll(true)
			},
		},
	})
}
