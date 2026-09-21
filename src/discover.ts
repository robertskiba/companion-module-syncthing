import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'

/**
 * Reads the API key out of a Syncthing instance whose web interface is not password protected.
 *
 * Syncthing's own web interface talks to the REST API without an API key. It is allowed to do so
 * because it carries a CSRF token that the server handed out, and because the extra login check
 * only exists once a GUI user and password are configured. This function walks the same path: it
 * asks for the GUI once to receive the CSRF cookie, then reads the configuration with the matching
 * header and picks the API key out of it.
 *
 * That means it works only where the instance already allows unauthenticated access, and it fails
 * cleanly everywhere else. It also relies on behaviour that is not part of the documented REST API,
 * so a future Syncthing release could change it.
 */

export interface DiscoverOptions {
	host: string
	port: number
	useHttps: boolean
	ignoreCertErrors: boolean
	timeout: number
}

interface RawResponse {
	status: number
	body: string
	setCookie: string[]
}

/** Thrown when the key could not be read, carrying a reason suitable for the connection log. */
export class DiscoveryError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'DiscoveryError'
	}
}

async function fetchRaw(
	options: DiscoverOptions,
	path: string,
	headers: Record<string, string> = {},
): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		const doRequest = options.useHttps ? httpsRequest : httpRequest
		const req = doRequest(
			{
				host: options.host,
				port: options.port,
				path,
				method: 'GET',
				headers: { Accept: '*/*', ...headers },
				...(options.useHttps && options.ignoreCertErrors ? { rejectUnauthorized: false } : {}),
			},
			(res: IncomingMessage) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk: Buffer) => chunks.push(chunk))
				res.on('end', () => {
					resolve({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString('utf8'),
						setCookie: res.headers['set-cookie'] ?? [],
					})
				})
			},
		)

		req.setTimeout(options.timeout, () => {
			req.destroy(new DiscoveryError(`Request to ${path} timed out`))
		})
		req.on('error', (err: Error) => {
			reject(err instanceof DiscoveryError ? err : new DiscoveryError(err.message))
		})
		req.end()
	})
}

/**
 * Picks the CSRF cookie out of Set-Cookie headers.
 * The cookie name ends in a short form of the device ID, which differs per instance, so the name
 * is taken as given rather than reconstructed.
 */
export function findCsrfCookie(setCookie: string[]): { name: string; value: string } | undefined {
	for (const entry of setCookie) {
		const pair = entry.split(';')[0]?.trim()
		if (!pair) continue

		const separator = pair.indexOf('=')
		if (separator < 1) continue

		const name = pair.slice(0, separator)
		const value = pair.slice(separator + 1)
		if (name.startsWith('CSRF-Token-') && value.length > 0) {
			return { name, value }
		}
	}
	return undefined
}

/** Digs the API key out of whichever configuration shape the instance returned. */
export function apiKeyFromConfig(body: string): string | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch {
		return undefined
	}
	if (typeof parsed !== 'object' || parsed === null) return undefined

	const gui = (parsed as { gui?: unknown }).gui
	if (typeof gui !== 'object' || gui === null) return undefined

	const key = (gui as { apiKey?: unknown }).apiKey
	return typeof key === 'string' && key.length > 0 ? key : undefined
}

/**
 * Attempts to read the API key. Resolves with the key, or rejects with a DiscoveryError
 * explaining which step failed.
 */
export async function discoverApiKey(options: DiscoverOptions): Promise<string> {
	const landing = await fetchRaw(options, '/')

	if (landing.status === 401 || landing.status === 403) {
		throw new DiscoveryError('the web interface asked for a login, so the key cannot be read without one')
	}

	const cookie = findCsrfCookie(landing.setCookie)
	if (!cookie) {
		throw new DiscoveryError('the web interface did not hand out a CSRF token')
	}

	// The header name mirrors the cookie name, which is how the web interface itself does it.
	const headers = {
		Cookie: `${cookie.name}=${cookie.value}`,
		[`X-${cookie.name}`]: cookie.value,
	}

	// The configuration moved endpoint in Syncthing 1.12, so try the current one first.
	for (const path of ['/rest/config', '/rest/system/config']) {
		const response = await fetchRaw(options, path, headers)

		if (response.status === 401 || response.status === 403) {
			throw new DiscoveryError('the instance refused the request, so it is not open without a key')
		}
		if (response.status !== 200) continue

		const key = apiKeyFromConfig(response.body)
		if (key) return key
	}

	throw new DiscoveryError('the configuration could not be read, or contained no API key')
}
