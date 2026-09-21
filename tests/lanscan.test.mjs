// Checks for finding Syncthing instances on the network.
import { EventEmitter } from 'node:events'
import http from 'node:http'
const D = '../dist'
const {
	parseAnnouncement,
	base32Encode,
	shortDeviceId,
	LanScanner,
	createHttpProbe,
	DISCOVERY_PORT,
	DISCOVERY_MAGIC,
	LOCAL_ADDRESS,
} = await import(`${D}/lanscan.js`)

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

/** Builds a protobuf varint, so the test encodes packets the same way Syncthing does. */
function varint(value) {
	const bytes = []
	let rest = value
	while (rest > 127) {
		bytes.push((rest % 128) + 128)
		rest = Math.floor(rest / 128)
	}
	bytes.push(rest)
	return Buffer.from(bytes)
}

/** Builds an announcement packet: the magic word followed by the Announce message. */
function announcement({ id, addresses = [], instanceId = 0, magic = DISCOVERY_MAGIC } = {}) {
	const head = Buffer.alloc(4)
	head.writeUInt32BE(magic >>> 0, 0)

	const parts = [head]
	if (id) parts.push(varint((1 << 3) | 2), varint(id.length), id)
	for (const address of addresses) {
		const encoded = Buffer.from(address, 'utf8')
		parts.push(varint((2 << 3) | 2), varint(encoded.length), encoded)
	}
	if (instanceId) parts.push(varint((3 << 3) | 0), varint(instanceId))

	return Buffer.concat(parts)
}

const deviceId = Buffer.alloc(32, 0)
deviceId.write('example-device-id-bytes-32-long!', 0, 'utf8')

console.log('1. base32 and the short device ID')
check('empty input', base32Encode(Buffer.alloc(0)) === '')
check('known vector for "f"', base32Encode(Buffer.from('f')) === 'MY', base32Encode(Buffer.from('f')))
check('known vector for "fo"', base32Encode(Buffer.from('fo')) === 'MZXQ', base32Encode(Buffer.from('fo')))
check('known vector for "foo"', base32Encode(Buffer.from('foo')) === 'MZXW6', base32Encode(Buffer.from('foo')))
check('known vector for "foob"', base32Encode(Buffer.from('foob')) === 'MZXW6YQ', base32Encode(Buffer.from('foob')))
check('known vector for "fooba"', base32Encode(Buffer.from('fooba')) === 'MZXW6YTB', base32Encode(Buffer.from('fooba')))
check(
	'known vector for "foobar"',
	base32Encode(Buffer.from('foobar')) === 'MZXW6YTBOI',
	base32Encode(Buffer.from('foobar')),
)
check('a 32 byte id gives 52 characters', base32Encode(deviceId).length === 52, String(base32Encode(deviceId).length))
check('the short id is seven characters', shortDeviceId(deviceId).length === 7, shortDeviceId(deviceId))
check('the short id is the start of the full encoding', base32Encode(deviceId).startsWith(shortDeviceId(deviceId)))
check('only the Syncthing alphabet is used', /^[A-Z2-7]+$/.test(base32Encode(deviceId)), base32Encode(deviceId))

console.log('2. parsing announcements')
{
	const packet = announcement({ id: deviceId, addresses: ['tcp://192.168.1.5:22000'], instanceId: 12345 })
	const parsed = parseAnnouncement(packet)
	check('a well formed packet parses', parsed !== undefined)
	check('the device id comes through', parsed?.id.equals(deviceId) === true)
	check(
		'the addresses come through',
		parsed?.addresses[0] === 'tcp://192.168.1.5:22000',
		JSON.stringify(parsed?.addresses),
	)
	check('the instance id comes through', parsed?.instanceId === 12345, String(parsed?.instanceId))
}
{
	const many = announcement({ id: deviceId, addresses: ['tcp://10.0.0.1:22000', 'relay://10.0.0.9:22067'] })
	check('several addresses are collected', parseAnnouncement(many)?.addresses.length === 2)
}
{
	const large = announcement({ id: deviceId, instanceId: 9007199254740991 })
	check('a large instance id survives', parseAnnouncement(large)?.instanceId === 9007199254740991)
}
check(
	'a wrong magic word is rejected',
	parseAnnouncement(announcement({ id: deviceId, magic: 0x11223344 })) === undefined,
)
check('an empty packet is rejected', parseAnnouncement(Buffer.alloc(0)) === undefined)
check('a packet with only the magic word is rejected', parseAnnouncement(announcement({})) === undefined)
check('random noise is rejected', parseAnnouncement(Buffer.from('hello there, not syncthing')) === undefined)
{
	// A length that runs past the end of the packet must not read out of bounds.
	const truncated = Buffer.concat([announcement({ id: deviceId }).subarray(0, 10)])
	check('a truncated packet is rejected', parseAnnouncement(truncated) === undefined)
}
{
	// Unknown fields are what a future protocol version would add; they must be skipped.
	const head = Buffer.alloc(4)
	head.writeUInt32BE(DISCOVERY_MAGIC >>> 0, 0)
	const extra = Buffer.concat([
		head,
		varint((9 << 3) | 0),
		varint(42), // unknown varint field
		varint((1 << 3) | 2),
		varint(deviceId.length),
		deviceId,
		varint((8 << 3) | 5),
		Buffer.alloc(4), // unknown 32 bit field
	])
	check('unknown fields are skipped', parseAnnouncement(extra)?.id.equals(deviceId) === true)
}

console.log('3. the reachability probe')
{
	const server = http.createServer((req, res) => {
		if (req.url === '/rest/noauth/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end('{"status":"OK"}')
		} else {
			res.writeHead(404)
			res.end()
		}
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const port = server.address().port

	const probe = createHttpProbe(port, true, 1500)
	check('a listening instance is reachable', (await probe('127.0.0.1')) === 'http')

	const closedProbe = createHttpProbe(1, true, 1500)
	check('a closed port is not reachable', (await closedProbe('127.0.0.1')) === undefined)

	server.close()
}

/** A stand-in for the shared UDP socket Companion hands out. */
class FakeSocket extends EventEmitter {
	constructor() {
		super()
		this.boundPort = undefined
		this.closed = false
	}
	bind(port, _address, callback) {
		this.boundPort = port
		if (callback) callback()
	}
	close(callback) {
		this.closed = true
		if (callback) callback()
	}
	send() {}
}

console.log('4. the scanner')
{
	const socket = new FakeSocket()
	const probed = []
	const logs = []
	let changes = 0

	const scanner = new LanScanner({
		createSocket: () => socket,
		probe: async (address) => {
			probed.push(address)
			return address === '192.168.1.5' ? 'http' : undefined
		},
		ownAddresses: () => [],
		resolveName: async (address) => (address === '192.168.1.5' ? 'media-pc.lan' : undefined),
		onChange: () => void changes++,
		log: (level, message) => logs.push(`${level}: ${message}`),
	})
	scanner.start()

	// The check of this machine runs alongside, so it is kept out of the counts below.
	const remoteProbes = () => probed.filter((a) => a !== LOCAL_ADDRESS)

	check('it binds the discovery port', socket.boundPort === DISCOVERY_PORT, String(socket.boundPort))
	check('it listens on every interface', DISCOVERY_PORT === 21027)

	const packet = announcement({ id: deviceId, addresses: ['tcp://192.168.1.5:22000'] })
	socket.emit('message', packet, { address: '192.168.1.5', port: 21027 })
	socket.emit('message', packet, { address: '192.168.1.9', port: 21027 })

	await waitFor(() => scanner.hosts.length >= 1, 'a reachable host')

	check('only the reachable host is listed', scanner.hosts.length === 1, JSON.stringify(scanner.hosts))
	check('the address is recorded', scanner.hosts[0]?.address === '192.168.1.5')
	check('the scheme is recorded', scanner.hosts[0]?.scheme === 'http')
	check('the short device id is recorded', scanner.hosts[0]?.shortId === shortDeviceId(deviceId))
	check('the resolved name is recorded', scanner.hosts[0]?.hostname === 'media-pc.lan', scanner.hosts[0]?.hostname)
	check(
		'the sync addresses are kept',
		scanner.hosts[0]?.syncAddresses[0] === 'tcp://192.168.1.5:22000',
		JSON.stringify(scanner.hosts[0]?.syncAddresses),
	)
	check(
		'the name appears in the log line',
		logs.some((l) => l.includes('media-pc.lan')),
		JSON.stringify(logs),
	)
	check('both hosts were probed', remoteProbes().length === 2, JSON.stringify(probed))
	check(
		'the find is logged',
		logs.some((l) => l.includes('192.168.1.5')),
		JSON.stringify(logs),
	)
	check('a change was reported', changes === 1, String(changes))

	// Repeat announcements must not cause repeated probing.
	socket.emit('message', packet, { address: '192.168.1.5', port: 21027 })
	socket.emit('message', packet, { address: '192.168.1.9', port: 21027 })
	await new Promise((r) => setTimeout(r, 200))
	check('a known host is not probed again', remoteProbes().length === 2, JSON.stringify(probed))
	check('an unreachable host is not probed again', probed.filter((a) => a === '192.168.1.9').length === 1)

	// After a settings change, failed hosts deserve another try.
	scanner.retryUnreachable()
	socket.emit('message', packet, { address: '192.168.1.9', port: 21027 })
	await waitFor(() => remoteProbes().length >= 3, 'a retry')
	check('retryUnreachable lets a host be probed again', remoteProbes().length === 3, JSON.stringify(probed))

	scanner.stop()
	check('stopping closes the socket', socket.closed === true)

	socket.emit('message', packet, { address: '192.168.1.77', port: 21027 })
	await new Promise((r) => setTimeout(r, 100))
	check('nothing is probed after stopping', probed.filter((a) => a === '192.168.1.77').length === 0)
}

console.log('5. a host whose name cannot be resolved is still listed')
{
	const socket = new FakeSocket()
	const scanner = new LanScanner({
		createSocket: () => socket,
		probe: async (a) => (a === LOCAL_ADDRESS ? undefined : 'https'),
		resolveName: async () => undefined,
		onChange: () => {},
		log: () => {},
	})
	scanner.start()
	socket.emit('message', announcement({ id: deviceId }), { address: '10.0.0.7', port: 21027 })
	await waitFor(() => scanner.hosts.length >= 1, 'the host')
	check('the host is listed without a name', scanner.hosts[0]?.address === '10.0.0.7')
	check('the missing name is undefined', scanner.hosts[0]?.hostname === undefined)
	check('an https instance is recorded as such', scanner.hosts[0]?.scheme === 'https')
	scanner.stop()
}

{
	const socket = new FakeSocket()
	const scanner = new LanScanner({
		createSocket: () => socket,
		probe: async (a) => (a === LOCAL_ADDRESS ? undefined : 'http'),
		resolveName: async () => {
			throw new Error('dns exploded')
		},
		onChange: () => {},
		log: () => {},
	})
	scanner.start()
	socket.emit('message', announcement({ id: deviceId }), { address: '10.0.0.8', port: 21027 })
	await new Promise((r) => setTimeout(r, 200))
	check(
		'a failing name lookup does not lose the host',
		scanner.hosts.length === 1 && scanner.hosts[0]?.address === '10.0.0.8',
		JSON.stringify(scanner.hosts),
	)
	check('the host simply has no name', scanner.hosts[0]?.hostname === undefined)
	scanner.stop()
}

console.log('6. packets that are not Syncthing are ignored')
{
	const socket = new FakeSocket()
	const probed = []
	const scanner = new LanScanner({
		createSocket: () => socket,
		probe: async (address) => {
			if (address === LOCAL_ADDRESS) return undefined
			probed.push(address)
			return 'http'
		},
		onChange: () => {},
		log: () => {},
	})
	scanner.start()

	socket.emit('message', Buffer.from('some other broadcast'), { address: '192.168.1.50', port: 21027 })
	await new Promise((r) => setTimeout(r, 150))
	check('an unrelated broadcast is ignored', probed.length === 0, JSON.stringify(probed))

	scanner.stop()
}

console.log('7. the instance on this machine is searched for, not assumed')
{
	const socket = new FakeSocket()
	const probed = []
	const scanner = new LanScanner({
		createSocket: () => socket,
		probe: async (address) => {
			probed.push(address)
			return address === LOCAL_ADDRESS ? 'http' : undefined
		},
		ownAddresses: () => ['192.168.20.100'],
		onChange: () => {},
		log: () => {},
	})
	scanner.start()

	await waitFor(() => scanner.hosts.length >= 1, 'the local instance')
	check('this machine is probed without any announcement', probed.includes(LOCAL_ADDRESS), JSON.stringify(probed))
	check('a reachable local instance is listed', scanner.hosts[0]?.address === LOCAL_ADDRESS)
	check('it is labelled as this machine', scanner.hosts[0]?.hostname === 'this machine')

	// Its own broadcast supplies the device ID that a probe alone cannot give.
	socket.emit('message', announcement({ id: deviceId }), { address: '192.168.20.100', port: 21027 })
	await waitFor(() => scanner.hosts[0]?.shortId === shortDeviceId(deviceId), 'the device id')
	check('its device id comes from its own announcement', scanner.hosts[0]?.shortId === shortDeviceId(deviceId))

	scanner.stop()
}

{
	// Bound to a single network address, the interface is not reachable over 127.0.0.1 at all.
	const socket = new FakeSocket()
	const scanner = new LanScanner({
		createSocket: () => socket,
		probe: async (address) => (address === '192.168.20.100' ? 'http' : undefined),
		ownAddresses: () => ['192.168.20.100'],
		onChange: () => {},
		log: () => {},
	})
	scanner.start()

	socket.emit('message', announcement({ id: deviceId }), { address: '192.168.20.100', port: 21027 })
	await waitFor(() => scanner.hosts.length >= 1, 'the host under its network address')

	check('it is listed under the address that answers', scanner.hosts[0]?.address === '192.168.20.100')
	check(
		'localhost is not offered when it does not answer',
		!scanner.hosts.some((h) => h.address === LOCAL_ADDRESS),
		JSON.stringify(scanner.hosts),
	)
	scanner.stop()
}

console.log('7b. a host that failed is checked again after a while')
{
	const socket = new FakeSocket()
	const probed = []
	const logs = []
	let reachable = false

	const scanner = new LanScanner({
		createSocket: () => socket,
		probe: async (address) => {
			if (address === LOCAL_ADDRESS) return undefined
			probed.push(address)
			return reachable ? 'http' : undefined
		},
		ownAddresses: () => [],
		resolveName: async () => undefined,
		onChange: () => {},
		log: (level, message) => logs.push(`${level}: ${message}`),
	})
	scanner.start()

	const packet = announcement({ id: deviceId })
	socket.emit('message', packet, { address: '192.168.20.102', port: 21027 })
	await waitFor(() => probed.length >= 1, 'the first check')
	check('it is checked once', probed.length === 1, JSON.stringify(probed))
	check('nothing is listed yet', scanner.hosts.length === 0)

	// Once the check has finished and failed, announcing again must not cause another one.
	await waitFor(() => logs.some((l) => /did not answer/.test(l)), 'the failed check to be recorded')
	socket.emit('message', packet, { address: '192.168.20.102', port: 21027 })
	await new Promise((r) => setTimeout(r, 150))
	check('it is not checked again immediately', probed.length === 1, JSON.stringify(probed))
	check(
		'the log says why it was skipped',
		logs.some((l) => /still waiting before checking it once more/.test(l)),
		JSON.stringify(logs),
	)
	check(
		'every announcement is logged',
		logs.filter((l) => /Heard a Syncthing announcement from 192.168.20.102/.test(l)).length === 2,
		JSON.stringify(logs),
	)

	// Saving the connection is the other way to make it try again, and it still works.
	reachable = true
	scanner.retryUnreachable()
	socket.emit('message', packet, { address: '192.168.20.102', port: 21027 })
	await waitFor(() => scanner.hosts.length >= 1, 'the host after it became reachable')
	check('it appears once it answers', scanner.hosts[0]?.address === '192.168.20.102')

	scanner.stop()
}

console.log('7c. changing the port throws the confirmed list away')
{
	const socket = new FakeSocket()
	let port = 8384
	const scanner = new LanScanner({
		createSocket: () => socket,
		probe: async (address) => (address !== LOCAL_ADDRESS && port === 8384 ? 'http' : undefined),
		ownAddresses: () => [],
		resolveName: async () => undefined,
		onChange: () => {},
		log: () => {},
	})
	scanner.start()

	socket.emit('message', announcement({ id: deviceId }), { address: '192.168.20.102', port: 21027 })
	await waitFor(() => scanner.hosts.length >= 1, 'a confirmed host')
	check('a host is listed on the old port', scanner.hosts.length === 1)

	// The user corrects the port; nothing was confirmed against the new one.
	port = 9999
	scanner.reset()
	check('the list is emptied', scanner.hosts.length === 0, JSON.stringify(scanner.hosts))

	socket.emit('message', announcement({ id: deviceId }), { address: '192.168.20.102', port: 21027 })
	await new Promise((r) => setTimeout(r, 200))
	check('it is not listed again while it does not answer', scanner.hosts.length === 0, JSON.stringify(scanner.hosts))

	port = 8384
	scanner.reset()
	socket.emit('message', announcement({ id: deviceId }), { address: '192.168.20.102', port: 21027 })
	await waitFor(() => scanner.hosts.length >= 1, 'the host on the corrected port')
	check('it comes back once the port is right', scanner.hosts[0]?.address === '192.168.20.102')

	scanner.stop()
}

console.log('8. a taken port is reopened with address reuse')
{
	// Syncthing on the same machine holds the port, so the shared socket is refused.
	const shared = new FakeSocket()
	const fallback = new FakeSocket()
	const logs = []
	const scanner = new LanScanner({
		createSocket: () => shared,
		createFallbackSocket: () => fallback,
		probe: async (a) => (a === LOCAL_ADDRESS ? undefined : 'http'),
		ownAddresses: () => [],
		onChange: () => {},
		log: (level, message) => logs.push(`${level}: ${message}`),
	})
	scanner.start()

	shared.emit('error', new Error('bind EADDRINUSE 0.0.0.0:21027'))
	await new Promise((r) => setTimeout(r, 50))

	check('the refused socket is released', shared.closed === true)
	check('the port is opened again', fallback.boundPort === DISCOVERY_PORT, String(fallback.boundPort))
	check('nothing is reported as broken yet', !logs.some((l) => l.startsWith('warn:')), JSON.stringify(logs))

	fallback.emit('message', announcement({ id: deviceId }), { address: '192.168.20.102', port: 21027 })
	await waitFor(() => scanner.hosts.length >= 1, 'a host on the reused socket')
	check('discovery works through it', scanner.hosts[0]?.address === '192.168.20.102')

	scanner.stop()
	check('stopping closes the second socket', fallback.closed === true)
}

console.log('9. a port that cannot be opened at all is reported, not crashed on')
{
	const shared = new FakeSocket()
	const fallback = new FakeSocket()
	const logs = []
	const scanner = new LanScanner({
		createSocket: () => shared,
		createFallbackSocket: () => fallback,
		probe: async () => undefined,
		ownAddresses: () => [],
		onChange: () => {},
		log: (level, message) => logs.push(`${level}: ${message}`),
	})
	scanner.start()

	shared.emit('error', new Error('bind EADDRINUSE 0.0.0.0:21027'))
	await new Promise((r) => setTimeout(r, 50))
	fallback.emit('error', new Error('bind EADDRINUSE 0.0.0.0:21027'))
	await new Promise((r) => setTimeout(r, 50))

	check(
		'the failure is logged as a warning',
		logs.some((l) => l.startsWith('warn:')),
		JSON.stringify(logs),
	)
	check(
		'the message says instances will not be found',
		logs.some((l) => /will not be found/i.test(l)),
		JSON.stringify(logs),
	)
	check('the socket is released', fallback.closed === true)
	check('no hosts are reported', scanner.hosts.length === 0)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
