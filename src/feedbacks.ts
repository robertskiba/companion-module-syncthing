import { combineRgb, type DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { FOLDER_STATES, findDevice, findFolder, type ModuleState } from './state.js'

type NoOptions = Record<string, never>

export type FeedbacksSchema = {
	connected: { type: 'boolean'; options: NoOptions }
	has_errors: { type: 'boolean'; options: NoOptions }
	restart_required: { type: 'boolean'; options: NoOptions }
	in_sync: { type: 'boolean'; options: NoOptions }
	all_in_sync: { type: 'boolean'; options: { ignoreDisconnected: boolean } }
	any_folder_syncing: { type: 'boolean'; options: NoOptions }
	folder_state: { type: 'boolean'; options: { folder: string; state: string } }
	folder_in_sync: { type: 'boolean'; options: { folder: string } }
	folder_paused: { type: 'boolean'; options: { folder: string } }
	folder_has_errors: { type: 'boolean'; options: { folder: string } }
	device_connected: { type: 'boolean'; options: { device: string } }
	device_paused: { type: 'boolean'; options: { device: string } }
	device_in_sync: { type: 'boolean'; options: { device: string } }
}

const WHITE = combineRgb(255, 255, 255)
const GREEN = combineRgb(0, 128, 0)
const RED = combineRgb(192, 0, 0)
const AMBER = combineRgb(200, 120, 0)
const BLUE = combineRgb(0, 80, 160)

/** Dropdown entries for the folders the module currently knows about. */
export function folderChoices(state: ModuleState): DropdownChoice[] {
	if (state.folders.length === 0) {
		return [{ id: '', label: 'No folders known yet' }]
	}
	return state.folders.map((folder) => ({
		id: folder.id,
		label: folder.label ? `${folder.label} (${folder.id})` : folder.id,
	}))
}

/** Dropdown entries for the remote devices the module currently knows about. */
export function deviceChoices(state: ModuleState): DropdownChoice[] {
	if (state.devices.length === 0) {
		return [{ id: '', label: 'No devices known yet' }]
	}
	return state.devices.map((device) => ({
		id: device.id,
		label: `${device.name} (${device.id.split('-')[0] ?? device.id})`,
	}))
}

const stateChoices: DropdownChoice[] = FOLDER_STATES.map((state) => ({ id: state, label: state }))

/** True when this machine holds everything the cluster has. */
function localInSync(state: ModuleState): boolean {
	return state.folders.every((folder) => folder.needBytes === 0 && folder.needItems === 0)
}

/**
 * True when this machine and every other device hold the same data.
 * Paused devices never count, because the user has deliberately taken them out of the picture.
 */
function clusterInSync(state: ModuleState, ignoreDisconnected: boolean): boolean {
	if (!localInSync(state)) return false

	return state.devices.every((device) => {
		if (device.paused) return true
		if (ignoreDisconnected && !device.connected) return true
		return device.completion >= 100
	})
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const folders = folderChoices(self.state)
	const devices = deviceChoices(self.state)
	const firstFolder = String(folders[0]?.id ?? '')
	const firstDevice = String(devices[0]?.id ?? '')

	self.setFeedbackDefinitions({
		connected: {
			name: 'Connected to Syncthing',
			description: 'Active while the module can reach the Syncthing REST API',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => self.state.connected,
		},

		has_errors: {
			name: 'Syncthing reports errors',
			description: 'Active while the Syncthing error list is not empty',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => self.state.errorCount > 0,
		},

		restart_required: {
			name: 'Restart required',
			description: 'Active while a configuration change is waiting for a Syncthing restart',
			type: 'boolean',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [],
			callback: () => self.state.restartRequired,
		},

		in_sync: {
			name: 'This machine is up to date',
			description: 'Active while this machine holds everything the other devices have',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => self.state.connected && localInSync(self.state),
		},

		all_in_sync: {
			name: 'In sync with all other devices',
			description:
				'Active while this machine and every other device hold the same data. ' + 'Paused devices are always ignored.',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{
					id: 'ignoreDisconnected',
					type: 'checkbox',
					label: 'Ignore devices that are currently offline',
					default: false,
					tooltip:
						'Off means an offline device that is behind keeps this feedback inactive, ' +
						'which is usually what you want before going live.',
				},
			],
			callback: (feedback) => self.state.connected && clusterInSync(self.state, feedback.options.ignoreDisconnected),
		},

		any_folder_syncing: {
			name: 'Any folder is syncing',
			description: 'Active while at least one folder is transferring data',
			type: 'boolean',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [],
			callback: () => self.state.folders.some((folder) => folder.state === 'syncing'),
		},

		folder_state: {
			name: 'Folder is in a given state',
			type: 'boolean',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				{ id: 'folder', type: 'dropdown', label: 'Folder', choices: folders, default: firstFolder },
				{ id: 'state', type: 'dropdown', label: 'State', choices: stateChoices, default: 'syncing' },
			],
			callback: (feedback) => findFolder(self.state, feedback.options.folder)?.state === feedback.options.state,
		},

		folder_in_sync: {
			name: 'Folder is fully in sync',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ id: 'folder', type: 'dropdown', label: 'Folder', choices: folders, default: firstFolder }],
			callback: (feedback) => {
				const folder = findFolder(self.state, feedback.options.folder)
				return folder !== undefined && folder.needBytes === 0 && folder.needItems === 0
			},
		},

		folder_paused: {
			name: 'Folder is paused',
			type: 'boolean',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [{ id: 'folder', type: 'dropdown', label: 'Folder', choices: folders, default: firstFolder }],
			callback: (feedback) => findFolder(self.state, feedback.options.folder)?.paused === true,
		},

		folder_has_errors: {
			name: 'Folder has failed files',
			description: 'Active while files in the folder failed to sync',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [{ id: 'folder', type: 'dropdown', label: 'Folder', choices: folders, default: firstFolder }],
			callback: (feedback) => (findFolder(self.state, feedback.options.folder)?.pullErrors ?? 0) > 0,
		},

		device_connected: {
			name: 'Device is connected',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ id: 'device', type: 'dropdown', label: 'Device', choices: devices, default: firstDevice }],
			callback: (feedback) => findDevice(self.state, feedback.options.device)?.connected === true,
		},

		device_paused: {
			name: 'Device is paused',
			type: 'boolean',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [{ id: 'device', type: 'dropdown', label: 'Device', choices: devices, default: firstDevice }],
			callback: (feedback) => findDevice(self.state, feedback.options.device)?.paused === true,
		},

		device_in_sync: {
			name: 'Device is fully in sync',
			description: 'Active while the other device holds everything that is shared with it',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ id: 'device', type: 'dropdown', label: 'Device', choices: devices, default: firstDevice }],
			callback: (feedback) => (findDevice(self.state, feedback.options.device)?.completion ?? 0) >= 100,
		},
	})
}

export { localInSync, clusterInSync }
