// Stage 3 checks: pause/resume resolution and the control endpoints over HTTP.
import http from 'node:http'
const D = '../dist'
const { SyncthingApi } = await import(`${D}/api.js`)
const { resolvePause } = await import(`${D}/actions.js`)

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

console.log('1. resolvePause')
check('pause always pauses', resolvePause('pause', false) === true)
check('pause on an already paused target still pauses', resolvePause('pause', true) === true)
check('resume always resumes', resolvePause('resume', true) === false)
check('resume on a running target still resumes', resolvePause('resume', false) === false)
check('toggle from running', resolvePause('toggle', false) === true)
check('toggle from paused', resolvePause('toggle', true) === false)
check('toggle without a known state gives up', resolvePause('toggle', undefined) === undefined)
check('pause works on an unknown target', resolvePause('pause', undefined) === true)
check('resume works on an unknown target', resolvePause('resume', undefined) === false)

console.log('2. control endpoints over HTTP')
const seen = []
const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost')
	let body = ''
	req.on('data', (chunk) => (body += chunk))
	req.on('end', () => {
		seen.push({ method: req.method, path: url.pathname, query: url.search, body })
		res.writeHead(200, { 'Content-Type': 'text/plain' })
		res.end('')
	})
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const api = new SyncthingApi({
	host: '127.0.0.1',
	port: server.address().port,
	apiKey: 'k',
	useHttps: false,
	ignoreCertErrors: true,
	timeout: 3000,
})

await api.patch('/rest/config/folders/my%20folder', { paused: true })
const patch = seen.at(-1)
check('config change uses PATCH', patch.method === 'PATCH', patch.method)
// The server sees the path still percent-encoded, which is what a folder id with spaces needs.
check('folder id stays encoded in the path', patch.path === '/rest/config/folders/my%20folder', patch.path)
check('body carries only the changed field', patch.body === '{"paused":true}', patch.body)

await api.post('/rest/system/pause', { device: 'DEV1-AAAA' })
check('device pause hits system/pause', seen.at(-1).path === '/rest/system/pause')
check('device id is passed as a query', seen.at(-1).query === '?device=DEV1-AAAA', seen.at(-1).query)

await api.post('/rest/system/resume')
check('resume without a device has no query', seen.at(-1).query === '', seen.at(-1).query)
check('resume sends no body', seen.at(-1).body === '', seen.at(-1).body)

await api.post('/rest/db/override', { folder: 'show' })
check('override hits db/override', seen.at(-1).path === '/rest/db/override')
await api.post('/rest/db/revert', { folder: 'show' })
check('revert hits db/revert', seen.at(-1).path === '/rest/db/revert')

server.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
