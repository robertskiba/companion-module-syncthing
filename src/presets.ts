import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREY = combineRgb(40, 40, 40)
const RED = combineRgb(192, 0, 0)
const GREEN = combineRgb(0, 128, 0)

export function UpdatePresets(self: ModuleInstance): void {
	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'status',
			name: 'Status',
			description: 'Buttons showing the state of the Syncthing instance',
			definitions: ['status_connection', 'status_errors', 'status_devices'],
		},
		{
			id: 'control',
			name: 'Control',
			description: 'Buttons triggering actions on the Syncthing instance',
			definitions: ['control_rescan', 'control_clear_errors', 'control_restart'],
		},
	]

	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		status_connection: {
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
			feedbacks: [
				{
					feedbackId: 'connected',
					options: {},
					style: { bgcolor: GREEN, color: WHITE },
				},
			],
		},

		status_errors: {
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
			feedbacks: [
				{
					feedbackId: 'has_errors',
					options: {},
					style: { bgcolor: RED, color: WHITE },
				},
			],
		},

		status_devices: {
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

		control_rescan: {
			type: 'simple',
			name: 'Rescan all folders',
			style: {
				text: 'Rescan\nall',
				size: 'auto',
				color: WHITE,
				bgcolor: BLACK,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'rescan_all', options: {} }], up: [] }],
			feedbacks: [],
		},

		control_clear_errors: {
			type: 'simple',
			name: 'Clear error list',
			style: {
				text: 'Clear\nerrors',
				size: 'auto',
				color: WHITE,
				bgcolor: BLACK,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'clear_errors', options: {} }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'has_errors',
					options: {},
					style: { bgcolor: RED, color: WHITE },
				},
			],
		},

		control_restart: {
			type: 'simple',
			name: 'Restart Syncthing',
			style: {
				text: 'Restart\nSyncthing',
				size: 'auto',
				color: WHITE,
				bgcolor: BLACK,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'restart', options: {} }], up: [] }],
			feedbacks: [],
		},
	}

	self.setPresetDefinitions(structure, presets)
}
