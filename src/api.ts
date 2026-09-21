import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** Connection details needed to talk to a Syncthing instance. */
export interface SyncthingApiOptions {
	host: string
	port: number
	apiKey: string
	useHttps: boolean
	/** Accept the self-signed certificate Syncthing generates for its own GUI. */
	ignoreCertErrors: boolean
	/** Timeout in milliseconds for ordinary requests. */
	timeout: number
}

/** An error carrying the HTTP status code, so callers can tell auth failures from outages. */
export class SyncthingApiError extends Error {
	readonly statusCode: number | undefined
	readonly body: string | undefined

	constructor(message: string, statusCode?: number, body?: string) {
		super(message)
		this.name = 'SyncthingApiError'
		this.statusCode = statusCode
		this.body = body
	}

	/** True when the API key was missing, wrong, or rejected. */
	get isAuthFailure(): boolean {
		return this.statusCode === 401 || this.statusCode === 403
	}
}

interface RequestConfig {
	method: 'GET' | 'POST'
	path: string
	query?: Record<string, string | number | undefined>
	body?: unknown
	/** Overrides the configured timeout, used by the long-polling event stream. */
	timeout?: number
	signal?: AbortSignal
}

/**
 * A thin client for the Syncthing REST API.
 *
 * Built on node:http/node:https rather than fetch so that self-signed certificates
 * and per-request timeouts can be handled without pulling in a dependency.
 */
export class SyncthingApi {
	#options: SyncthingApiOptions

	constructor(options: SyncthingApiOptions) {
		this.#options = options
	}

	get options(): SyncthingApiOptions {
		return this.#options
	}

	/** The base URL of the instance, for display in logs and errors. */
	get baseUrl(): string {
		return `${this.#options.useHttps ? 'https' : 'http'}://${this.#options.host}:${this.#options.port}`
	}

	async get<T>(path: string, query?: RequestConfig['query'], extra?: Partial<RequestConfig>): Promise<T> {
		return this.#request<T>({ method: 'GET', path, query, ...extra })
	}

	async post<T>(path: string, query?: RequestConfig['query'], body?: unknown): Promise<T> {
		return this.#request<T>({ method: 'POST', path, query, body })
	}

	async #request<T>(config: RequestConfig): Promise<T> {
		const { host, port, apiKey, useHttps, ignoreCertErrors } = this.#options
		const timeout = config.timeout ?? this.#options.timeout

		const search = new URLSearchParams()
		for (const [key, value] of Object.entries(config.query ?? {})) {
			if (value !== undefined) search.append(key, String(value))
		}
		const query = search.toString()
		const fullPath = query ? `${config.path}?${query}` : config.path

		const payload = config.body === undefined ? undefined : JSON.stringify(config.body)

		const headers: Record<string, string> = {
			'X-API-Key': apiKey,
			Accept: 'application/json',
		}
		if (payload !== undefined) {
			headers['Content-Type'] = 'application/json'
			headers['Content-Length'] = String(Buffer.byteLength(payload))
		}

		return new Promise<T>((resolve, reject) => {
			const doRequest = useHttps ? httpsRequest : httpRequest

			const req = doRequest(
				{
					host,
					port,
					path: fullPath,
					method: config.method,
					headers,
					signal: config.signal,
					...(useHttps && ignoreCertErrors ? { rejectUnauthorized: false } : {}),
				},
				(res: IncomingMessage) => {
					const chunks: Buffer[] = []
					res.on('data', (chunk: Buffer) => chunks.push(chunk))
					res.on('end', () => {
						const text = Buffer.concat(chunks).toString('utf8')
						const status = res.statusCode ?? 0

						if (status < 200 || status >= 300) {
							reject(
								new SyncthingApiError(
									`${config.method} ${config.path} failed with HTTP ${status}`,
									status,
									text.slice(0, 500),
								),
							)
							return
						}

						// Several endpoints (restart, shutdown, rescan) answer with a bare "OK".
						if (text.trim().length === 0) {
							resolve(undefined as T)
							return
						}
						try {
							resolve(JSON.parse(text) as T)
						} catch {
							resolve(text as T)
						}
					})
				},
			)

			req.setTimeout(timeout, () => {
				req.destroy(new SyncthingApiError(`${config.method} ${config.path} timed out after ${timeout} ms`))
			})

			req.on('error', (err: Error) => {
				reject(err instanceof SyncthingApiError ? err : new SyncthingApiError(err.message))
			})

			if (payload !== undefined) req.write(payload)
			req.end()
		})
	}
}
