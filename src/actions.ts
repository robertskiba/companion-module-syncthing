import type ModuleInstance from './main.js'

/** Actions that take no options at all. */
type NoOptions = Record<string, never>

export type ActionsSchema = {
	rescan_all: { options: NoOptions }
	restart: { options: NoOptions }
	shutdown: { options: NoOptions }
	clear_errors: { options: NoOptions }
	refresh: { options: NoOptions }
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		rescan_all: {
			name: 'Rescan all folders',
			description: 'Asks Syncthing to look for local changes in every folder',
			options: [],
			callback: async () => {
				await self.runAction('Rescan all folders', async (api) => {
					await api.post('/rest/db/scan')
				})
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
			},
		},

		refresh: {
			name: 'Refresh status now',
			description: 'Polls Syncthing immediately instead of waiting for the next interval',
			options: [],
			callback: async () => {
				await self.poll()
			},
		},
	})
}
