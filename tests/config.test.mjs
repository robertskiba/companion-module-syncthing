// Checks that a freshly added connection contacts nothing until a host has been chosen.
const D = '../dist'
const { GetConfigFields, DEFAULT_CONFIG, guiUrlFor, NO_HOST, HOST_REGEX } = await import(`${D}/config.js`)

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

const field = (fields, id) => fields.find((f) => f.id === id)

console.log('1. a fresh connection has no host')
check('the default host is empty', DEFAULT_CONFIG.host === NO_HOST, JSON.stringify(DEFAULT_CONFIG.host))
{
	const fields = GetConfigFields()
	const host = field(fields, 'host')
	check('the host field exists', host !== undefined)
	check('it is a plain text field', host?.type === 'textinput', host?.type)
	check('nothing is prefilled', host?.default === NO_HOST, JSON.stringify(host?.default))
	check('it always stays editable', host?.type === 'textinput')
}

console.log('2. the found list stays hidden until the search has had a chance')
{
	const before = GetConfigFields({ host: NO_HOST }, [], false)
	check('no picker before then', field(before, 'foundHosts') === undefined, JSON.stringify(before.map((f) => f.id)))

	const after = GetConfigFields({ host: NO_HOST }, [], true)
	const picker = field(after, 'foundHosts')
	check('the picker appears once it has', picker !== undefined)
	check(
		'an empty network is a real answer',
		/nothing found/i.test(picker?.choices?.[0]?.label ?? ''),
		picker?.choices?.[0]?.label,
	)
	check(
		'it sits above the host field',
		after.findIndex((f) => f.id === 'foundHosts') < after.findIndex((f) => f.id === 'host'),
	)
	check('it starts on the placeholder', picker?.default === '', JSON.stringify(picker?.default))
}

console.log('3. nothing suggests a connection while no host is set')
{
	check('no address is derived from an empty host', guiUrlFor({ host: '', port: 8384, useHttps: false }) === '')
	const info = field(GetConfigFields(), 'info')
	check('the text says nothing is contacted', /nothing is being contacted/i.test(info?.value ?? ''), info?.value)
	check('no bogus address is shown', !/127\.0\.0\.1:8384/.test(info?.value ?? ''), info?.value)
}

console.log('4. once a host is set, it is kept and shown')
{
	const current = { host: '192.168.1.5', port: 8384, useHttps: false }
	const fields = GetConfigFields(current)
	const host = field(fields, 'host')
	check('the field holds whatever was typed', host?.type === 'textinput', host?.type)
	check('the address is derived', guiUrlFor(current) === 'http://192.168.1.5:8384', guiUrlFor(current))
	check('https is honoured', guiUrlFor({ ...current, useHttps: true }) === 'https://192.168.1.5:8384')

	const info = field(fields, 'info')
	check('the text now names the address', /192\.168\.1\.5:8384/.test(info?.value ?? ''), info?.value)
}

console.log('5. found hosts are offered by the picker, never chosen for you')
{
	const detected = [
		{
			address: '192.168.1.9',
			shortId: 'ABCDEFG',
			hostname: 'media-pc.lan',
			scheme: 'http',
			syncAddresses: [],
			lastSeen: Date.now(),
		},
		{
			address: '192.168.1.10',
			shortId: 'HIJKLMN',
			hostname: undefined,
			scheme: 'https',
			syncAddresses: [],
			lastSeen: Date.now(),
		},
	]
	const fields = GetConfigFields({ host: NO_HOST }, detected, true)
	const host = field(fields, 'host')
	const picker = field(fields, 'foundHosts')

	check('the host itself stays empty', host?.default === NO_HOST, JSON.stringify(host?.default))
	check('the picker starts on the placeholder', picker?.default === '', JSON.stringify(picker?.default))
	const labels = (picker?.choices ?? []).map((c) => c.label)
	check(
		'a found host is listed',
		labels.some((l) => l.includes('192.168.1.9')),
		JSON.stringify(labels),
	)
	check(
		'its resolved name is shown',
		labels.some((l) => l.includes('media-pc.lan')),
		JSON.stringify(labels),
	)
	check(
		'its device id is shown',
		labels.some((l) => l.includes('ABCDEFG')),
		JSON.stringify(labels),
	)
	check(
		'an https host is marked',
		labels.some((l) => l.includes('HTTPS')),
		JSON.stringify(labels),
	)
	check(
		'an entry without a device id still reads cleanly',
		!labels.some((l) => l.includes('device ,')),
		JSON.stringify(labels),
	)
	check(
		'each found address is selectable',
		(picker?.choices ?? []).some((c) => c.id === '192.168.1.9'),
	)

	const info = field(fields, 'info')
	check('the text lists what was found', /192\.168\.1\.9/.test(info?.value ?? ''), info?.value)
}

console.log('6. there are no switches for things that should always run')
{
	const ids = GetConfigFields().map((f) => f.id)
	check('no switch for the event stream', !ids.includes('useEvents'), JSON.stringify(ids))
	check('no switch for the network search', !ids.includes('lanScan'), JSON.stringify(ids))
	check('the defaults carry neither', !('useEvents' in DEFAULT_CONFIG) && !('lanScan' in DEFAULT_CONFIG))
	check('no switch for folder detail', !ids.includes('pollDetails'), JSON.stringify(ids))
	check('no interval for folder detail', !ids.includes('detailInterval'), JSON.stringify(ids))
	check(
		'the defaults carry neither either',
		!('pollDetails' in DEFAULT_CONFIG) && !('detailInterval' in DEFAULT_CONFIG),
	)
	check('no poll interval to tune', !ids.includes('pollInterval'), JSON.stringify(ids))
	check('the defaults carry no poll interval', !('pollInterval' in DEFAULT_CONFIG))
	check('what is left is a short list', ids.length <= 7, JSON.stringify(ids))
	check('the host can still be typed in by hand', field(GetConfigFields(), 'host')?.type === 'textinput')
}

console.log('7. what the host field accepts')
{
	const host = new RegExp(HOST_REGEX.slice(1, -1))

	const accepted = [
		['nothing at all', ''],
		['a plain IPv4 address', '192.168.20.102'],
		['loopback', '127.0.0.1'],
		['a bare machine name', 'localhost'],
		['a Windows machine name with a dash', 'DATEV11-PC'],
		['a local domain name', 'media-pc.lan'],
		['a full domain name for a remote machine', 'syncthing.example.com'],
		['a deep domain name', 'st.branch.office.example.com'],
		['a bare IPv6 address', 'fe80::1'],
	]
	for (const [what, value] of accepted) {
		check(`accepts ${what}`, host.test(value), JSON.stringify(value))
	}

	const rejected = [
		['a whole URL', 'http://10.0.0.5'],
		['an address with a port', '10.0.0.5:8384'],
		['anything with a space', 'media pc'],
		['a trailing dash', 'trailing-'],
		['a leading dash', '-leading'],
		['a doubled dot', 'two..dots'],
		['a path', 'host/path'],
	]
	for (const [what, value] of rejected) {
		check(`rejects ${what}`, !host.test(value), JSON.stringify(value))
	}
}

console.log('8. the discovery hint when nothing has been heard')
{
	const info = field(GetConfigFields(), 'info')
	check('it explains the wait', /30 to 60/.test(info?.value ?? ''), info?.value)
	check('it explains the localhost-only case', /localhost only/i.test(info?.value ?? ''), info?.value)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
