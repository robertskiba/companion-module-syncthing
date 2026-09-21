// Diagnostic tool: run this on the machine Companion runs on, to see what the module would see.
//
//   node scripts/discover-check.mjs                 listen only
//   node scripts/discover-check.mjs 192.168.20.102  also probe that address
//
// It binds the same UDP port the module binds, prints every Syncthing announcement it hears, and
// checks whether a given address serves a web interface. Stop it with Ctrl+C.

import dgram from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const PORT = 21027
const MAGIC = 0x2ea7d90b
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const target = process.argv[2]
const guiPort = Number(process.argv[3] ?? 8384)

function base32(bytes) {
	let out = ''
	let buffer = 0
	let bits = 0
	for (const byte of bytes) {
		buffer = buffer * 256 + byte
		bits += 8
		while (bits >= 5) {
			bits -= 5
			out += ALPHABET[Math.floor(buffer / 2 ** bits) % 32]
		}
		buffer %= 2 ** bits
	}
	return out
}

function readVarint(buf, offset) {
	let value = 0
	let shift = 0
	let pos = offset
	while (pos < buf.length) {
		const byte = buf[pos]
		pos++
		value += (byte & 0x7f) * 2 ** shift
		if ((byte & 0x80) === 0) return { value, next: pos }
		shift += 7
	}
	return undefined
}

function parse(packet) {
	if (packet.length < 4 || packet.readUInt32BE(0) !== MAGIC) return undefined
	let id
	const addresses = []
	let offset = 4
	while (offset < packet.length) {
		const key = readVarint(packet, offset)
		if (!key) return undefined
		offset = key.next
		const field = Math.floor(key.value / 8)
		const wire = key.value % 8
		if (wire === 2) {
			const len = readVarint(packet, offset)
			if (!len) return undefined
			const end = len.next + len.value
			if (end > packet.length) return undefined
			if (field === 1) id = packet.subarray(len.next, end)
			else if (field === 2) addresses.push(packet.subarray(len.next, end).toString('utf8'))
			offset = end
		} else if (wire === 0) {
			const n = readVarint(packet, offset)
			if (!n) return undefined
			offset = n.next
		} else if (wire === 5) offset += 4
		else if (wire === 1) offset += 8
		else return undefined
	}
	return id ? { id, addresses } : undefined
}

async function reaches(scheme, host, port) {
	return new Promise((resolve) => {
		const doRequest = scheme === 'https' ? httpsRequest : httpRequest
		let done = false
		const finish = (ok, note) => {
			if (done) return
			done = true
			resolve({ ok, note })
		}
		const req = doRequest(
			{ host, port, path: '/rest/noauth/health', method: 'GET', rejectUnauthorized: false },
			(res) => {
				let body = ''
				res.on('data', (c) => (body += c))
				res.on('end', () => finish(true, `HTTP ${res.statusCode} ${body.slice(0, 60)}`))
			},
		)
		req.setTimeout(3000, () => {
			req.destroy()
			finish(false, 'timed out')
		})
		req.on('error', (err) => finish(false, err.message))
		req.end()
	})
}

console.log('Local IPv4 addresses of this machine:')
for (const [name, entries] of Object.entries(networkInterfaces())) {
	for (const entry of entries ?? []) {
		if (entry.family === 'IPv4') console.log(`  ${name}: ${entry.address}`)
	}
}
console.log()

if (target) {
	console.log(`Checking whether ${target}:${guiPort} serves a Syncthing web interface`)
	for (const scheme of ['http', 'https']) {
		const { ok, note } = await reaches(scheme, target, guiPort)
		console.log(`  ${scheme}: ${ok ? 'reachable' : 'not reachable'} (${note})`)
	}
	console.log()
}

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
const seen = new Map()

socket.on('error', (err) => {
	console.error(`Could not listen on UDP ${PORT}: ${err.message}`)
	console.error('Something else may hold the port, or the firewall may block it.')
	process.exit(1)
})

socket.on('listening', () => {
	const a = socket.address()
	console.log(`Listening for Syncthing announcements on ${a.address}:${a.port}`)
	console.log('Announcements arrive every 30 to 60 seconds. Press Ctrl+C to stop.')
	console.log()
})

socket.on('message', (message, remote) => {
	const parsed = parse(message)
	if (!parsed) {
		console.log(`${new Date().toLocaleTimeString()}  ${remote.address}  not a Syncthing announcement`)
		return
	}

	const shortId = base32(parsed.id).slice(0, 7)
	const count = (seen.get(remote.address) ?? 0) + 1
	seen.set(remote.address, count)

	console.log(
		`${new Date().toLocaleTimeString()}  ${remote.address}  device ${shortId}  ` +
			`addresses: ${parsed.addresses.join(', ') || 'none'}  (heard ${count}x)`,
	)

	if (count === 1) {
		void (async () => {
			const http = await reaches('http', remote.address, guiPort)
			const https = http.ok ? { ok: false, note: 'not tried' } : await reaches('https', remote.address, guiPort)
			const verdict = http.ok || https.ok ? 'WOULD BE LISTED' : 'would NOT be listed'
			console.log(`    web interface on port ${guiPort}: ${verdict}`)
			console.log(`      http: ${http.ok ? 'reachable' : `no (${http.note})`}`)
			if (!http.ok) console.log(`      https: ${https.ok ? 'reachable' : `no (${https.note})`}`)
		})()
	}
})

socket.bind(PORT)

process.on('SIGINT', () => {
	console.log('\nStopping.')
	socket.close()
	process.exit(0)
})
