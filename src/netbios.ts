import dgram from 'node:dgram'

/**
 * Asks a machine on the local network what it is called, the way Windows does.
 *
 * Reverse DNS usually answers nothing on a small network, because nothing writes the records.
 * Windows machines instead answer a NetBIOS node status request on UDP port 137 with their own
 * name, which is how they find each other. That is what this sends: one small query, one answer,
 * no broadcast.
 *
 * A machine that does not speak NetBIOS simply stays quiet, and the caller is left without a name.
 */

const NETBIOS_PORT = 137

/**
 * Builds a node status request.
 *
 * The question is the wildcard name "*", encoded the way NetBIOS requires: every byte of the
 * sixteen character name is split into two nibbles, each added to the letter A.
 */
export function buildNodeStatusRequest(transactionId: number): Buffer {
	const header = Buffer.alloc(12)
	header.writeUInt16BE(transactionId, 0)
	header.writeUInt16BE(0x0000, 2) // a plain query, no flags
	header.writeUInt16BE(1, 4) // one question
	// No answer, authority or additional records.

	const name = Buffer.alloc(16, 0x00)
	name[0] = 0x2a // '*', the wildcard that asks for whatever names the machine holds

	const encoded = Buffer.alloc(34)
	encoded[0] = 32 // the encoded name is always 32 bytes long
	for (let i = 0; i < 16; i++) {
		const byte = name[i] ?? 0
		encoded[1 + i * 2] = 0x41 + (byte >> 4)
		encoded[2 + i * 2] = 0x41 + (byte & 0x0f)
	}
	encoded[33] = 0x00 // end of the name

	const tail = Buffer.alloc(4)
	tail.writeUInt16BE(0x0021, 0) // NBSTAT, the node status question type
	tail.writeUInt16BE(0x0001, 2) // internet class

	return Buffer.concat([header, encoded, tail])
}

/**
 * Reads the machine name out of a node status answer.
 *
 * The answer lists every name the machine holds. The wanted one is the first unique workstation
 * name; group names are shared between machines and say nothing about this one.
 */
export function parseNodeStatusResponse(packet: Buffer): string | undefined {
	// Header, then the echoed question: encoded name plus a terminator, type and class.
	let offset = 12
	if (packet.length < offset + 1) return undefined

	const nameLength = packet[offset]
	if (nameLength === undefined) return undefined
	offset += 1 + nameLength + 1 // length byte, name, terminator
	offset += 4 // question type and class
	offset += 4 // time to live
	offset += 2 // length of the record that follows

	if (packet.length < offset + 1) return undefined
	const count = packet[offset]
	if (count === undefined) return undefined
	offset += 1

	for (let i = 0; i < count; i++) {
		const start = offset
		const end = start + 15
		if (packet.length < end + 3) return undefined

		const name = packet.subarray(start, end).toString('ascii').trim()
		const suffix = packet[end]
		const flags = packet.readUInt16BE(end + 1)
		const isGroup = (flags & 0x8000) !== 0

		// Suffix 0x00 marks a workstation name, which is the machine's own name.
		if (!isGroup && suffix === 0x00 && name.length > 0) return name

		offset = end + 3
	}
	return undefined
}

/** Asks one address for its NetBIOS name. Resolves with undefined when nothing answers. */
export async function queryNetbiosName(address: string, timeout = 1200): Promise<string | undefined> {
	return new Promise<string | undefined>((resolve) => {
		const socket = dgram.createSocket('udp4')
		let settled = false

		const finish = (name: string | undefined): void => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			try {
				socket.close()
			} catch {
				// Closing twice is harmless here.
			}
			resolve(name)
		}

		const timer = setTimeout(() => finish(undefined), timeout)

		socket.on('message', (message) => {
			try {
				finish(parseNodeStatusResponse(message))
			} catch {
				finish(undefined)
			}
		})
		socket.on('error', () => finish(undefined))

		const request = buildNodeStatusRequest(Math.floor(Math.random() * 0xffff))
		socket.send(request, NETBIOS_PORT, address, (error) => {
			if (error) finish(undefined)
		})
	})
}
