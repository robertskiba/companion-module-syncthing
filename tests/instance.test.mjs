// End-to-end checks: the real module instance against a fake Syncthing, through Companion's
// instance contract. This is the level at which "it connects" can actually be verified.
import http from 'node:http'
const D = '../dist'
const ModuleInstance = (await import(`${D}/main.js`)).default

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

const waitFor = async (predicate, what, timeoutMs = 8000) => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (predicate()) return true
		await new Promise((r) => setTimeout(r, 25))
	}
	console.log(`  (timed out waiting for ${what})`)
	return false
}

/** A stand-in for what Companion hands a module instance. */
function makeContext() {
	const record = {
		statuses: [],
		logs: [],
		variables: {},
		savedConfig: undefined,
		savedSecrets: undefined,
		saveCount: 0,
	}

	const context = {
		_isInstanceContext: true,
		id: 'test-instance',
		label: 'Syncthing test',
		upgradeScripts: [],
		saveConfig: (config, secrets) => {
			record.saveCount++
			record.savedConfig = config
			record.savedSecrets = secrets
		},
		updateStatus: (status, message) => record.statuses.push({ status, message }),
		oscSend: () => {},
		recordAction: () => {},
		setActionDefinitions: () => {},
		subscribeActions: () => {},
		unsubscribeActions: () => {},
		setFeedbackDefinitions: () => {},
		unsubscribeFeedbacks: () => {},
		checkFeedbacks: () => {},
		checkAllFeedbacks: () => {},
		checkFeedbacksById: () => {},
		setPresetDefinitions: () => {},
		setVariableDefinitions: () => {},
		setVariableValues: (values) => Object.assign(record.variables, values),
		getVariableValue: (id) => record.variables[id],
		// The discovery socket binds but never delivers anything, which keeps the network out of
		// this test while still exercising the code path that opens it.
		sharedUdpSocketHandlers: new Map(),
		sharedUdpSocketJoin: async () => 'fake-handle',
		sharedUdpSocketLeave: async () => {},
		sharedUdpSocketSend: async () => {},
	}

	return { context, record }
}

/** A fake Syncthing that answers everything the module asks for. */
async function startSyncthing({ apiKey = 'the-real-key', requireKey = false, guiProtected = false } = {}) {
	const seen = []

	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost')
		seen.push({ path: url.pathname, key: req.headers['x-api-key'] })

		const send = (body) => {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(body))
		}

		// The landing page, which is where the CSRF token comes from.
		if (url.pathname === '/') {
			if (guiProtected) {
				res.writeHead(401)
				res.end('Not Authorized')
				return
			}
			res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'CSRF-Token-ABCDE=tok; Path=/' })
			res.end('<html></html>')
			return
		}

		const hasKey = req.headers['x-api-key'] === apiKey
		const hasCsrf = req.headers['x-csrf-token-abcde'] === 'tok'

		if (url.pathname === '/rest/config') {
			if (!hasKey && !hasCsrf) {
				res.writeHead(403)
				res.end('CSRF Error')
				return
			}
			send({ gui: { apiKey } })
			return
		}

		if (requireKey && !hasKey) {
			res.writeHead(403)
			res.end('Forbidden')
			return
		}

		switch (url.pathname) {
			case '/rest/system/version':
				return send({ version: 'v1.29.2', longVersion: 'syncthing v1.29.2', os: 'windows', arch: 'amd64' })
			case '/rest/system/status':
				return send({ myID: 'LOCAL1-AAAAAAA', uptime: 3661 })
			case '/rest/system/connections':
				return send({
					connections: {
						'REMOTE1-BBBBBBB': {
							connected: true,
							paused: false,
							address: '192.168.20.102:22000',
							clientVersion: 'v1.29.2',
						},
					},
					total: { inBytesTotal: 100, outBytesTotal: 200 },
				})
			case '/rest/system/error':
				return send({ errors: null })
			case '/rest/config/devices':
				return send([
					{ deviceID: 'LOCAL1-AAAAAAA', name: 'This PC', paused: false },
					{ deviceID: 'REMOTE1-BBBBBBB', name: 'Backup PC', paused: false },
				])
			case '/rest/config/folders':
				return send([{ id: 'show', label: 'Show', type: 'sendreceive', paused: false, devices: [] }])
			case '/rest/config/restart-required':
				return send({ requiresRestart: false })
			case '/rest/db/status':
				return send({
					state: 'idle',
					globalBytes: 1000,
					localBytes: 1000,
					inSyncBytes: 1000,
					needBytes: 0,
					needTotalItems: 0,
					pullErrors: 0,
					receiveOnlyChangedFiles: 0,
				})
			case '/rest/db/completion':
				return send({ completion: 100, globalBytes: 1000, needBytes: 0, needItems: 0, needDeletes: 0, sequence: 1 })
			case '/rest/events':
				// Answer the seed immediately, then hold the long poll open.
				if (url.searchParams.get('limit') === '1')
					return send([{ id: 5, globalID: 5, time: '', type: 'Starting', data: {} }])
				return
			default:
				res.writeHead(404)
				res.end('not found')
		}
	})

	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	return { server, seen, port: server.address().port }
}

const baseConfig = (port) => ({
	host: '127.0.0.1',
	port,
	useHttps: false,
	ignoreCertErrors: true,
	pollInterval: 1,
	autoApiKey: true,
	foundHosts: '',
})

console.log('1. connecting with a key that was typed in')
{
	const syncthing = await startSyncthing({ requireKey: true })
	const { context, record } = makeContext()
	const instance = new ModuleInstance(context)

	await instance.init(baseConfig(syncthing.port), true, { apiKey: 'the-real-key' })
	await waitFor(() => record.statuses.some((s) => s.status === 'ok'), 'the connection to come up')

	check('the status reaches ok', record.statuses.at(-1)?.status === 'ok', JSON.stringify(record.statuses))
	check('the version is published', record.variables.version === 'v1.29.2', String(record.variables.version))
	check('the uptime is formatted', record.variables.uptime === '01:01:01', String(record.variables.uptime))
	check('the remote device is counted', record.variables.devices_total === 1, String(record.variables.devices_total))
	check('the local device is not counted as remote', record.variables.device_name === 'This PC')
	check('the folder is counted', record.variables.folders_total === 1, String(record.variables.folders_total))
	check(
		'folder variables exist by id',
		record.variables.folder_show_state === 'idle',
		String(record.variables.folder_show_state),
	)
	check('everything reports in sync', record.variables.all_in_sync === 'true', String(record.variables.all_in_sync))
	check('nothing was saved back', record.saveCount === 0, String(record.saveCount))

	await instance.destroy()
	syncthing.server.close()
}

console.log('2. connecting after finding the key by itself')
{
	const syncthing = await startSyncthing({ requireKey: true, apiKey: 'found-key' })
	const { context, record } = makeContext()
	const instance = new ModuleInstance(context)

	// The key field is left empty, which is what a fresh connection looks like.
	await instance.init(baseConfig(syncthing.port), true, { apiKey: '' })

	await waitFor(() => record.saveCount > 0, 'the key to be saved')
	check('the key is found and saved', record.savedSecrets?.apiKey === 'found-key', JSON.stringify(record.savedSecrets))

	// This is the regression: the key was found, saved, and then nothing happened.
	const cameUp = await waitFor(() => record.statuses.some((s) => s.status === 'ok'), 'the connection to come up')
	check('the connection comes up after the key is found', cameUp, JSON.stringify(record.statuses))
	check(
		'it does not sit at looking for the key',
		record.statuses.at(-1)?.status === 'ok',
		JSON.stringify(record.statuses.at(-1)),
	)
	check(
		'the found key is actually used',
		syncthing.seen.some((r) => r.path === '/rest/system/status' && r.key === 'found-key'),
	)
	check('the version is published', record.variables.version === 'v1.29.2', String(record.variables.version))

	await instance.destroy()
	syncthing.server.close()
}

console.log('3. a protected web interface stops at a clear message')
{
	const syncthing = await startSyncthing({ requireKey: true, guiProtected: true })
	const { context, record } = makeContext()
	const instance = new ModuleInstance(context)

	await instance.init(baseConfig(syncthing.port), true, { apiKey: '' })
	await waitFor(
		() => record.statuses.some((s) => s.status === 'bad_config' && s.message !== 'No host chosen yet'),
		'the failure',
	)

	check('nothing is saved', record.saveCount === 0, String(record.saveCount))
	check(
		'the status says the key is missing',
		record.statuses.at(-1)?.message === 'No API key configured',
		JSON.stringify(record.statuses.at(-1)),
	)

	await instance.destroy()
	syncthing.server.close()
}

console.log('4. no host chosen means nothing is contacted')
{
	const syncthing = await startSyncthing()
	const { context, record } = makeContext()
	const instance = new ModuleInstance(context)

	await instance.init({ ...baseConfig(syncthing.port), host: '' }, true, { apiKey: '' })
	await new Promise((r) => setTimeout(r, 300))

	check('the status says so', record.statuses.at(-1)?.message === 'No host chosen yet', JSON.stringify(record.statuses))
	// The search checks this machine on its own, which is not the connection contacting anything.
	const asConnection = syncthing.seen.filter((r) => r.path !== '/rest/noauth/health')
	check('the connection contacted nothing', asConnection.length === 0, JSON.stringify(asConnection))
	check(
		'only the search looked',
		syncthing.seen.every((r) => r.path === '/rest/noauth/health'),
		JSON.stringify(syncthing.seen),
	)
	check('the connection variable is false', record.variables.connected === 'false')

	await instance.destroy()
	syncthing.server.close()
}

console.log('5. picking a found instance fills in the host')
{
	const syncthing = await startSyncthing({ requireKey: true, apiKey: 'found-key' })
	const { context, record } = makeContext()
	const instance = new ModuleInstance(context)

	await instance.init({ ...baseConfig(syncthing.port), host: '' }, true, { apiKey: '' })
	await new Promise((r) => setTimeout(r, 200))
	check('nothing is contacted while the host is empty', record.statuses.at(-1)?.message === 'No host chosen yet')

	// This is what selecting an entry in the found list sends back.
	await instance.configUpdated({ ...baseConfig(syncthing.port), host: '', foundHosts: '127.0.0.1' }, { apiKey: '' })

	check('the picked address becomes the host', instance.config.host === '127.0.0.1', instance.config.host)
	check('the picker resets itself', instance.config.foundHosts === '', JSON.stringify(instance.config.foundHosts))
	check('the choice is persisted', record.savedConfig?.host === '127.0.0.1', JSON.stringify(record.savedConfig?.host))

	const cameUp = await waitFor(() => record.statuses.some((s) => s.status === 'ok'), 'the connection to come up')
	check('it connects to the picked instance', cameUp, JSON.stringify(record.statuses.at(-1)))

	await instance.destroy()
	syncthing.server.close()
}

console.log('6. an unreachable instance reports a connection failure')
{
	const { context, record } = makeContext()
	const instance = new ModuleInstance(context)

	// Port 1 refuses immediately.
	await instance.init({ ...baseConfig(1), autoApiKey: false }, true, { apiKey: 'k' })
	await waitFor(() => record.statuses.some((s) => s.status === 'connection_failure'), 'the failure')

	check(
		'the failure is reported',
		record.statuses.some((s) => s.status === 'connection_failure'),
		JSON.stringify(record.statuses),
	)
	check('the connection variable is false', record.variables.connected === 'false')

	await instance.destroy()
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
