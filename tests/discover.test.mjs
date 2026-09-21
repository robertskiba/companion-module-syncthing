// Checks for reading the API key from an instance whose web interface has no login.
import http from 'node:http'
const D = '../dist'
const { discoverApiKey, findCsrfCookie, apiKeyFromConfig, DiscoveryError } = await import(`${D}/discover.js`)

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

console.log('1. findCsrfCookie')
check(
	'picks the CSRF cookie',
	findCsrfCookie(['CSRF-Token-ABCDE=tok123; Path=/; Max-Age=86400'])?.value === 'tok123',
	JSON.stringify(findCsrfCookie(['CSRF-Token-ABCDE=tok123; Path=/'])),
)
check(
	'keeps the exact cookie name, whatever the suffix',
	findCsrfCookie(['CSRF-Token-XYZ1234=t'])?.name === 'CSRF-Token-XYZ1234',
)
check('ignores unrelated cookies', findCsrfCookie(['session=abc; Path=/']) === undefined)
check('ignores an empty value', findCsrfCookie(['CSRF-Token-A=; Path=/']) === undefined)
check('handles no cookies at all', findCsrfCookie([]) === undefined)
check('finds it among several', findCsrfCookie(['other=1', 'CSRF-Token-Q=tok', 'more=2'])?.value === 'tok')

console.log('2. apiKeyFromConfig')
check('reads the key', apiKeyFromConfig('{"gui":{"apiKey":"abc123"}}') === 'abc123')
check('missing gui section', apiKeyFromConfig('{"devices":[]}') === undefined)
check('empty key counts as missing', apiKeyFromConfig('{"gui":{"apiKey":""}}') === undefined)
check('broken json', apiKeyFromConfig('not json') === undefined)
check('null body', apiKeyFromConfig('null') === undefined)
check('gui is not an object', apiKeyFromConfig('{"gui":"x"}') === undefined)

/** Builds a fake Syncthing whose behaviour can be varied per test. */
async function startFake({ auth = false, cookie = true, key = 'discovered-key', configPath = '/rest/config' } = {}) {
	const seen = []
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost')
		seen.push({ path: url.pathname, headers: req.headers })

		if (url.pathname === '/') {
			if (auth) {
				res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Authorization Required"' })
				res.end('Not Authorized')
				return
			}
			const headers = { 'Content-Type': 'text/html' }
			if (cookie) headers['Set-Cookie'] = 'CSRF-Token-ABCDE=tok123; Path=/; Max-Age=86400'
			res.writeHead(200, headers)
			res.end('<html>Syncthing</html>')
			return
		}

		if (url.pathname === configPath) {
			// Mirrors Syncthing: without the matching CSRF header the request is refused.
			if (req.headers['x-csrf-token-abcde'] !== 'tok123') {
				res.writeHead(403, { 'Content-Type': 'text/plain' })
				res.end('CSRF Error')
				return
			}
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ gui: { apiKey: key }, devices: [] }))
			return
		}

		res.writeHead(404)
		res.end('not found')
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	return { server, seen, port: server.address().port }
}

const opts = (port) => ({ host: '127.0.0.1', port, useHttps: false, ignoreCertErrors: true, timeout: 3000 })

console.log('3. the happy path')
{
	const fake = await startFake()
	const key = await discoverApiKey(opts(fake.port))
	check('key is read', key === 'discovered-key', key)
	check('the GUI is asked first', fake.seen[0].path === '/', fake.seen[0].path)
	check('then the config', fake.seen[1].path === '/rest/config', fake.seen[1].path)
	check(
		'the cookie is sent back',
		fake.seen[1].headers.cookie === 'CSRF-Token-ABCDE=tok123',
		fake.seen[1].headers.cookie,
	)
	fake.server.close()
}

console.log('4. an older instance that only has the legacy config path')
{
	const fake = await startFake({ configPath: '/rest/system/config', key: 'legacy-key' })
	const key = await discoverApiKey(opts(fake.port))
	check('falls back to the old path', key === 'legacy-key', key)
	check('the new path was tried first', fake.seen[1].path === '/rest/config', fake.seen[1].path)
	fake.server.close()
}

console.log('5. a protected web interface')
{
	const fake = await startFake({ auth: true })
	try {
		await discoverApiKey(opts(fake.port))
		check('a login blocks discovery', false, 'no error thrown')
	} catch (err) {
		check('a login blocks discovery', err instanceof DiscoveryError, err.message)
		check('the reason mentions the login', /login/.test(err.message), err.message)
	}
	fake.server.close()
}

console.log('6. no CSRF token handed out')
{
	const fake = await startFake({ cookie: false })
	try {
		await discoverApiKey(opts(fake.port))
		check('missing token is reported', false, 'no error thrown')
	} catch (err) {
		check('missing token is reported', /CSRF/.test(err.message), err.message)
	}
	fake.server.close()
}

console.log('7. nothing listening')
{
	try {
		await discoverApiKey({ host: '127.0.0.1', port: 1, useHttps: false, ignoreCertErrors: true, timeout: 2000 })
		check('an unreachable host fails cleanly', false, 'no error thrown')
	} catch (err) {
		check('an unreachable host fails cleanly', err instanceof Error, err.message)
	}
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
