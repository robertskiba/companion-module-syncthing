// Checks for asking a machine its own name the way Windows does.
import dgram from 'node:dgram'
const D = '../dist'
const { buildNodeStatusRequest, parseNodeStatusResponse, queryNetbiosName } = await import(`${D}/netbios.js`)

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

console.log('1. the request')
{
	const request = buildNodeStatusRequest(0x1234)
	check('it is the expected length', request.length === 50, String(request.length))
	check('the transaction id is kept', request.readUInt16BE(0) === 0x1234)
	check('it asks exactly one question', request.readUInt16BE(4) === 1)
	check('the encoded name is 32 bytes', request[12] === 32, String(request[12]))
	check(
		'the wildcard encodes to CK',
		request.subarray(13, 15).toString('ascii') === 'CK',
		request.subarray(13, 15).toString('ascii'),
	)
	check(
		'the rest of the name is padding',
		request.subarray(15, 45).toString('ascii') === 'AA'.repeat(15),
		request.subarray(15, 45).toString('ascii'),
	)
	check('the name is terminated', request[45] === 0)
	check('it asks for a node status', request.readUInt16BE(46) === 0x0021)
	check('in the internet class', request.readUInt16BE(48) === 0x0001)
	check(
		'two requests differ only by id',
		buildNodeStatusRequest(1).subarray(2).equals(buildNodeStatusRequest(2).subarray(2)),
	)
}

/** Builds an answer of the shape a Windows machine sends back. */
function response(names) {
	const header = Buffer.alloc(12)
	header.writeUInt16BE(0x1234, 0)
	header.writeUInt16BE(0x8400, 2)
	header.writeUInt16BE(1, 6) // one answer

	const question = Buffer.alloc(34)
	question[0] = 32
	question.fill(0x41, 1, 33)

	const tail = Buffer.alloc(10)
	tail.writeUInt16BE(0x0021, 0) // type
	tail.writeUInt16BE(0x0001, 2) // class
	tail.writeUInt32BE(0, 4) // time to live
	tail.writeUInt16BE(1 + names.length * 18, 8) // length of what follows

	const count = Buffer.from([names.length])
	const entries = names.map(({ name, suffix, group }) => {
		const entry = Buffer.alloc(18)
		entry.write(name.padEnd(15, ' '), 0, 15, 'ascii')
		entry[15] = suffix
		entry.writeUInt16BE(group ? 0x8000 : 0x0400, 16)
		return entry
	})

	return Buffer.concat([header, question, tail, count, ...entries])
}

console.log('2. reading the answer')
{
	const packet = response([
		{ name: 'WORKGROUP', suffix: 0x00, group: true },
		{ name: 'DATEV11-PC', suffix: 0x00, group: false },
		{ name: 'DATEV11-PC', suffix: 0x20, group: false },
	])
	check('the machine name is found', parseNodeStatusResponse(packet) === 'DATEV11-PC', parseNodeStatusResponse(packet))
}
{
	const packet = response([{ name: 'MEDIA-PC', suffix: 0x00, group: false }])
	check('a single name works', parseNodeStatusResponse(packet) === 'MEDIA-PC', parseNodeStatusResponse(packet))
}
{
	const packet = response([{ name: 'WORKGROUP', suffix: 0x00, group: true }])
	check('a group name is not a machine name', parseNodeStatusResponse(packet) === undefined)
}
{
	const packet = response([{ name: 'SOMETHING', suffix: 0x20, group: false }])
	check('a service name is not a machine name', parseNodeStatusResponse(packet) === undefined)
}
check('an empty answer is handled', parseNodeStatusResponse(Buffer.alloc(0)) === undefined)
check(
	'a truncated answer is handled',
	parseNodeStatusResponse(response([{ name: 'X', suffix: 0, group: false }]).subarray(0, 40)) === undefined,
)
check('noise is handled', parseNodeStatusResponse(Buffer.from('not a netbios answer at all')) === undefined)
{
	const packet = response([{ name: 'PADDED', suffix: 0x00, group: false }])
	check('trailing spaces are trimmed', parseNodeStatusResponse(packet) === 'PADDED')
}

console.log('3. asking a real socket')
{
	// A stand-in machine that answers on an ephemeral port, which the query is pointed at.
	const server = dgram.createSocket('udp4')
	await new Promise((r) => server.bind(0, '127.0.0.1', r))
	const port = server.address().port

	server.on('message', (message, remote) => {
		check('the machine receives a node status request', message.readUInt16BE(46) === 0x0021)
		server.send(response([{ name: 'DATEV11-PC', suffix: 0x00, group: false }]), remote.port, remote.address)
	})

	// queryNetbiosName targets port 137, so the port is patched for the test by querying directly.
	const name = await new Promise((resolve) => {
		const socket = dgram.createSocket('udp4')
		const timer = setTimeout(() => {
			socket.close()
			resolve(undefined)
		}, 2000)
		socket.on('message', (message) => {
			clearTimeout(timer)
			const parsed = parseNodeStatusResponse(message)
			socket.close()
			resolve(parsed)
		})
		socket.send(buildNodeStatusRequest(1), port, '127.0.0.1')
	})

	check('the name comes back', name === 'DATEV11-PC', String(name))
	server.close()
}

console.log('4. a machine that does not answer')
{
	const started = Date.now()
	const name = await queryNetbiosName('127.0.0.1', 400)
	check('it gives up quietly', name === undefined, String(name))
	check('it does not hang', Date.now() - started < 3000, String(Date.now() - started))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
