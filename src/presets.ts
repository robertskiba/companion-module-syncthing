import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREY = combineRgb(40, 40, 40)
const RED = combineRgb(192, 0, 0)
const GREEN = combineRgb(0, 128, 0)
const AMBER = combineRgb(200, 120, 0)
const BLUE = combineRgb(0, 80, 160)

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		overview_all_in_sync: {
			type: 'simple',
			name: 'In sync with all devices',
			keywords: ['sync', 'ready', 'status'],
			style: {
				text: 'ALL\nIN SYNC',
				size: 'auto',
				color: WHITE,
				bgcolor: RED,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'all_in_sync',
					options: { ignoreDisconnected: false },
					style: { bgcolor: GREEN, color: WHITE },
				},
			],
		},

		overview_in_sync: {
			type: 'simple',
			name: 'This machine is up to date',
			style: {
				text: 'This PC\n$(syncthing:completion)%',
				size: 'auto',
				color: WHITE,
				bgcolor: RED,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [{ feedbackId: 'in_sync', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
		},

		overview_connection: {
			type: 'simple',
			name: 'Connection status',
			style: {
				text: 'Syncthing\n$(syncthing:version)',
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
		},

		overview_errors: {
			type: 'simple',
			name: 'Error count',
			style: {
				text: 'Errors\n$(syncthing:error_count)',
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [{ feedbackId: 'has_errors', options: {}, style: { bgcolor: RED, color: WHITE } }],
		},

		overview_devices: {
			type: 'simple',
			name: 'Connected devices',
			style: {
				text: 'Devices\n$(syncthing:devices_connected)/$(syncthing:devices_total)',
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [],
		},

		overview_syncing: {
			type: 'simple',
			name: 'Transfer running',
			style: {
				text: 'Syncing\n$(syncthing:folders_syncing)',
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [{ feedbackId: 'any_folder_syncing', options: {}, style: { bgcolor: BLUE, color: WHITE } }],
		},

		control_rescan: {
			type: 'simple',
			name: 'Rescan all folders',
			style: { text: 'Rescan\nall', size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
			steps: [{ down: [{ actionId: 'rescan_all', options: {} }], up: [] }],
			feedbacks: [],
		},

		control_clear_errors: {
			type: 'simple',
			name: 'Clear error list',
			style: { text: 'Clear\nerrors', size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
			steps: [{ down: [{ actionId: 'clear_errors', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'has_errors', options: {}, style: { bgcolor: RED, color: WHITE } }],
		},

		control_refresh: {
			type: 'simple',
			name: 'Refresh status now',
			style: { text: 'Refresh\nstatus', size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
			steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
			feedbacks: [],
		},

		control_restart: {
			type: 'simple',
			name: 'Restart Syncthing',
			style: { text: 'Restart\nSyncthing', size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
			steps: [{ down: [{ actionId: 'restart', options: {} }], up: [] }],
			feedbacks: [],
		},
	}

	// One button per folder, built from whatever the instance is configured with right now.
	const folderPresetIds: string[] = []
	for (const folder of self.state.folders) {
		const id = `folder_${folder.varPrefix}`
		folderPresetIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Folder ${folder.label || folder.id}`,
			keywords: ['folder', folder.id],
			style: {
				text: `${folder.label || folder.id}\n$(syncthing:folder_${folder.varPrefix}_completion)%`,
				size: 'auto',
				color: WHITE,
				bgcolor: RED,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'rescan_folder', options: { folder: folder.id } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'folder_in_sync',
					options: { folder: folder.id },
					style: { bgcolor: GREEN, color: WHITE },
				},
				{
					feedbackId: 'folder_state',
					options: { folder: folder.id, state: 'syncing' },
					style: { bgcolor: BLUE, color: WHITE },
				},
				{
					feedbackId: 'folder_paused',
					options: { folder: folder.id },
					style: { bgcolor: AMBER, color: WHITE },
				},
				{
					feedbackId: 'folder_has_errors',
					options: { folder: folder.id },
					style: { bgcolor: RED, color: WHITE },
				},
			],
		}
	}

	// One button per remote device.
	const devicePresetIds: string[] = []
	for (const device of self.state.devices) {
		const id = `device_${device.varPrefix}`
		devicePresetIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Device ${device.name}`,
			keywords: ['device', device.name],
			style: {
				text: `${device.name}\n$(syncthing:device_${device.varPrefix}_completion)%`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'device_in_sync',
					options: { device: device.id },
					style: { bgcolor: GREEN, color: WHITE },
				},
				{
					feedbackId: 'device_paused',
					options: { device: device.id },
					style: { bgcolor: AMBER, color: WHITE },
				},
			],
		}
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'overview',
			name: 'Overview',
			description: 'The state of the whole instance at a glance',
			definitions: [
				'overview_all_in_sync',
				'overview_in_sync',
				'overview_connection',
				'overview_devices',
				'overview_syncing',
				'overview_errors',
			],
		},
	]

	if (folderPresetIds.length > 0) {
		structure.push({
			id: 'folders',
			name: 'Folders',
			description: 'One button per configured folder, showing completion and pressing to rescan',
			definitions: folderPresetIds,
		})
	}

	if (devicePresetIds.length > 0) {
		structure.push({
			id: 'devices',
			name: 'Devices',
			description: 'One button per remote device, showing how far it has caught up',
			definitions: devicePresetIds,
		})
	}

	structure.push({
		id: 'control',
		name: 'Control',
		description: 'Buttons triggering actions on the Syncthing instance',
		definitions: ['control_rescan', 'control_clear_errors', 'control_refresh', 'control_restart'],
	})

	self.setPresetDefinitions(structure, presets)
}
