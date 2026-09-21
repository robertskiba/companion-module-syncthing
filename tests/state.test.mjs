// Stage 2 checks: state helpers, completion maths, variable naming, and the detail endpoints.
import http from 'node:http'
const D = '../dist'
const { SyncthingApi } = await import(`${D}/api.js`)
const {
	assignPrefixPairs,
	sanitizeVarSegment,
	folderCompletion,
	findFolder,
	findDevice,
	createEmptyState,
	FOLDER_STATES,
} = await import(`${D}/state.js`)
const { folderChoices, deviceChoices, localInSync, clusterInSync } = await import(`${D}/feedbacks.js`)
const { folderVariableValues, deviceVariableValues, folderVar, deviceVar } = await import(`${D}/variables.js`)

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

const folder = (over = {}) => ({
	id: 'show',
	label: 'Show',
	varPrefix: 'show',
	namePrefix: '',
	type: 'sendreceive',
	paused: false,
	state: 'idle',
	completion: 100,
	globalBytes: 1000,
	localBytes: 1000,
	inSyncBytes: 1000,
	needBytes: 0,
	needItems: 0,
	pullErrors: 0,
	receiveOnlyChangedFiles: 0,
	...over,
})
const device = (over = {}) => ({
	id: 'DEV1-AAAA-BBBB',
	name: 'Backup PC',
	varPrefix: 'DEV1',
	namePrefix: 'backup_pc',
	paused: false,
	connected: true,
	address: '192.168.1.5:22000',
	clientVersion: 'v1.29.2',
	completion: 100,
	needBytes: 0,
	needItems: 0,
	...over,
})

console.log('1. sanitizeVarSegment')
check('spaces become underscores', sanitizeVarSegment('Backup PC') === 'Backup_PC', sanitizeVarSegment('Backup PC'))
check('dashes collapse', sanitizeVarSegment('my-folder-id') === 'my_folder_id', sanitizeVarSegment('my-folder-id'))
check('leading/trailing stripped', sanitizeVarSegment('--abc--') === 'abc', sanitizeVarSegment('--abc--'))
check('empty falls back', sanitizeVarSegment('---') === 'unnamed', sanitizeVarSegment('---'))
check('umlauts collapse', sanitizeVarSegment('Präsentation') === 'Pr_sentation', sanitizeVarSegment('Präsentation'))

console.log('2. assignPrefixPairs de-duplicates colliding names')
const prefixes = assignPrefixPairs(
	['Media PC', 'Media-PC', 'Media_PC', 'Other'].map((n) => ({ stable: n, readable: '' })),
).map((p) => p.varPrefix)
check(
	'collisions get suffixes',
	JSON.stringify(prefixes) === JSON.stringify(['Media_PC', 'Media_PC_2', 'Media_PC_3', 'Other']),
	JSON.stringify(prefixes),
)
check('empty list is fine', assignPrefixPairs([]).length === 0)

console.log('3. folderCompletion')
check('half done', folderCompletion(1000, 500, 5) === 50, String(folderCompletion(1000, 500, 5)))
check('complete', folderCompletion(1000, 0, 0) === 100, String(folderCompletion(1000, 0, 0)))
check('nothing done', folderCompletion(1000, 1000, 10) === 0, String(folderCompletion(1000, 1000, 10)))
check('empty folder is complete', folderCompletion(0, 0, 0) === 100, String(folderCompletion(0, 0, 0)))
check('empty folder with pending deletes is not', folderCompletion(0, 0, 3) === 0, String(folderCompletion(0, 0, 3)))
check('one decimal place', folderCompletion(3, 1, 1) === 66.7, String(folderCompletion(3, 1, 1)))
check('never above 100', folderCompletion(100, -10, 0) === 100, String(folderCompletion(100, -10, 0)))

console.log('4. localInSync / clusterInSync')
const base = createEmptyState()
base.folders = [folder()]
base.devices = [device()]
check('all good', localInSync(base) && clusterInSync(base, false))

const behindLocal = { ...base, folders: [folder({ needBytes: 20 })], devices: [device()] }
check('local behind -> not in sync', !localInSync(behindLocal))
check('local behind -> cluster not in sync', !clusterInSync(behindLocal, false))

const behindRemote = { ...base, folders: [folder()], devices: [device({ completion: 40 })] }
check('remote behind -> local still in sync', localInSync(behindRemote))
check('remote behind -> cluster not in sync', !clusterInSync(behindRemote, false))

const pausedRemote = { ...base, folders: [folder()], devices: [device({ completion: 0, paused: true })] }
check('paused remote ignored', clusterInSync(pausedRemote, false))

const offlineRemote = { ...base, folders: [folder()], devices: [device({ completion: 10, connected: false })] }
check('offline remote counts by default', !clusterInSync(offlineRemote, false))
check('offline remote ignored on request', clusterInSync(offlineRemote, true))

const noDevices = { ...base, folders: [folder()], devices: [] }
check('no devices -> in sync', clusterInSync(noDevices, false))

const noFolders = { ...base, folders: [], devices: [device({ completion: 0 })] }
check('no folders -> local in sync', localInSync(noFolders))

console.log('5. find helpers')
check('findFolder hit', findFolder(base, 'show')?.label === 'Show')
check('findFolder miss', findFolder(base, 'nope') === undefined)
check('findDevice hit', findDevice(base, 'DEV1-AAAA-BBBB')?.name === 'Backup PC')
check('findDevice miss', findDevice(base, 'nope') === undefined)

console.log('6. dropdown choices')
const fc = folderChoices(base)
check('folder choice id is folder id', fc[0].id === 'show', JSON.stringify(fc))
check('folder choice label shows both', fc[0].label === 'Show (show)', fc[0].label)
check('empty folder list has placeholder', folderChoices(createEmptyState())[0].label === 'No folders known yet')
const dc = deviceChoices(base)
check('device choice id is device id', dc[0].id === 'DEV1-AAAA-BBBB')
check('device choice label is short', dc[0].label === 'Backup PC (DEV1)', dc[0].label)
check('empty device list has placeholder', deviceChoices(createEmptyState())[0].label === 'No devices known yet')

console.log('7. variable values')
const fv = folderVariableValues(folder({ needBytes: 5, needItems: 1, pullErrors: 2 }))
check('folder var naming', folderVar(folder(), 'state') === 'folder_show_state', folderVar(folder(), 'state'))
check('folder in_sync false when behind', fv['folder_show_in_sync'] === 'false', String(fv['folder_show_in_sync']))
check('folder pull errors exposed', fv['folder_show_pull_errors'] === 2)
const fv2 = folderVariableValues(folder())
check('folder in_sync true when done', fv2['folder_show_in_sync'] === 'true')
check('label falls back to id', folderVariableValues(folder({ label: '' }))['folder_show_label'] === 'show')

const dv = deviceVariableValues(device({ completion: 99.5 }))
check(
	'device var naming',
	deviceVar(device(), 'completion') === 'device_DEV1_completion',
	deviceVar(device(), 'completion'),
)
check('device in_sync false below 100', dv['device_DEV1_in_sync'] === 'false')
check('device short id', dv['device_DEV1_id_short'] === 'DEV1', String(dv['device_DEV1_id_short']))
check('device connected as string', dv['device_DEV1_connected'] === 'true')

console.log('8. folder states cover what Syncthing reports')
for (const s of [
	'idle',
	'scanning',
	'syncing',
	'error',
	'sync-preparing',
	'sync-waiting',
	'scan-waiting',
	'cleaning',
	'clean-waiting',
]) {
	check(`state ${s} known`, FOLDER_STATES.includes(s))
}

console.log('9. detail endpoints over HTTP')
const seen = []
const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost')
	seen.push(url.pathname + url.search)
	res.writeHead(200, { 'Content-Type': 'application/json' })
	if (url.pathname === '/rest/db/status') {
		res.end(
			JSON.stringify({
				state: 'syncing',
				globalBytes: 2000,
				localBytes: 1500,
				inSyncBytes: 1500,
				needBytes: 500,
				needTotalItems: 4,
				pullErrors: 1,
				receiveOnlyChangedFiles: 0,
			}),
		)
	} else if (url.pathname === '/rest/db/completion') {
		res.end(
			JSON.stringify({
				completion: 75.25,
				globalBytes: 2000,
				needBytes: 500,
				needItems: 4,
				needDeletes: 0,
				remoteState: 'valid',
				sequence: 1,
			}),
		)
	} else {
		res.end('{}')
	}
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const api = new SyncthingApi({
	host: '127.0.0.1',
	port: server.address().port,
	apiKey: 'k',
	useHttps: false,
	ignoreCertErrors: true,
	timeout: 3000,
})

const st = await api.get('/rest/db/status', { folder: 'my folder/with spaces' })
check('db/status parsed', st.state === 'syncing' && st.needBytes === 500)
check(
	'folder query encoded',
	seen.some((s) => s.includes('folder=my+folder%2Fwith+spaces')),
	JSON.stringify(seen),
)
check(
	'completion from status',
	folderCompletion(st.globalBytes, st.needBytes, st.needTotalItems) === 75,
	String(folderCompletion(st.globalBytes, st.needBytes, st.needTotalItems)),
)

const comp = await api.get('/rest/db/completion', { device: 'DEV1' })
check('db/completion parsed', comp.completion === 75.25)
check(
	'rounded to one decimal',
	Math.round(comp.completion * 10) / 10 === 75.3,
	String(Math.round(comp.completion * 10) / 10),
)

server.close()

console.log('10. assignPrefixPairs: stable id plus readable alias')
const pairs = assignPrefixPairs([
	{ stable: 'kj3h4-a9s8d', readable: 'Show Content' },
	{ stable: 'default', readable: 'Default' },
	{ stable: 'archive', readable: '' },
	{ stable: 'x1', readable: 'Show Content' },
])
check('cryptic id keeps its stable prefix', pairs[0].varPrefix === 'kj3h4_a9s8d', pairs[0].varPrefix)
check('label becomes a lowercase alias', pairs[0].namePrefix === 'show_content', pairs[0].namePrefix)
check('label equal to the id gets no alias', pairs[1].namePrefix === '', JSON.stringify(pairs[1]))
check('missing label gets no alias', pairs[2].namePrefix === '', JSON.stringify(pairs[2]))
check('duplicate label is de-duplicated', pairs[3].namePrefix === 'show_content_2', pairs[3].namePrefix)
check('stable prefixes stay untouched by aliases', pairs[3].varPrefix === 'x1', pairs[3].varPrefix)

const clash = assignPrefixPairs([
	{ stable: 'backup', readable: 'Other' },
	{ stable: 'other', readable: 'backup' },
])
check(
	'an alias never steals a stable prefix',
	clash[0].varPrefix === 'backup' && clash[1].namePrefix !== 'backup',
	JSON.stringify(clash),
)

console.log('11. both naming variants are published')
const twoWay = folderVariableValues(folder({ varPrefix: 'kj3h4_a9s8d', namePrefix: 'show_content' }))
check('value present under the folder id', twoWay['folder_kj3h4_a9s8d_completion'] === 100)
check('same value present under the label', twoWay['folder_show_content_completion'] === 100)
check('alias doubles the variable count', Object.keys(twoWay).length === 28, String(Object.keys(twoWay).length))
const oneWay = folderVariableValues(folder({ namePrefix: '' }))
check('no alias means one set only', Object.keys(oneWay).length === 14, String(Object.keys(oneWay).length))
const devTwoWay = deviceVariableValues(device())
check('device value under the ID block', devTwoWay['device_DEV1_name'] === 'Backup PC')
check('device value under the lowercase name', devTwoWay['device_backup_pc_name'] === 'Backup PC')

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
