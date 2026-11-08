import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { store } from './store'
import { aliStore } from './ali/store'
import { aliMemory } from './ali/memory'
import type { BackupInfo } from '../shared/types'
import { t } from '../shared/i18n'

const RETENTION = 7
const DAY_MS = 24 * 60 * 60 * 1000
const CHECK_MS = 6 * 60 * 60 * 1000

function backupsRoot(): string {
  return path.join(app.getPath('userData'), 'backups')
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(full)
    else {
      try {
        total += (await fs.stat(full)).size
      } catch {
        // 文件在统计过程中被移除时忽略
      }
    }
  }
  return total
}

export async function listBackups(): Promise<BackupInfo[]> {
  const base = backupsRoot()
  let names: string[] = []
  try {
    names = await fs.readdir(base)
  } catch {
    return []
  }
  const infos: BackupInfo[] = []
  for (const name of names) {
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(base, name, 'manifest.json'), 'utf-8')
      ) as { createdAt?: unknown }
      infos.push({
        name,
        createdAt: typeof manifest.createdAt === 'number' ? manifest.createdAt : 0,
        size: await directorySize(path.join(base, name))
      })
    } catch {
      // 忽略未完成的备份目录
    }
  }
  return infos.sort((a, b) => b.createdAt - a.createdAt)
}

async function prune(): Promise<void> {
  const base = backupsRoot()
  const list = await listBackups()
  for (const backup of list.slice(RETENTION)) {
    await fs.rm(path.join(base, backup.name), { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function runBackup(): Promise<BackupInfo> {
  const base = backupsRoot()
  await fs.mkdir(base, { recursive: true })
  await aliStore.flush().catch(() => undefined)
  const aliMemoryState = await aliMemory.getState().catch(() => null)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(base, stamp)
  await fs.mkdir(target, { recursive: true })
  await fs.cp(store.root, path.join(target, 'data'), { recursive: true })
  const createdAt = Date.now()
  await fs.writeFile(
    path.join(target, 'manifest.json'),
    JSON.stringify({
      createdAt,
      version: app.getVersion(),
      source: store.root,
      ali: {
        sessions: aliStore.list().length,
        topics: aliMemoryState?.topics.length ?? 0,
        memoryChars: aliMemoryState ? aliMemoryState.memory.length + aliMemoryState.self.length : 0,
        archiveChars: aliMemoryState?.archive.length ?? 0
      }
    }, null, 2),
    'utf-8'
  )
  await prune()
  return { name: stamp, createdAt, size: await directorySize(target) }
}

export async function ensureDailyBackup(): Promise<void> {
  try {
    const latest = (await listBackups())[0]
    if (latest && Date.now() - latest.createdAt < DAY_MS) return
    await runBackup()
  } catch (err) {
    console.warn('[backup] 自动备份失败：', (err as Error).message)
  }
}

export function startBackupScheduler(): void {
  void ensureDailyBackup()
  const timer = setInterval(() => void ensureDailyBackup(), CHECK_MS)
  timer.unref()
}

export async function restoreBackup(name: string): Promise<void> {
  if (!/^[0-9TZ-]+$/.test(name)) throw new Error(t("备份名称不合法"))
  const source = path.join(backupsRoot(), name, 'data')
  const stat = await fs.stat(source).catch(() => null)
  if (!stat || !stat.isDirectory()) throw new Error(t("备份不存在或不完整"))

  const safety = path.join(app.getPath('userData'), 'restore-safety', new Date().toISOString().replace(/[:.]/g, '-'))
  await fs.mkdir(safety, { recursive: true })
  await fs.cp(store.root, safety, { recursive: true })

  await fs.rm(store.root, { recursive: true, force: true })
  await fs.cp(source, store.root, { recursive: true })
  await store.init()
  await aliStore.reload().catch(() => undefined)
  await aliMemory.init().catch(() => undefined)
}
