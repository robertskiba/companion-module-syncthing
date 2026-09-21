import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'

type NoOptions = Record<string, never>

export type FeedbacksSchema = {
	connected: {
		type: 'boolean'
		options: NoOptions
	}
	has_errors: {
		type: 'boolean'
		options: NoOptions
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		connected: {
			name: 'Connected to Syncthing',
			description: 'Active while the module can reach the Syncthing REST API',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 128, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.state.connected,
		},

		has_errors: {
			name: 'Syncthing reports errors',
			description: 'Active while the Syncthing error list is not empty',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(192, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.state.errorCount > 0,
		},
	})
}
