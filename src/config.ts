import { Regex, type DropdownChoice, type SomeCompanionConfigField } from '@companion-module/base'
import type { LanHost } from './lanscan.js'

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
	host: '',
	port: 8384,
	useHttps: false,
	ignoreCertErrors: true,
	pollInterval: 5,
	pollDetails: true,
	detailInterval: 10,
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

/**
 * The entries offered for the host field: whatever was found on the network, plus the address
 * already configured, so the current value never disappears from the list.
 */
function hostChoices(current: string | undefined, detected: LanHost[]): DropdownChoice[] {
	const choices: DropdownChoice[] = detected.map((host) => ({
		id: host.address,
		label: describeHost(host),
	}))

	if (current && !choices.some((choice) => choice.id === current)) {
		choices.unshift({ id: current, label: current })
	}

	// An explicit empty entry, so "nothing chosen" is a real value the dropdown can hold.
	choices.unshift({ id: NO_HOST, label: 'Select a host' })
	return choices
}

/** A sentence about what network discovery has turned up so far. */
function describeDetected(detected: LanHost[]): string {
	if (detected.length === 0) {
		return (
			'No instances found on the network yet. Syncthing announces itself every 30 to 60 ' +
			'seconds, so reopen this page in a minute. Instances whose web interface is bound to ' +
			'localhost only never appear, because they cannot be reached from here.'
		)
	}
	const list = detected.map((host) => (host.hostname ? `${host.address} (${host.hostname})` : host.address))
	return `Found on the network: ${list.join(', ')}.`
}

export function GetConfigFields(current?: Partial<ModuleConfig>, detected: LanHost[] = []): SomeCompanionConfigField[] {
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
		{
			type: 'dropdown',
			id: 'host',
			label: 'Host',
			tooltip: 'Instances found on the network are offered here. ' + 'Any other address can be typed in instead.',
			width: 6,
			default: NO_HOST,
			choices: hostChoices(current?.host, detected),
			allowCustom: true,
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
		{
			type: 'static-text',
			id: 'detail_info',
			label: 'Folder and device details',
			width: 12,
			value:
				'Per-folder and per-device variables need one extra request per folder and per device. ' +
				'Syncthing describes the folder status call as expensive, so these run on their own, ' +
				'slower interval. Turn them off if the instance holds very large folders and you only ' +
				'need the overall status. While the event stream is connected these numbers arrive ' +
				'from events instead, and the interval below only acts as a safety net, at most ' +
				'once every two minutes. The event stream and the search for instances on the ' +
				'network both run on their own; there is nothing to switch on.',
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
