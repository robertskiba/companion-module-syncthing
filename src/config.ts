import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	useHttps: boolean
	ignoreCertErrors: boolean
	pollInterval: number
	pollDetails: boolean
	detailInterval: number
	autoApiKey: boolean
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
	pollDetails: true,
	detailInterval: 10,
	autoApiKey: true,
}

/** The base URL of the web interface for a given configuration. */
export function guiUrlFor(config: Pick<ModuleConfig, 'host' | 'port' | 'useHttps'>): string {
	const host = config.host || DEFAULT_CONFIG.host
	const port = config.port || DEFAULT_CONFIG.port
	return `${config.useHttps ? 'https' : 'http'}://${host}:${port}`
}

export function GetConfigFields(current?: Partial<ModuleConfig>): SomeCompanionConfigField[] {
	const guiUrl = guiUrlFor({
		host: current?.host ?? DEFAULT_CONFIG.host,
		port: current?.port ?? DEFAULT_CONFIG.port,
		useHttps: current?.useHttps ?? DEFAULT_CONFIG.useHttps,
	})

	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'About this connection',
			width: 12,
			value:
				'Connects to the REST API of a Syncthing instance. ' +
				'The API key is shown in the Syncthing web GUI under Actions > Settings > General. ' +
				`With the settings saved below, that GUI is at ${guiUrl} . ` +
				'The same address is available on buttons as the variable gui_url.',
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
			id: 'autoApiKey',
			label: 'Read the API key automatically when the field above is empty',
			tooltip:
				'Works only while the Syncthing web interface has no username and password. ' +
				'The key is then stored here like a key you typed in yourself.',
			width: 12,
			default: DEFAULT_CONFIG.autoApiKey,
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
		{
			type: 'static-text',
			id: 'detail_info',
			label: 'Folder and device details',
			width: 12,
			value:
				'Per-folder and per-device variables need one extra request per folder and per device. ' +
				'Syncthing describes the folder status call as expensive, so these run on their own, ' +
				'slower interval. Turn them off if the instance holds very large folders and you only ' +
				'need the overall status.',
		},
		{
			type: 'checkbox',
			id: 'pollDetails',
			label: 'Poll folder and device details',
			width: 6,
			default: DEFAULT_CONFIG.pollDetails,
			// Referenced by the visibility expression below, which requires a plain value.
			disableAutoExpression: true,
		},
		{
			type: 'number',
			id: 'detailInterval',
			label: 'Detail interval (seconds)',
			tooltip: 'How often per-folder and per-device data is refreshed',
			width: 6,
			min: 1,
			max: 3600,
			default: DEFAULT_CONFIG.detailInterval,
			isVisibleExpression: '$(options:pollDetails)',
		},
	]
}
