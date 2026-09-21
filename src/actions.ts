import type ModuleInstance from './main.js'
import { deviceChoices, folderChoices } from './feedbacks.js'

/** Actions that take no options at all. */
type NoOptions = Record<string, never>

export type ActionsSchema = {
	rescan_all: { options: NoOptions }
	rescan_folder: { options: { folder: string } }
	restart: { options: NoOptions }
	shutdown: { options: NoOptions }
	clear_errors: { options: NoOptions }
	refresh: { options: NoOptions }
}

export function UpdateActions(self: ModuleInstance): void {
	const folders = folderChoices(self.state)
	const firstFolder = String(folders[0]?.id ?? '')

	// Referenced so the action list is rebuilt when devices change, ready for stage three.
	void deviceChoices(self.state)

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
			options: [
				{
					id: 'folder',
					type: 'dropdown',
					label: 'Folder',
					choices: folders,
					default: firstFolder,
					allowCustom: true,
					tooltip: 'The list follows the folders configured in Syncthing',
				},
			],
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
