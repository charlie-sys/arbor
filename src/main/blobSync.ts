import crypto from 'crypto'
import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { accountService } from './accountService'
import { store } from './store'
import type { SyncEntity } from '../shared/sync'

const BLOB_ENTITY_TYPE = 'blob_binding'
const SYNC_DIRS = new Set([
  'files',
  'texts',
  'translations',
  'attachments',
  'annotations',
  'ali'
])

interface BlobBinding {
  path: string
  sha256: string
  size: number
  mtimeMs: number
  mimeType: string
}

async function fileHash(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mhtml': 'multipart/related',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bib': 'text/plain; charset=utf-8',
    '.zip': 'application/zip'
  }
  return types[ext] ?? 'application/octet-stream'
}

function safeRelativePath(root: string, filePath: string): string | null {
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  const segments = relative.split(path.sep)
  if (!SYNC_DIRS.has(segments[0] ?? '')) return null
  return segments.join('/')
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(full)
      else if (entry.isFile() && safeRelativePath(root, full)) files.push(full)
    }
  }
  for (const directory of SYNC_DIRS) await visit(path.join(root, directory))
  return files
}

export async function prepareBlobBindings(): Promise<void> {
  const root = store.root
  for (const filePath of await listFiles(root)) {
    const relative = safeRelativePath(root, filePath)
    if (!relative) continue
    const stat = await fsp.stat(filePath)
    let sha256 = ''
    const existing = store.getSyncBinding(BLOB_ENTITY_TYPE, relative) as Partial<BlobBinding> | null
    if (
      existing &&
      existing.sha256 &&
      Number(existing.size) === stat.size &&
      Number(existing.mtimeMs) === stat.mtimeMs
    ) {
      sha256 = existing.sha256
    } else {
      sha256 = await fileHash(filePath)
    }
    const binding: BlobBinding = {
      path: relative,
      sha256,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mimeType: mimeType(filePath)
    }
    store.upsertSyncBinding(BLOB_ENTITY_TYPE, relative, binding)
  }
}

export async function uploadLocalBlobs(): Promise<void> {
  const root = store.root
  const bindings = store
    .listSyncBindings(BLOB_ENTITY_TYPE)
    .map((entity) => entity.payload as BlobBinding)
    .filter((binding) => binding?.path && binding.sha256)
  for (const binding of bindings) {
    const filePath = path.join(root, ...binding.path.split('/'))
    try {
      await fsp.access(filePath)
    } catch {
      continue
    }
    const prepared = await accountService.request('/v1/blobs/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sha256: binding.sha256,
        size: binding.size,
        mimeType: binding.mimeType
      })
    })
    if (prepared.status !== 200) {
      const error = await prepared.json().catch(() => ({})) as { message?: string }
      throw new Error(error.message || '准备文件上传失败')
    }
    const plan = (await prepared.json()) as {
      exists: boolean
      uploadId?: string
    }
    if (plan.exists) continue
    if (!plan.uploadId) throw new Error('服务器未返回文件上传任务')
    const blob = await fs.openAsBlob(filePath, { type: binding.mimeType })
    const form = new FormData()
    form.append('file', blob, path.basename(filePath))
    const uploaded = await accountService.request(
      `/v1/blobs/upload/${encodeURIComponent(plan.uploadId)}`,
      {
        method: 'PUT',
        body: form
      }
    )
    if (!uploaded.ok) {
      const error = await uploaded.json().catch(() => ({})) as { message?: string }
      throw new Error(error.message || '文件上传失败')
    }
  }
}

export async function downloadMissingBlobs(): Promise<void> {
  const root = store.root
  for (const entity of store.listSyncBindings(BLOB_ENTITY_TYPE) as SyncEntity[]) {
    const binding = entity.payload as BlobBinding
    if (!binding?.path || !binding.sha256) continue
    const segments = binding.path.split('/')
    if (!SYNC_DIRS.has(segments[0] ?? '') || segments.some((part) => part === '..')) continue
    const target = path.join(root, ...segments)
    try {
      const stat = await fsp.stat(target)
      if (stat.size === binding.size && (await fileHash(target)) === binding.sha256) continue
    } catch {
      /* Download the missing file. */
    }
    const response = await accountService.request(
      `/v1/blobs/${encodeURIComponent(binding.sha256)}`
    )
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({})) as { message?: string }
      throw new Error(error.message || '下载文件失败')
    }
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.download`
    try {
      await pipeline(
        Readable.fromWeb(response.body as never),
        fs.createWriteStream(temp)
      )
      if ((await fileHash(temp)) !== binding.sha256) {
        throw new Error('下载文件校验失败')
      }
      await fsp.rename(temp, target)
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
