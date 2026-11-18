import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import type { UpdateProgress } from '../shared/api'

type Fetch = (url: string, init: RequestInit) => Promise<Response>
interface Asset { name: string; url: string; size: number; digest?: string }
interface Basis { file: string; map: string; size: number; digest: string }
interface Block { offset: number; size: number; checksum: string }
interface Operation { start: number; size: number; old?: number }
export interface DownloadOptions {
  asset: Asset
  dir: string
  urls: string[]
  fetch: Fetch
  signal: AbortSignal
  onProgress(progress: UpdateProgress): void
  idleMs?: number
  retryDelayMs?: number
}

export async function fileDigest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function blocks(data: Buffer, expectedSize: number): Block[] {
  const map = JSON.parse(gunzipSync(data, { maxOutputLength: 16 * 1024 * 1024 }).toString())
  if (map.version !== '2' || !Array.isArray(map.files) || map.files.length !== 1 || map.files[0].offset !== 0) throw new Error('Unsupported block map')
  const file = map.files[0]
  if (!Array.isArray(file.sizes) || !Array.isArray(file.checksums) || file.sizes.length !== file.checksums.length || file.sizes.length > 100000) throw new Error('Invalid block map')
  let offset = 0
  const result = file.sizes.map((size: number, i: number) => {
    if (!Number.isSafeInteger(size) || size <= 0 || typeof file.checksums[i] !== 'string') throw new Error('Invalid block')
    const block = { offset, size, checksum: file.checksums[i] }
    offset += size
    return block
  })
  if (offset !== expectedSize) throw new Error('Block map size mismatch')
  return result
}

export function planDelta(oldMap: Buffer, oldSize: number, newMap: Buffer, newSize: number): Operation[] {
  const old = new Map(blocks(oldMap, oldSize).map(block => [`${block.checksum}:${block.size}`, block.offset]))
  const operations: Operation[] = []
  for (const block of blocks(newMap, newSize)) {
    const from = old.get(`${block.checksum}:${block.size}`)
    const last = operations.at(-1)
    if (last && (from === undefined ? last.old === undefined : last.old !== undefined && last.old + last.size === from)) last.size += block.size
    else operations.push({ start: block.offset, size: block.size, ...(from === undefined ? {} : { old: from }) })
  }
  return operations
}

/** Bounded reads and writes; the file is installable only after the GitHub SHA-256 matches. */
export async function downloadInstaller(options: DownloadOptions): Promise<string> {
  const { asset, signal, dir, onProgress } = options
  const expected = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1].toLowerCase()
  if (!expected || !Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('更新包缺少可信的 SHA-256 或大小，无法安全下载')
  const name = `${expected}-${path.basename(asset.name).replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const file = path.join(dir, name)
  const part = `${file}.part`
  const mapPath = `${file}.blockmap`
  await fs.mkdir(dir, { recursive: true })
  const size = async (file: string): Promise<number> => (await fs.stat(file).catch(() => null))?.size ?? 0
  let received = 0, network = 0, tick = Date.now(), tickBytes = 0, speed = 0, lastEmit = 0
  let mode: 'full' | 'differential' = 'full'
  let transferTotal = asset.size
  let source = ''
  function emit(phase: UpdateProgress['phase'] = 'downloading', message?: string): void {
    const now = Date.now()
    if (now - tick >= 500) {
      speed = (network - tickBytes) * 1000 / (now - tick)
      tick = now; tickBytes = network
    }
    if (phase === 'downloading' && now - lastEmit < 200) return
    lastEmit = now
    onProgress({ phase, received, total: asset.size, percent: Math.min(99, Math.floor(received / asset.size * 100)),
      bytesPerSecond: speed, remainingSeconds: speed > 0 ? Math.ceil(Math.max(0, transferTotal - network) / speed) : undefined,
      mode, source, message })
  }
  async function request(url: string, range: string | undefined, consume: (response: Response) => Promise<void>): Promise<void> {
    signal.throwIfAborted()
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal])
    let timer: ReturnType<typeof setTimeout>
    const touch = (): void => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('下载持续无数据，正在重试')), options.idleMs ?? 30000) }
    touch()
    try {
      const response = await options.fetch(url, { headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', ...(range ? { Range: range } : {}) }, signal: combined })
      // Touch on each actual read rather than imposing a total download deadline.
      const original = response.body?.getReader()
      const body = original ? new ReadableStream<Uint8Array>({
        async pull(controller) {
          try { const next = await original.read(); touch(); if (next.done) controller.close(); else controller.enqueue(next.value) }
          catch (error) { controller.error(error) }
        }, cancel(reason) { return original.cancel(reason) }
      }) : null
      const wrapped = new Response(body, { status: response.status, headers: response.headers })
      try { await consume(wrapped) } finally { await wrapped.body?.cancel().catch(() => undefined) }
    } finally { clearTimeout(timer!); controller.abort() }
  }
  async function small(url: string): Promise<Buffer> {
    const chunks: Buffer[] = []; let length = 0
    await request(url, undefined, async response => {
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        length += chunk.length
        if (length > 4 * 1024 * 1024) throw new Error('Block map too large')
        chunks.push(Buffer.from(chunk))
      }
    })
    return Buffer.concat(chunks)
  }
  async function verify(candidate: string): Promise<boolean> {
    return await size(candidate) === asset.size && await fileDigest(candidate) === expected
  }
  signal.throwIfAborted()
  if (await verify(file)) return file
  await fs.rm(file, { force: true })
  // Only reuse a verified complete installer. Cache paths cannot escape the updater directory.
  let basis: Basis | undefined
  try {
    const candidate = JSON.parse(await fs.readFile(path.join(dir, 'basis.json'), 'utf8')) as Basis
    if ([candidate.file, candidate.map].every(p => typeof p === 'string' && path.basename(p) === p) && /^[a-f0-9]{64}$/.test(candidate.digest) &&
      await size(path.join(dir, candidate.file)) === candidate.size && await fileDigest(path.join(dir, candidate.file)) === candidate.digest) basis = candidate
  } catch { /* missing cache: full download */ }

  let newMap: Buffer | undefined
  // A resumed full download takes priority over starting a fresh differential reconstruction.
  if (basis && await size(part) === 0) {
    for (const url of options.urls) {
      signal.throwIfAborted()
      try {
        source = new URL(url).hostname
        newMap = await small(`${url}.blockmap`)
        const operations = planDelta(await fs.readFile(path.join(dir, basis.map)), basis.size, newMap, asset.size)
        const changed = operations.filter(op => op.old === undefined)
        if (changed.length > 128 || changed.reduce((sum, op) => sum + op.size, 0) >= asset.size * 0.8) break
        mode = 'differential'; transferTotal = changed.reduce((sum, op) => sum + op.size, 0)
        received = 0; network = 0; tickBytes = 0; tick = Date.now()
        emit('downloading', '正在下载差分更新')
        const output = await fs.open(part, 'w'), input = await fs.open(path.join(dir, basis.file), 'r')
        try {
          for (const op of operations) {
            signal.throwIfAborted()
            let written = 0
            if (op.old !== undefined) {
              const buffer = Buffer.alloc(Math.min(op.size, 1024 * 1024))
              while (written < op.size) {
                signal.throwIfAborted()
                const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, op.size - written), op.old + written)
                if (!bytesRead) throw new Error('Cached installer incomplete')
                await output.writeFile(buffer.subarray(0, bytesRead)); written += bytesRead; received += bytesRead; emit()
              }
            } else {
              await request(url, `bytes=${op.start}-${op.start + op.size - 1}`, async response => {
                if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${op.start}-${op.start + op.size - 1}/${asset.size}` || !response.body) throw new Error('Range unsupported')
                for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
                  if (written + chunk.length > op.size) throw new Error('Invalid range length')
                  await output.writeFile(chunk); written += chunk.length; received += chunk.length; network += chunk.length; emit()
                }
                if (written !== op.size) throw new Error('Incomplete range')
              })
            }
          }
        } finally { await output.close(); await input.close() }
        emit('verifying')
        if (!await verify(part)) throw new Error('差分校验失败，回退完整下载')
        break
      } catch {
        // Reconstruction is sequential: its completed prefix is also a valid full-download prefix.
        // Preserve it across cancellation, restarts and fallback; the final hash remains authoritative.
        signal.throwIfAborted()
        mode = 'full'; newMap = undefined
        emit('retrying', '差分更新不可用，自动回退完整安装包')
        break
      }
    }
  }
  if (!await verify(part)) {
    mode = 'full'; transferTotal = asset.size; network = 0; tickBytes = 0; tick = Date.now()
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      signal.throwIfAborted()
      const url = options.urls[attempt % options.urls.length]
      source = new URL(url).hostname
      received = await size(part)
      if (received >= asset.size) { await fs.rm(part, { force: true }); received = 0 }
      transferTotal = asset.size - received
      network = 0; tickBytes = 0; tick = Date.now(); speed = 0
      try {
        emit('downloading', received ? '正在继续上次下载' : undefined)
        const offset = received
        await request(url, offset ? `bytes=${offset}-` : undefined, async response => {
          if (response.status !== 200 && response.status !== 206 || !response.body) throw new Error(`下载失败 HTTP ${response.status}`)
          if (response.status === 206 && response.headers.get('content-range') !== `bytes ${offset}-${asset.size - 1}/${asset.size}`) throw new Error('下载服务器返回了错误的文件范围')
          if (response.status === 200) { received = 0; transferTotal = asset.size }
          const output = await fs.open(part, response.status === 206 && offset > 0 ? 'a' : 'w')
          try {
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
              signal.throwIfAborted()
              if (received + chunk.length > asset.size) throw new Error('安装包大小异常')
              await output.writeFile(chunk); received += chunk.length; network += chunk.length; emit()
            }
          } finally { await output.close() }
          if (received !== asset.size) throw new Error('安装包未下载完整')
        })
        emit('verifying')
        if (!await verify(part)) { await fs.rm(part, { force: true }); throw new Error('安装包 SHA-256 校验失败，重新下载') }
        lastError = undefined
        break
      } catch (error) {
        signal.throwIfAborted(); lastError = error
        if (attempt < 3) {
          emit('retrying', `下载中断，正在重试（${attempt + 1}/3）`)
          await delay((options.retryDelayMs ?? 1000) * (attempt + 1), undefined, { signal })
        }
      }
    }
    if (lastError) throw lastError
  }
  signal.throwIfAborted()
  if (!await verify(part)) throw new Error('安装包校验失败')
  await fs.rename(part, file)
  // Cache block maps best-effort. Download/install still succeeds when maps are unavailable.
  try {
    newMap ??= await small(`${options.urls.at(-1)}.blockmap`)
    blocks(newMap, asset.size)
    await fs.writeFile(mapPath, newMap)
    await fs.writeFile(path.join(dir, 'basis.json'), JSON.stringify({ file: name, map: path.basename(mapPath), size: asset.size, digest: expected } satisfies Basis))
    if (basis && basis.file !== name) {
      await fs.rm(path.join(dir, basis.file), { force: true })
      await fs.rm(path.join(dir, basis.map), { force: true })
    }
  } catch { /* Optional cache; final installer has already been verified. */ }
  return file
}
