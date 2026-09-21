// Smoke test: runs a fake Syncthing REST server and drives the built API client against it.
import http from 'node:http'
import { SyncthingApi, SyncthingApiError } from '../dist/api.js'
import { formatUptime } from '../dist/variables.js'

const API_KEY = 'test-key-123'
const seen = []

const routes = {
	'/rest/system/version': {
		version: 'v1.29.2',
		longVersion: 'syncthing v1.29.2 "Gold Grasshopper" (go1.23 windows-amd64)',
		os: 'windows',
		arch: 'amd64',
	},
	'/rest/system/status': { myID: 'ABCDEFG-HIJKLMN-OPQRSTU', uptime: 93784 },
	'/rest/system/connections': {
		connections: {
			'DEV1-AAAA': { connected: true, paused: false },
			'DEV2-BBBB': { connected: false, paused: true },
		},
		total: { inBytesTotal: 12345, outBytesTotal: 6789 },
	},
	'/rest/system/error': { errors: [{ when: '2026-01-01T00:00:00Z', message: 'disk full' }] },
	'/rest/config/devices': [
		{ deviceID: 'ABCDEFG-HIJKLMN-OPQRSTU', name: 'Regie-PC', paused: false },
		{ deviceID: 'DEV1-AAAA', name: 'Media 1', paused: false },
		{ deviceID: 'DEV2-BBBB', name: 'Media 2', paused: true },
	],
	'/rest/config/folders': [
		{ id: 'f1', label: 'Show', paused: false },
		{ id: 'f2', label: 'Archive', paused: true },
	],
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost')
	seen.push(`${req.method} ${url.pathname}`)

	if (req.headers['x-api-key'] !== API_KEY) {
		res.writeHead(403, { 'Content-Type': 'text/plain' })
		res.end('CSRF Error')
		return
	}
	if (url.pathname === '/rest/db/scan' || url.pathname === '/rest/system/error/clear') {
		res.writeHead(200, { 'Content-Type': 'text/plain' })
		res.end('')
		return
	}
	if (url.pathname === '/rest/slow') {
		// never respond, to exercise the timeout path
		return
	}
	const body = routes[url.pathname]
	if (!body) {
		res.writeHead(404)
		res.end('not found')
		return
	}
	res.writeHead(200, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify(body))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const mk = (apiKey, timeout = 3000) =>
	new SyncthingApi({ host: '127.0.0.1', port, apiKey, useHttps: false, ignoreCertErrors: true, timeout })

const api = mk(API_KEY)
let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) {
		console.log(`  PASS  ${name}`)
	} else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

console.log('1. GET requests')
const version = await api.get('/rest/system/version')
check('version parsed', version.version === 'v1.29.2', JSON.stringify(version))
const status = await api.get('/rest/system/status')
check('uptime parsed', status.uptime === 93784)
check('baseUrl', api.baseUrl === `http://127.0.0.1:${port}`, api.baseUrl)

console.log('2. POST with empty body response')
const scan = await api.post('/rest/db/scan')
check('empty response resolves to undefined', scan === undefined, String(scan))

console.log('3. Query parameters')
await api.get('/rest/system/version', { folder: 'f1', skip: undefined })
check('undefined query values dropped', seen.includes('GET /rest/system/version'))

console.log('4. Auth failure')
try {
	await mk('wrong-key').get('/rest/system/version')
	check('403 rejects', false, 'no error thrown')
} catch (err) {
	check('403 rejects with SyncthingApiError', err instanceof SyncthingApiError)
	check('isAuthFailure true', err.isAuthFailure === true, `status=${err.statusCode}`)
}

console.log('5. HTTP 404')
try {
	await api.get('/rest/nope')
	check('404 rejects', false, 'no error thrown')
} catch (err) {
	check('404 status recorded', err.statusCode === 404, String(err.statusCode))
	check('404 is not an auth failure', err.isAuthFailure === false)
}

console.log('6. Timeout')
try {
	await mk(API_KEY, 400).get('/rest/slow')
	check('timeout rejects', false, 'no error thrown')
} catch (err) {
	check('timeout message', /timed out/.test(err.message), err.message)
}

console.log('7. Connection refused')
try {
	await new SyncthingApi({
		host: '127.0.0.1',
		port: 1,
		apiKey: API_KEY,
		useHttps: false,
		ignoreCertErrors: true,
		timeout: 2000,
	}).get('/rest/system/version')
	check('refused rejects', false, 'no error thrown')
} catch (err) {
	check('refused rejects', err instanceof Error, err.message)
}

console.log('8. formatUptime')
check('93784s -> 1d 02:03:04', formatUptime(93784) === '1d 02:03:04', formatUptime(93784))
check('3661s -> 01:01:01', formatUptime(3661) === '01:01:01', formatUptime(3661))
check('0s -> 00:00:00', formatUptime(0) === '00:00:00', formatUptime(0))
check('negative clamps', formatUptime(-5) === '00:00:00', formatUptime(-5))

server.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
