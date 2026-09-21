import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	useHttps: boolean
	ignoreCertErrors: boolean
	pollInterval: number
}

/** Values stored separately from the config so they are not echoed back to the web UI. */
export type ModuleSecrets = {
	apiKey: string
}

export const DEFAULT_CONFIG: ModuleConfig = {
	host: '127.0.0.1',
	port: 8384,
	useHttps: false,
	ignoreCertErrors: true,
	pollInterval: 5,
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'About this connection',
			width: 12,
			value:
				'Connects to the REST API of a Syncthing instance. ' +
				'The API key is shown in the Syncthing web GUI under Actions > Settings > General.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Host',
			tooltip: 'IP address or hostname of the machine running Syncthing',
			width: 6,
			default: DEFAULT_CONFIG.host,
			regex: Regex.HOSTNAME,
		},
		{
			type: 'number',
			id: 'port',
			label: 'GUI port',
			tooltip: 'The port of the Syncthing web GUI, 8384 by default',
			width: 3,
			min: 1,
			max: 65535,
			default: DEFAULT_CONFIG.port,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll interval (seconds)',
			tooltip: 'How often the module refreshes status and variables',
			width: 3,
			min: 1,
			max: 3600,
			default: DEFAULT_CONFIG.pollInterval,
		},
		{
			type: 'secret-text',
			id: 'apiKey',
			label: 'API key',
			tooltip: 'Syncthing web GUI: Actions > Settings > General > API Key',
			width: 12,
		},
		{
			type: 'checkbox',
			id: 'useHttps',
			label: 'Use HTTPS',
			tooltip: 'Enable if the Syncthing GUI is configured for HTTPS',
			width: 6,
			default: DEFAULT_CONFIG.useHttps,
		},
		{
			type: 'checkbox',
			id: 'ignoreCertErrors',
			label: 'Accept self-signed certificate',
			tooltip: 'Syncthing generates its own certificate, which is not signed by a public authority',
			width: 6,
			default: DEFAULT_CONFIG.ignoreCertErrors,
		},
	]
}
