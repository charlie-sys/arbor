import assert from 'node:assert/strict'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { downloadInstaller, fileDigest, planDelta } from '../../src/main/updateDownload'
import { normalizeUpdateSource } from '../../src/shared/updateSource'
import type { UpdateProgress } from '../../src/shared/api'
import { app, net, session } from 'electron'
import { store } from '../../src/main/store'
import { downloadUpdate, cancelUpdate, getUpdateProgress, installUpdate } from '../../src/main/updater'

const root = process.env.ARBOR_TEST_DIR!
app.setPath('userData', root)
const payload = Buffer.alloc(65536, 42)
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const maps = (chunks: Buffer[]) => gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0,
  sizes: chunks.map(b => b.length), checksums: chunks.map(hash) }] }))
let data = payload, map = maps([payload]), behavior = 'normal', hits = 0
const ranges: string[] = []
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/bad/')) { res.writeHead(503); res.end(); return }
  if (req.url?.endsWith('.blockmap')) { res.end(map); return }
  hits++
  const range = req.headers.range
  if (range) ranges.push(range)
  const parts = range?.match(/^bytes=(\d+)-(\d*)$/)
  const start = parts ? Number(parts[1]) : 0
  const end = parts?.[2] ? Number(parts[2]) : data.length - 1
  const ignore = behavior === 'ignore'
  const actual = ignore ? data : data.subarray(start, end + 1)
  res.writeHead(parts && !ignore ? 206 : 200, { 'Content-Length': actual.length,
    ...(parts && !ignore ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) })
  if (behavior === 'stall') { res.write(actual.subarray(0, 1024)); return }
  if (behavior === 'truncate' && hits === 1) {
    res.write(actual.subarray(0, 8192))
    setTimeout(() => res.destroy(), 25)
    return
  }
  if (behavior === 'slow') {
    let pos = 0
    const timer = setInterval(() => {
      res.write(actual.subarray(pos, pos + 2048)); pos += 2048
      if (pos >= actual.length) { clearInterval(timer); res.end() }
    }, 5)
    res.on('close', () => clearInterval(timer))
    return
  }
  res.end(behavior === 'corrupt' ? Buffer.alloc(actual.length, 99) : actual)
})

async function run(): Promise<void> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/setup.exe`
  function options(dir: string, signal = new AbortController().signal, progress: UpdateProgress[] = []) {
    return { asset: { name: 'setup.exe', url, size: data.length, digest: `sha256:${hash(data)}` }, version: '2',
      dir: join(root, dir), urls: [url], fetch: (url: string, init: RequestInit) => net.fetch(url, init), signal, onProgress: (p: UpdateProgress) => progress.push(p), idleMs: 200, retryDelayMs: 1 }
  }
  behavior = 'truncate'; hits = 0; ranges.length = 0
  const file = await downloadInstaller(options('retry'))
  assert.equal(await fileDigest(file), hash(data))
  assert(ranges.includes('bytes=8192-'))
  console.log('PASS: interrupted responses retry from persisted bytes and verify the complete SHA-256')

  behavior = 'slow'; hits = 0
  const abort = new AbortController(), progress: UpdateProgress[] = []
  const canceled = options('cancel', abort.signal, progress)
  canceled.onProgress = p => { progress.push(p); if (p.received >= 2048) abort.abort() }
  await assert.rejects(downloadInstaller(canceled))
  const partial = (await fs.readdir(canceled.dir)).find(p => p.endsWith('.part'))!
  assert((await fs.stat(join(canceled.dir, partial))).size > 0)
  behavior = 'normal'; ranges.length = 0
  await downloadInstaller(options('cancel'))
  assert(ranges.length > 0)
  console.log('PASS: cancellation retains disk progress and a new download invocation resumes it')

  const initialData = data, initialMap = map
  data = Buffer.alloc(300000, 42); map = maps([data]); behavior = 'slow'
  const speedProgress: UpdateProgress[] = []
  await downloadInstaller(options('speed', undefined, speedProgress))
  assert(speedProgress.some(p => (p.bytesPerSecond ?? 0) > 0 && p.remainingSeconds !== undefined))
  data = initialData; map = initialMap
  console.log('PASS: ongoing transfers may exceed the idle timeout and report measured speed and remaining time')

  behavior = 'slow'
  const abort2 = new AbortController()
  const ignored = options('ignore', abort2.signal)
  ignored.onProgress = p => { if (p.received > 0) abort2.abort() }
  await assert.rejects(downloadInstaller(ignored))
  behavior = 'ignore'
  assert.equal(await fileDigest(await downloadInstaller(options('ignore'))), hash(data))
  console.log('PASS: servers ignoring Range restart safely without appending duplicate data')

  behavior = 'normal'
  const mirror = options('mirror'); mirror.urls = [url.replace('/setup.exe', '/bad/setup.exe'), url]
  await downloadInstaller(mirror)
  console.log('PASS: unavailable mirrors automatically fall back to the original source')

  behavior = 'stall'
  await assert.rejects(downloadInstaller(options('timeout')))
  assert((await fs.readdir(join(root, 'timeout'))).some(p => p.endsWith('.part')))
  console.log('PASS: stalled reads time out and retain partial files after bounded retries')

  behavior = 'corrupt'
  await assert.rejects(downloadInstaller(options('corrupt')))
  assert(!(await fs.readdir(join(root, 'corrupt'))).some(p => p.endsWith('.exe')))
  console.log('PASS: corrupt installers never become installable')

  behavior = 'normal'
  const a = Buffer.alloc(32000, 1), b = Buffer.alloc(32000, 2), c = Buffer.alloc(32000, 3)
  data = Buffer.concat([a, b]); map = maps([a, b])
  await downloadInstaller(options('delta'))
  const oldMap = map
  data = Buffer.concat([a, c]); map = maps([a, c]); ranges.length = 0
  assert.equal(planDelta(oldMap, 64000, map, 64000).length, 2)
  const deltaProgress: UpdateProgress[] = []
  assert.equal(await fileDigest(await downloadInstaller(options('delta', undefined, deltaProgress))), hash(data))
  assert.deepEqual(ranges, ['bytes=32000-63999'])
  assert(deltaProgress.some(p => p.mode === 'differential'))
  console.log('PASS: differential update copies matching blocks locally and downloads only changed bytes')

  data = Buffer.concat([a, b]); map = maps([a, b]); behavior = 'stall'
  const abortDelta = new AbortController(), delta = options('delta', abortDelta.signal)
  // Cancel while a changed range is pending; the copied prefix must remain resumable.
  delta.onProgress = p => { if (p.mode === 'differential' && p.received > 0) setTimeout(() => abortDelta.abort(), 5) }
  await assert.rejects(downloadInstaller(delta))
  behavior = 'normal'; ranges.length = 0
  assert.equal(await fileDigest(await downloadInstaller(options('delta'))), hash(data))
  assert(ranges.some(r => /^bytes=\d+-$/.test(r)))
  console.log('PASS: canceled differential reconstruction preserves a prefix that resumes through a full Range request')

  data = Buffer.concat([a, c]); map = maps([a, c]); behavior = 'ignore'
  assert.equal(await fileDigest(await downloadInstaller(options('delta'))), hash(data))
  console.log('PASS: failed differential ranges fall back to a hash-verified full installer')

  const before = hits
  await downloadInstaller(options('delta'))
  assert.equal(hits, before)
  assert.equal(normalizeUpdateSource('https://example.com/arbor/'), 'https://example.com/arbor')
  for (const url of ['http://example.com', 'https://a:b@example.com', 'https://example.com?token=secret']) assert.throws(() => normalizeUpdateSource(url))
  console.log('PASS: verified cache avoids duplicate downloads; custom sources require plain HTTPS')

  // Exercise the real update coordinator with Chromium networking and isolated application data.
  await store.init()
  await assert.rejects(store.updateSettings({ updateDownloadSource: 'http://invalid.example' }))
  await store.updateSettings({ updateDownloadSource: 'https://mirror.invalid/arbor/' })
  assert.equal(store.data.settings.updateDownloadSource, 'https://mirror.invalid/arbor')
  let delayedMetadata = true
  session.defaultSession.protocol.handle('https', async request => {
    if (request.url.includes('api.github.com')) {
      if (delayedMetadata) await new Promise(resolve => setTimeout(resolve, 80))
      return Response.json({ tag_name: 'v99.0.0', assets: [{ name: 'setup.exe', size: data.length,
        digest: `sha256:${hash(data)}`, browser_download_url: 'https://github.com/charlie-sys/arbor/releases/download/v99.0.0/setup.exe' }] })
    }
    if (request.url.includes('mirror.invalid')) return new Response('', { status: 503 })
    return net.fetch(url + (request.url.endsWith('.blockmap') ? '.blockmap' : ''), { headers: request.headers, signal: request.signal })
  })
  const checking = downloadUpdate()
  assert.equal(getUpdateProgress()?.phase, 'checking')
  assert.equal((await downloadUpdate()).ok, false, 'Only one coordinator download may run')
  cancelUpdate()
  assert.equal((await checking).canceled, true)
  assert.equal(getUpdateProgress()?.phase, 'paused')
  delayedMetadata = false; behavior = 'normal'
  const result = await downloadUpdate()
  assert(result.ok, result.message)
  assert.equal(getUpdateProgress()?.phase, 'ready')
  await fs.writeFile(result.filePath!, 'tampered installer')
  await assert.rejects(installUpdate(), /校验失败/)
  session.defaultSession.protocol.unhandle('https')
  console.log('PASS: real updater rejects concurrent downloads, cancels metadata checks, validates mirror settings, falls back and blocks tampered installers')

  // Optional release fixture: verify planning against real electron-builder block maps.
  try {
    const old = await fs.readFile('release/Arbor-Setup-0.1.9.exe.blockmap')
    const next = await fs.readFile('release/Arbor-Setup-0.1.10.exe.blockmap')
    const oldSize = (await fs.stat('release/Arbor-Setup-0.1.9.exe')).size
    const nextSize = (await fs.stat('release/Arbor-Setup-0.1.10.exe')).size
    const plan = planDelta(old, oldSize, next, nextSize)
    const transfers = plan.filter(op => op.old === undefined)
    console.log(`INFO: real v0.1.9 → v0.1.10 block maps: ${transfers.reduce((sum, op) => sum + op.size, 0)} / ${nextSize} bytes in ${transfers.length} requests`)
  } catch { /* Published installers are not required in a clean checkout. */ }
}

app.whenReady().then(run).then(() => { server.closeAllConnections(); server.close(); app.quit() }).catch(error => {
  console.error(error); server.closeAllConnections(); server.close(); app.exit(1)
})
