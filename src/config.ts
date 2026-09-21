import { Regex, type DropdownChoice, type SomeCompanionConfigField } from '@companion-module/base'
import type { LanHost } from './lanscan.js'

export type ModuleConfig = {
	host: string
	/** A one-shot trigger: picking a found instance here fills in the host, then clears itself. */
	foundHosts: string
	port: number
	useHttps: boolean
	ignoreCertErrors: boolean
	pollInterval: number
	autoApiKey: boolean
}

/** Values stored separately from the config so they are not echoed back to the web UI. */
export type ModuleSecrets = {
	apiKey: string
}

export const DEFAULT_CONFIG: ModuleConfig = {
	host: '',
	foundHosts: '',
	port: 8384,
	useHttps: false,
	ignoreCertErrors: true,
	pollInterval: 5,
	autoApiKey: true,
}

/** The value the host field carries while nothing has been chosen. */
export const NO_HOST = ''

/** The base URL of the web interface for a given configuration. */
export function guiUrlFor(config: Pick<ModuleConfig, 'host' | 'port' | 'useHttps'>): string {
	if (!config.host) return ''
	const port = config.port || DEFAULT_CONFIG.port
	return `${config.useHttps ? 'https' : 'http'}://${config.host}:${port}`
}

/** The label for one found host: address, resolved name where there is one, and device ID. */
function describeHost(host: LanHost): string {
	const parts = [host.address]
	if (host.hostname) parts.push(host.hostname)
	if (host.shortId) parts.push(`device ${host.shortId}`)
	if (host.scheme === 'https') parts.push('HTTPS')
	return `${parts[0]} - ${parts.slice(1).join(', ')}`
}

/** The entries offered by the picker for instances found on the network. */
function foundChoices(detected: LanHost[]): DropdownChoice[] {
	if (detected.length === 0) {
		return [{ id: '', label: 'Nothing found on the network' }]
	}
	return [
		{ id: '', label: 'Pick an instance to use it below...' },
		...detected.map((host) => ({ id: host.address, label: describeHost(host) })),
	]
}

/**
 * A sentence about what the network search has turned up so far.
 *
 * Companion builds this page once, when it is opened, and the module cannot push a longer list to
 * a page that is already on screen. Since instances announce themselves only every half minute or
 * so, the page has to be reopened to pick up anything heard since, and saying so plainly is the
 * only way to stop the list looking broken.
 */
function describeDetected(detected: LanHost[]): string {
	const refresh =
		'This list is built when the page opens. Leave the page and come back to pick up anything ' +
		'found since. The variable discovered_count shows the current number at any time.'

	if (detected.length === 0) {
		return (
			'Nothing found on the network yet. Syncthing announces itself every 30 to 60 seconds, ' +
			'so give it a minute. ' +
			refresh +
			' Instances whose web interface is bound to localhost only never appear, because they ' +
			'cannot be reached from here.'
		)
	}

	const list = detected.map((host) => (host.hostname ? `${host.address} (${host.hostname})` : host.address))
	return `Found on the network so far: ${list.join(', ')}. ` + refresh
}

export function GetConfigFields(
	current?: Partial<ModuleConfig>,
	detected: LanHost[] = [],
	hasSearched = false,
): SomeCompanionConfigField[] {
	const guiUrl = guiUrlFor({
		host: current?.host ?? NO_HOST,
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
				(guiUrl
					? `With the settings saved below, that GUI is at ${guiUrl} , ` +
						'which is also available on buttons as the variable gui_url. '
					: 'No host has been chosen yet, so nothing is being contacted. ') +
				`${describeDetected(detected)}`,
		},
		// Kept hidden until the search has had a fair chance, so an empty network is a real answer
		// rather than a claim made before the first announcements could have arrived.
		...(hasSearched
			? [
					{
						type: 'dropdown' as const,
						id: 'foundHosts',
						label: 'Instances found on the network',
						tooltip:
							'Filled in by listening for the announcements Syncthing broadcasts. ' +
							'Picking one puts its address in the Host field below.',
						choices: foundChoices(detected),
						default: '',
						width: 12,
					},
				]
			: []),
		{
			type: 'textinput',
			id: 'host',
			label: 'Host',
			tooltip: 'IP address or hostname of the machine running Syncthing',
			width: 6,
			default: NO_HOST,
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
			label: 'Try to read the API key automatically when the field above is empty',
			tooltip:
				'Only possible while the Syncthing web interface has no username and password. ' +
				'The key is then stored here like a key you typed in yourself. If the interface is ' +
				'protected the attempt fails, the log says so, and you enter the key by hand.',
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
	]
}
