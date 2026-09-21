// Stage 4 checks: the long-polling event stream, driven against a fake Syncthing.
import http from 'node:http'
const D = '../dist'
const { SyncthingApi } = await import(`${D}/api.js`)
const { EventStream, SUBSCRIBED_EVENTS, eventString, eventNumber } = await import(`${D}/events.js`)

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

const waitFor = async (predicate, what, timeoutMs = 5000) => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (predicate()) return true
		await new Promise((r) => setTimeout(r, 20))
	}
	console.log(`  (timed out waiting for ${what})`)
	return false
}

console.log('1. event field helpers')
check('reads a string', eventString({ folder: 'show' }, 'folder') === 'show')
check('falls back to the second key', eventString({ id: 'abc' }, 'folder', 'id') === 'abc')
check('skips an empty string', eventString({ folder: '', id: 'abc' }, 'folder', 'id') === 'abc')
check('missing gives undefined', eventString({}, 'folder') === undefined)
check('a number is not a string', eventString({ folder: 7 }, 'folder') === undefined)
check('reads a number', eventNumber({ needBytes: 5 }, 'needBytes') === 5)
check('zero is a valid number', eventNumber({ needBytes: 0 }, 'needBytes') === 0)
check('a string is not a number', eventNumber({ needBytes: '5' }, 'needBytes') === undefined)
check('NaN is rejected', eventNumber({ needBytes: NaN }, 'needBytes') === undefined)

console.log('2. subscription list')
check('folder summary is subscribed', SUBSCRIBED_EVENTS.includes('FolderSummary'))
check('device connect is subscribed', SUBSCRIBED_EVENTS.includes('DeviceConnected'))
check('config changes are subscribed', SUBSCRIBED_EVENTS.includes('ConfigSaved'))
check('noisy per-file events are left out', !SUBSCRIBED_EVENTS.includes('ItemFinished'))
check('download progress is left out', !SUBSCRIBED_EVENTS.includes('DownloadProgress'))
check('local changes are left out', !SUBSCRIBED_EVENTS.includes('LocalChangeDetected'))

/** A fake events endpoint whose answers are supplied by a queue of responder functions. */
async function startFake(responder) {
	const requests = []
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost')
		const query = Object.fromEntries(url.searchParams.entries())
		requests.push(query)

		const body = responder(query, requests.length)
		if (body === 'hang') return // never answers, to exercise abort on stop

		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(body))
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	return { server, requests, port: server.address().port }
}

const makeApi = (port) =>
	new SyncthingApi({ host: '127.0.0.1', port, apiKey: 'k', useHttps: false, ignoreCertErrors: true, timeout: 5000 })

const ev = (id, type, data = {}) => ({ id, globalID: id, time: '2026-01-01T00:00:00Z', type, data })

console.log('3. seeding and following')
{
	const batches = []
	let restarts = 0
	const connectionChanges = []

	const fake = await startFake((query, n) => {
		if (n === 1) return [ev(42, 'Starting')] // the seed call, id only
		if (n === 2) return [ev(43, 'StateChanged', { folder: 'show', to: 'syncing' })]
		return [] // then nothing happens
	})

	const stream = new EventStream({
		api: makeApi(fake.port),
		onEvents: (events) => void batches.push(events),
		onRestart: () => void restarts++,
		onConnectionChange: (c) => void connectionChanges.push(c),
		log: () => {},
	})
	stream.start()

	await waitFor(() => fake.requests.length >= 3, 'three requests')
	stream.stop()

	const seed = fake.requests[0]
	check('seed asks for a single event', seed.since === '0' && seed.limit === '1', JSON.stringify(seed))
	check('seed uses a short timeout', seed.timeout === '1', seed.timeout)
	check('seed carries no type filter', seed.events === undefined, seed.events)

	const follow = fake.requests[1]
	check('follows from the seeded id', follow.since === '42', follow.since)
	check('follow uses a long timeout', Number(follow.timeout) >= 30, follow.timeout)
	check('follow filters by type', follow.events?.includes('FolderSummary') === true, follow.events)
	check('filter is comma separated', follow.events?.split(',').length === SUBSCRIBED_EVENTS.length, follow.events)

	check('the batch reached the handler', batches.length === 1, String(batches.length))
	check('the event is passed through', batches[0]?.[0]?.type === 'StateChanged', JSON.stringify(batches[0]))
	check('since advanced past the batch', fake.requests[2]?.since === '43', fake.requests[2]?.since)
	check('connection was reported', connectionChanges[0] === true, JSON.stringify(connectionChanges))
	check('no restart was reported', restarts === 0, String(restarts))

	fake.server.close()
}

console.log('4. an empty answer is not an error')
{
	const batches = []
	const fake = await startFake((query, n) => (n === 1 ? [ev(10, 'Starting')] : []))

	const stream = new EventStream({
		api: makeApi(fake.port),
		onEvents: (events) => void batches.push(events),
		onRestart: () => {},
		onConnectionChange: () => {},
		log: () => {},
	})
	stream.start()

	await waitFor(() => fake.requests.length >= 3, 'repeated polling')
	stream.stop()

	check('the loop keeps going', fake.requests.length >= 3, String(fake.requests.length))
	check('no empty batch is handed over', batches.length === 0, String(batches.length))
	check('since does not move', fake.requests[2]?.since === '10', fake.requests[2]?.since)

	fake.server.close()
}

console.log('5. a restarted Syncthing is noticed')
{
	let restarts = 0
	const batches = []

	// After seeding at 500, the instance restarts and its ids begin again at 1.
	const fake = await startFake((query, n) => {
		if (n === 1) return [ev(500, 'Starting')]
		if (n === 2) return [ev(1, 'StateChanged', { folder: 'show', to: 'idle' })]
		if (n === 3) return [ev(1, 'Starting')]
		return []
	})

	const stream = new EventStream({
		api: makeApi(fake.port),
		onEvents: (events) => void batches.push(events),
		onRestart: () => void restarts++,
		onConnectionChange: () => {},
		log: () => {},
	})
	stream.start()

	await waitFor(() => restarts >= 1, 'a restart to be reported')
	await waitFor(() => fake.requests.length >= 3, 'a re-seed')
	stream.stop()

	check('the restart was reported', restarts >= 1, String(restarts))
	check('the stale batch was not applied', batches.length === 0, JSON.stringify(batches))
	check('the stream re-seeds from zero', fake.requests[2]?.since === '0', fake.requests[2]?.since)
	check('re-seed asks for one event again', fake.requests[2]?.limit === '1', fake.requests[2]?.limit)

	fake.server.close()
}

console.log('6. a Starting event also triggers a full re-read')
{
	let restarts = 0
	const fake = await startFake((query, n) => {
		if (n === 1) return [ev(5, 'Starting')]
		if (n === 2) return [ev(6, 'StartupComplete', { myID: 'ABC' })]
		return []
	})

	const stream = new EventStream({
		api: makeApi(fake.port),
		onEvents: () => {},
		onRestart: () => void restarts++,
		onConnectionChange: () => {},
		log: () => {},
	})
	stream.start()

	await waitFor(() => restarts >= 1, 'a startup event to be reported')
	stream.stop()
	check('startup triggers a re-read', restarts >= 1, String(restarts))

	fake.server.close()
}

console.log('7. stopping ends the loop and drops the open request')
{
	const fake = await startFake((query, n) => (n === 1 ? [ev(1, 'Starting')] : 'hang'))
	const changes = []

	const stream = new EventStream({
		api: makeApi(fake.port),
		onEvents: () => {},
		onRestart: () => {},
		onConnectionChange: (c) => void changes.push(c),
		log: () => {},
	})
	stream.start()

	await waitFor(() => fake.requests.length >= 2, 'the long poll to be open')
	const before = fake.requests.length
	stream.stop()

	check('the stream reports itself as stopped', stream.connected === false)
	await new Promise((r) => setTimeout(r, 400))
	check('no further requests are made', fake.requests.length === before, String(fake.requests.length))

	fake.server.close()
}

console.log('8. a broken instance is retried rather than given up on')
{
	const logs = []
	const stream = new EventStream({
		// Port 1 refuses immediately, which is the fastest stand-in for an instance that is gone.
		api: makeApi(1),
		onEvents: () => {},
		onRestart: () => {},
		onConnectionChange: () => {},
		log: (level, message) => logs.push(`${level}: ${message}`),
	})
	stream.start()

	await waitFor(() => logs.length >= 1, 'a failure to be logged')
	stream.stop()

	check('the failure is logged once', logs.length === 1, JSON.stringify(logs))
	check('the log says it will retry', /[Rr]etry/.test(logs[0] ?? ''), logs[0])
	check('the stream is not connected', stream.connected === false)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
