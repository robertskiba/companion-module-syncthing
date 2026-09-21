import dgram from 'node:dgram'
import { reverse as dnsReverse } from 'node:dns/promises'
import { networkInterfaces } from 'node:os'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LogLevel, SharedUdpSocket } from '@companion-module/base'
import { queryNetbiosName } from './netbios.js'

/**
 * Finds Syncthing instances on the local network.
 *
 * Syncthing announces itself by broadcasting on UDP port 21027, so listening there reveals every
 * instance in the same broadcast domain without sending anything. The announcement carries the
 * device ID and the addresses used for syncing, but not the address of the web interface, so each
 * newly heard host is then probed on the configured web interface port. Only hosts that answer
 * there are reported, because only those can actually be used as a connection.
 *
 * See https://docs.syncthing.net/specs/localdisco-v4.html
 */

/** UDP port Syncthing broadcasts its announcements on. */
export const DISCOVERY_PORT = 21027

/** First four bytes of every announcement, in network byte order. */
export const DISCOVERY_MAGIC = 0x2ea7d90b

/** The address of the instance on this machine, which never announces itself to us usefully. */
export const LOCAL_ADDRESS = '127.0.0.1'

/** How often the instance on this machine is checked, since it cannot be waited for. */
const LOCAL_PROBE_INTERVAL_MS = 60_000

/** Hosts are forgotten when they have not announced themselves for this long. */
const FORGET_AFTER_MS = 10 * 60 * 1000

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** One instance heard on the network and confirmed to have a reachable web interface. */
export interface LanHost {
	/** The address the announcement came from. */
	address: string
	/** The first block of the device ID, as Syncthing shows it in its own interface. */
	shortId: string
	/** The name the address resolves to, when the network can tell us one. */
	hostname: string | undefined
	/** Which scheme the web interface answered on. */
	scheme: 'http' | 'https'
	/** The sync addresses from the announcement, kept for display. */
	syncAddresses: string[]
	/** When the host last announced itself. */
	lastSeen: number
}

/** The contents of one announcement packet. */
export interface Announcement {
	/** The raw 32 byte device ID. */
	id: Buffer
	/** The sync addresses the instance listens on, which are not the web interface. */
	addresses: string[]
	instanceId: number
}

interface Varint {
	value: number
	next: number
}

function readVarint(buffer: Buffer, offset: number): Varint | undefined {
	let value = 0
	let shift = 0
	let position = offset

	while (position < buffer.length) {
		const byte = buffer[position]
		if (byte === undefined) return undefined
		position++

		// Multiplication rather than shifting, because a protobuf varint can exceed 32 bits.
		value += (byte & 0x7f) * Math.pow(2, shift)
		if ((byte & 0x80) === 0) return { value, next: position }

		shift += 7
		if (shift > 63) return undefined
	}
	return undefined
}

/**
 * Parses an announcement packet, or returns undefined when it is not one.
 * Only the fields this module uses are read; anything else is skipped.
 */
export function parseAnnouncement(packet: Buffer): Announcement | undefined {
	if (packet.length < 4 || packet.readUInt32BE(0) !== DISCOVERY_MAGIC) return undefined

	let id: Buffer | undefined
	const addresses: string[] = []
	let instanceId = 0
	let offset = 4

	while (offset < packet.length) {
		const key = readVarint(packet, offset)
		if (!key) return undefined
		offset = key.next

		const field = Math.floor(key.value / 8)
		const wireType = key.value % 8

		if (wireType === 2) {
			const length = readVarint(packet, offset)
			if (!length) return undefined
			const start = length.next
			const end = start + length.value
			if (end > packet.length) return undefined

			if (field === 1) id = packet.subarray(start, end)
			else if (field === 2) addresses.push(packet.subarray(start, end).toString('utf8'))
			offset = end
		} else if (wireType === 0) {
			const number = readVarint(packet, offset)
			if (!number) return undefined
			if (field === 3) instanceId = number.value
			offset = number.next
		} else if (wireType === 5) {
			offset += 4
		} else if (wireType === 1) {
			offset += 8
		} else {
			// Groups and anything unknown cannot be skipped safely.
			return undefined
		}
	}

	if (!id || id.length === 0) return undefined
	return { id, addresses, instanceId }
}

/** Encodes bytes as base32 using the alphabet Syncthing uses for device IDs. */
export function base32Encode(bytes: Buffer): string {
	let output = ''
	let buffer = 0
	let bits = 0

	for (const byte of bytes) {
		buffer = buffer * 256 + byte
		bits += 8
		while (bits >= 5) {
			bits -= 5
			const index = Math.floor(buffer / Math.pow(2, bits)) % 32
			output += BASE32_ALPHABET[index]
		}
		buffer %= Math.pow(2, bits)
	}

	if (bits > 0) {
		const index = (buffer * Math.pow(2, 5 - bits)) % 32
		output += BASE32_ALPHABET[index]
	}
	return output
}

/**
 * The short form of a device ID: the first block Syncthing shows.
 *
 * Only the first block is derived here. The full device ID inserts check characters, and getting
 * those subtly wrong would show an ID that looks right but is not, so it is left out.
 */
export function shortDeviceId(id: Buffer): string {
	return base32Encode(id).slice(0, 7)
}

/**
 * Builds a probe that checks whether a host serves a Syncthing web interface on the given port.
 *
 * The health endpoint is used because it is the one part of the REST API that needs no key, so a
 * host can be checked before anything is configured. Any HTTP answer counts as reachable: the
 * announcement already proved that Syncthing runs there, so the only question is whether its web
 * interface is bound to something other than localhost.
 */
export function createHttpProbe(
	port: number,
	ignoreCertErrors: boolean,
	timeout = 2000,
): (address: string) => Promise<'http' | 'https' | undefined> {
	return async (address: string) => {
		for (const scheme of ['http', 'https'] as const) {
			if (await reaches(scheme, address, port, ignoreCertErrors, timeout)) return scheme
		}
		return undefined
	}
}

async function reaches(
	scheme: 'http' | 'https',
	address: string,
	port: number,
	ignoreCertErrors: boolean,
	timeout: number,
): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const doRequest = scheme === 'https' ? httpsRequest : httpRequest
		let settled = false
		const finish = (result: boolean): void => {
			if (settled) return
			settled = true
			resolve(result)
		}

		const req = doRequest(
			{
				host: address,
				port,
				path: '/rest/noauth/health',
				method: 'GET',
				...(scheme === 'https' && ignoreCertErrors ? { rejectUnauthorized: false } : {}),
			},
			(res) => {
				res.resume()
				finish(true)
			},
		)

		req.setTimeout(timeout, () => {
			req.destroy()
			finish(false)
		})
		req.on('error', () => finish(false))
		req.end()
	})
}

/**
 * Builds a name lookup that asks the network what a given address is called.
 *
 * Many home and event networks have no reverse records at all, so a miss is normal and simply
 * leaves the address without a name.
 */
export function createDnsResolver(timeout = 1500): (address: string) => Promise<string | undefined> {
	return async (address: string) => {
		try {
			const names = await Promise.race([
				dnsReverse(address),
				new Promise<string[]>((resolve) => setTimeout(() => resolve([]), timeout)),
			])
			return names[0]
		} catch {
			return undefined
		}
	}
}

/**
 * Builds a name lookup that tries reverse DNS first and then asks the machine itself.
 *
 * On a small network nothing writes reverse DNS records, so the first attempt usually comes back
 * empty. Windows machines answer a NetBIOS query with their own name, which is how they appear to
 * each other in the network neighbourhood, and that is the name somebody recognises.
 */
export function createNameResolver(dnsTimeout = 1500, netbiosTimeout = 1200) {
	const viaDns = createDnsResolver(dnsTimeout)

	return async (address: string): Promise<string | undefined> => {
		const fromDns = await viaDns(address)
		if (fromDns) return fromDns

		try {
			return await queryNetbiosName(address, netbiosTimeout)
		} catch {
			return undefined
		}
	}
}

/** The little bit of a UDP socket the scanner needs, so the source can be swapped. */
export interface DiscoverySocket {
	on(event: 'message', listener: (message: Buffer, remote: { address: string }) => void): void
	on(event: 'error', listener: (error: Error) => void): void
	bind(port: number, address?: string, callback?: () => void): void
	close(callback?: () => void): void
}

/**
 * Opens the discovery port directly, allowing the address to be reused.
 *
 * Syncthing holds the same port for its own discovery, so on a machine that runs both, a plain
 * bind is refused. Asking for address reuse lets the two listen side by side. Some systems still
 * refuse it, in which case the caller reports that discovery is unavailable.
 */
export function createReusableSocket(): DiscoverySocket {
	return asDiscoverySocket(dgram.createSocket({ type: 'udp4', reuseAddr: true }))
}

/** Narrows any event-emitting UDP socket to the handful of members the scanner uses. */
function asDiscoverySocket(socket: {
	on(event: string, listener: (...args: never[]) => void): unknown
	bind(port: number, address?: string, callback?: () => void): unknown
	close(callback?: () => void): unknown
}): DiscoverySocket {
	return {
		on(event: string, listener: (...args: never[]) => void): void {
			socket.on(event, listener)
		},
		bind(port: number, address?: string, callback?: () => void): void {
			socket.bind(port, address, callback)
		},
		close(callback?: () => void): void {
			socket.close(callback)
		},
	}
}

export interface LanScannerOptions {
	/** Creates the shared UDP socket. Companion hosts it, so several connections can listen. */
	createSocket: () => SharedUdpSocket
	/**
	 * Opens the port directly when the shared socket cannot. Defaults to a socket that allows
	 * address reuse, which is what lets this run alongside a Syncthing on the same machine.
	 */
	createFallbackSocket?: () => DiscoverySocket
	/**
	 * Checks whether a host serves a Syncthing web interface.
	 * Resolves with the scheme that answered, or undefined when nothing did.
	 */
	probe: (address: string) => Promise<'http' | 'https' | undefined>
	/** Looks up the name of an address. Optional, because a network need not answer. */
	resolveName?: (address: string) => Promise<string | undefined>
	/** The addresses of this machine, used to recognise its own announcements. */
	ownAddresses?: () => string[]
	/** Called whenever the list of reachable hosts changed. */
	onChange: (hosts: LanHost[]) => void
	log: (level: LogLevel, message: string) => void
}

/** Listens for announcements and keeps a list of instances whose web interface answers. */
export class LanScanner {
	#options: LanScannerOptions
	#socket: DiscoverySocket | undefined
	/** Set once the shared socket has been given up on, so the fallback is only tried once. */
	#usedFallback = false
	#hosts = new Map<string, LanHost>()
	/** Addresses currently being probed, so a burst of announcements causes one probe. */
	#probing = new Set<string>()
	/** Addresses that did not answer, with the time they were last tried. */
	#unreachable = new Map<string, number>()
	/** Repeats the check of the instance on this machine. */
	#localTimer: NodeJS.Timeout | undefined
	/** The device ID of the instance on this machine, once it has announced itself. */
	#localShortId: string | undefined
	#running = false

	constructor(options: LanScannerOptions) {
		this.#options = options
	}

	/** The reachable hosts heard recently, oldest entries dropped. */
	get hosts(): LanHost[] {
		const cutoff = Date.now() - FORGET_AFTER_MS
		return [...this.#hosts.values()]
			.filter((host) => host.lastSeen >= cutoff)
			.sort((a, b) => a.address.localeCompare(b.address))
	}

	start(): void {
		if (this.#running) return
		this.#running = true

		// The instance on this machine cannot be waited for, because we never receive a broadcast
		// that is useful for reaching it, so it is checked directly and then repeatedly.
		void this.#checkLocal()
		this.#localTimer = setInterval(() => void this.#checkLocal(), LOCAL_PROBE_INTERVAL_MS)

		this.#usedFallback = false
		this.#listen(false)
	}

	/**
	 * Opens the discovery port, first through Companion's shared socket and then, if that is
	 * refused, directly with address reuse.
	 *
	 * The shared socket is the sanctioned way for several connections to share a fixed port, but
	 * it cannot bind alongside the Syncthing running on the same machine, which holds that port
	 * for its own discovery. The direct socket asks for address reuse and can.
	 */
	#listen(useFallback: boolean): void {
		try {
			const socket: DiscoverySocket = useFallback
				? (this.#options.createFallbackSocket ?? createReusableSocket)()
				: asDiscoverySocket(this.#options.createSocket())
			this.#socket = socket

			socket.on('message', (message, remote) => {
				this.#handlePacket(message, remote.address)
			})
			socket.on('error', (error: Error) => this.#handleSocketError(error, useFallback))

			// No address is given, so the socket listens on every IPv4 interface of this machine.
			socket.bind(DISCOVERY_PORT, undefined, () => {
				this.#options.log(
					'debug',
					`Listening for Syncthing announcements on port ${DISCOVERY_PORT}, all IPv4 interfaces` +
						(useFallback ? ', with address reuse' : ''),
				)
			})
		} catch (error) {
			this.#handleSocketError(error instanceof Error ? error : new Error(String(error)), useFallback)
		}
	}

	#handleSocketError(error: Error, wasFallback: boolean): void {
		if (!this.#running) return

		if (!wasFallback && !this.#usedFallback) {
			// Most likely the Syncthing on this machine already holds the port.
			this.#usedFallback = true
			this.#options.log(
				'debug',
				`Port ${DISCOVERY_PORT} is taken (${error.message}), opening it again with address reuse`,
			)
			this.#closeSocket()
			this.#listen(true)
			return
		}

		this.#options.log(
			'warn',
			`Cannot listen for Syncthing announcements on port ${DISCOVERY_PORT}: ${error.message}. ` +
				'Instances on the network will not be found; enter the address by hand.',
		)
		this.stop()
	}

	#closeSocket(): void {
		if (!this.#socket) return
		try {
			this.#socket.close()
		} catch {
			// Closing a socket that never bound is not worth reporting.
		}
		this.#socket = undefined
	}

	stop(): void {
		this.#running = false
		this.#probing.clear()

		if (this.#localTimer) {
			clearInterval(this.#localTimer)
			this.#localTimer = undefined
		}

		this.#closeSocket()
	}

	/** Forgets which hosts failed the probe, so a changed setup is picked up again. */
	retryUnreachable(): void {
		this.#unreachable.clear()
		void this.#checkLocal()
	}

	/**
	 * Checks the instance on this machine the same way as any other, rather than assuming it is
	 * there. Binding Syncthing to a single network address makes its interface unreachable over
	 * 127.0.0.1, in which case this finds nothing and the address is correctly left out.
	 */
	async #checkLocal(): Promise<void> {
		if (!this.#running) return

		let scheme: 'http' | 'https' | undefined
		try {
			scheme = await this.#options.probe(LOCAL_ADDRESS)
		} catch {
			scheme = undefined
		}
		if (!this.#running) return

		const had = this.#hosts.has(LOCAL_ADDRESS)

		if (!scheme) {
			if (had) {
				this.#hosts.delete(LOCAL_ADDRESS)
				this.#options.onChange(this.hosts)
			}
			return
		}

		this.#hosts.set(LOCAL_ADDRESS, {
			address: LOCAL_ADDRESS,
			shortId: this.#localShortId ?? '',
			hostname: 'this machine',
			scheme,
			syncAddresses: [],
			lastSeen: Date.now(),
		})

		if (!had) {
			this.#options.log('info', `Found Syncthing on this machine at ${LOCAL_ADDRESS}, web interface reachable`)
			this.#options.onChange(this.hosts)
		}
	}

	/** True when the address belongs to this machine, so its announcement is our own. */
	#isOwnAddress(address: string): boolean {
		const own = this.#options.ownAddresses ? this.#options.ownAddresses() : localIpv4Addresses()
		return own.includes(address)
	}

	/** Probes one newly heard address and, if it answers, records it with whatever name it has. */
	async #examine(address: string, announcement: Announcement): Promise<void> {
		const shortId = shortDeviceId(announcement.id)

		let scheme: 'http' | 'https' | undefined
		try {
			scheme = await this.#options.probe(address)
		} catch {
			scheme = undefined
		}
		if (!this.#running) return

		if (!scheme) {
			this.#unreachable.set(address, Date.now())
			this.#options.log(
				'debug',
				`Syncthing at ${address} (${shortId}) announced itself but its web interface did not answer`,
			)
			return
		}

		// The name is a nicety, so a lookup that fails or throws must not lose the host.
		let hostname: string | undefined
		try {
			hostname = await this.#options.resolveName?.(address)
		} catch {
			hostname = undefined
		}
		if (!this.#running) return

		this.#hosts.set(address, {
			address,
			shortId,
			hostname,
			scheme,
			syncAddresses: announcement.addresses,
			lastSeen: Date.now(),
		})

		const named = hostname ? `${address} (${hostname})` : address
		this.#options.log('info', `Found Syncthing at ${named}, device ${shortId}, web interface reachable`)
		this.#options.onChange(this.hosts)
	}

	#handlePacket(packet: Buffer, address: string): void {
		if (!this.#running) return

		const announcement = parseAnnouncement(packet)
		if (!announcement) return

		if (this.#isOwnAddress(address)) {
			const shortId = shortDeviceId(announcement.id)
			if (this.#localShortId !== shortId) {
				this.#localShortId = shortId
				const local = this.#hosts.get(LOCAL_ADDRESS)
				if (local) {
					local.shortId = shortId
					this.#options.onChange(this.hosts)
				}
			}
		}

		const known = this.#hosts.get(address)
		if (known) {
			known.lastSeen = Date.now()
			return
		}

		// A host that already failed is not probed again on every announcement.
		if (this.#probing.has(address) || this.#unreachable.has(address)) return

		this.#probing.add(address)
		void this.#examine(address, announcement).finally(() => {
			this.#probing.delete(address)
		})
	}
}

/** The IPv4 addresses of this machine, used to recognise its own announcements. */
export function localIpv4Addresses(): string[] {
	const addresses: string[] = []
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === 'IPv4') addresses.push(entry.address)
		}
	}
	return addresses
}
