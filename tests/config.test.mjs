// Checks that a freshly added connection contacts nothing until a host has been chosen.
const D = '../dist'
const { GetConfigFields, DEFAULT_CONFIG, guiUrlFor, NO_HOST } = await import(`${D}/config.js`)
const { LOCAL_ADDRESS } = await import(`${D}/lanscan.js`)

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
	check('it is a list', host?.type === 'dropdown', host?.type)
	check('nothing is preselected', host?.default === NO_HOST, JSON.stringify(host?.default))
	check('the empty value is a real choice', host?.choices?.[0]?.id === NO_HOST, JSON.stringify(host?.choices?.[0]))
	check('it invites a choice', /select/i.test(host?.choices?.[0]?.label ?? ''), host?.choices?.[0]?.label)
	check('a custom address can still be typed', host?.allowCustom === true)
}

console.log('2. localhost is not assumed to be there')
{
	const fields = GetConfigFields()
	const host = field(fields, 'host')
	const listed = host?.choices?.some((c) => c.id === LOCAL_ADDRESS)
	check('localhost is not offered on its own', listed !== true, JSON.stringify(host?.choices))
	check('it is not the default', host?.default !== LOCAL_ADDRESS, JSON.stringify(host?.default))
}
{
	// Once it has actually answered, the scanner reports it like any other host.
	const detected = [
		{
			address: LOCAL_ADDRESS,
			shortId: 'ABCDEFG',
			hostname: 'this machine',
			scheme: 'http',
			syncAddresses: [],
			lastSeen: Date.now(),
		},
	]
	const host = field(GetConfigFields({ host: NO_HOST }, detected), 'host')
	check('a reachable local instance is listed', host?.choices?.some((c) => c.id === LOCAL_ADDRESS) === true)
	check('still nothing preselected', host?.default === NO_HOST, JSON.stringify(host?.default))
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
	check('the chosen host is a choice', host?.choices?.some((c) => c.id === '192.168.1.5') === true)
	check(
		'it appears right after the empty entry',
		host?.choices?.[1]?.id === '192.168.1.5',
		JSON.stringify(host?.choices),
	)
	check('the address is derived', guiUrlFor(current) === 'http://192.168.1.5:8384', guiUrlFor(current))
	check('https is honoured', guiUrlFor({ ...current, useHttps: true }) === 'https://192.168.1.5:8384')

	const info = field(fields, 'info')
	check('the text now names the address', /192\.168\.1\.5:8384/.test(info?.value ?? ''), info?.value)
}

console.log('5. found hosts are offered, still without preselecting anything')
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
	const fields = GetConfigFields({ host: NO_HOST }, detected)
	const host = field(fields, 'host')

	check('still nothing preselected', host?.default === NO_HOST, JSON.stringify(host?.default))
	const labels = (host?.choices ?? []).map((c) => c.label)
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
	check('what is left is a short list', ids.length <= 8, JSON.stringify(ids))
	check('the host can still be typed in by hand', field(GetConfigFields(), 'host')?.allowCustom === true)
}

console.log('7. the discovery hint when nothing has been heard')
{
	const info = field(GetConfigFields(), 'info')
	check('it explains the wait', /30 to 60/.test(info?.value ?? ''), info?.value)
	check('it explains the localhost-only case', /localhost only/i.test(info?.value ?? ''), info?.value)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
