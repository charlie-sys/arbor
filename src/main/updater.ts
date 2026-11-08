import { app, BrowserWindow, dialog, net, shell } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, promises as fs } from 'fs'
import { once } from 'events'
import path from 'path'
import type {
  UpdateDownloadResult,
  UpdateInfo,
  UpdateInstallResult,
  UpdateProgress
} from '../shared/api'

const OWNER = 'charlie-sys'
const REPO = 'arbor'
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases`
const LATEST_RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
const CACHE_TTL = 10 * 60 * 1000
const ERROR_CACHE_TTL = 2 * 60 * 1000
const REQUEST_TIMEOUT = 12 * 1000
const DOWNLOAD_TIMEOUT = 10 * 60 * 1000

interface GithubAsset {
  name?: unknown
  browser_download_url?: unknown
  size?: unknown
  digest?: unknown
}

interface GithubRelease {
  tag_name?: unknown
  name?: unknown
  html_url?: unknown
  body?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

interface PendingInstaller {
  filePath: string
  version: string
}

let cached: { info: UpdateInfo; expiresAt: number } | null = null
let inFlight: Promise<UpdateInfo> | null = null
let downloading = false
let pendingInstaller: PendingInstaller | null = null

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

function versionParts(raw: string): { numbers: number[]; pre: string } {
  const match = normalizeVersion(raw).match(/^(\d+(?:\.\d+){0,2})(?:-([0-9a-z.-]+))?/i)
  if (!match) return { numbers: [0, 0, 0], pre: '' }
  const numbers = match[1].split('.').map((part) => Number.parseInt(part, 10) || 0)
  while (numbers.length < 3) numbers.push(0)
  return { numbers, pre: match[2] ?? '' }
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] > right.numbers[index] ? 1 : -1
    }
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre.localeCompare(right.pre)
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/abort|timed? ?out/i.test(message)) return '连接 GitHub 超时，请稍后重试'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(message)) {
    return '无法连接 GitHub，请检查网络或代理设置'
  }
  return message
}

function safeReleaseUrl(raw: unknown): string {
  try {
    const url = new URL(String(raw))
    if (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(`/${OWNER}/${REPO}/`)
    ) {
      return url.toString()
    }
  } catch {
    /* ignore malformed url */
  }
  return RELEASES_PAGE
}

function safeAssetUrl(raw: unknown): string | null {
  try {
    const url = new URL(String(raw))
    if (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(`/${OWNER}/${REPO}/releases/download/`)
    ) {
      return url.toString()
    }
  } catch {
    /* ignore malformed url */
  }
  return null
}

function emitProgress(progress: UpdateProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:progress', progress)
  }
}

function emptyInfo(currentVersion: string, error?: string): UpdateInfo {
  return {
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    releaseName: 'Arbor',
    releaseUrl: RELEASES_PAGE,
    notes: '',
    checkedAt: Date.now(),
    error
  }
}

function parseRelease(currentVersion: string, release: GithubRelease): UpdateInfo {
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  if (!tag) throw new Error('GitHub 发布信息缺少版本号')
  const latestVersion = normalizeVersion(tag)
  const assets = Array.isArray(release.assets) ? (release.assets as GithubAsset[]) : []
  const exeAssets = assets.filter(
    (asset) => typeof asset.name === 'string' && /\.exe$/i.test(asset.name)
  )
  const asset =
    exeAssets.find(
      (item) =>
        /setup|install/i.test(String(item.name)) && String(item.name).includes(latestVersion)
    ) ??
    exeAssets.find((item) => /setup|install/i.test(String(item.name))) ??
    exeAssets[0]
  const assetUrl = asset ? safeAssetUrl(asset.browser_download_url) : null

  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    releaseName:
      typeof release.name === 'string' && release.name.trim()
        ? release.name
        : `Arbor v${latestVersion}`,
    releaseUrl: safeReleaseUrl(release.html_url),
    notes: typeof release.body === 'string' ? release.body.slice(0, 12000) : '',
    publishedAt: typeof release.published_at === 'string' ? release.published_at : undefined,
    asset:
      asset && assetUrl
        ? {
            name: String(asset.name),
            url: assetUrl,
            size: typeof asset.size === 'number' ? asset.size : 0,
            digest: typeof asset.digest === 'string' ? asset.digest : undefined
          }
        : undefined,
    checkedAt: Date.now()
  }
}

async function fetchLatestRelease(currentVersion: string): Promise<UpdateInfo> {
  const response = await net.fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `Arbor/${currentVersion}`
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  })

  if (response.status === 404) throw new Error('GitHub 上还没有发布任何版本')
  if (response.status === 403 || response.status === 429) {
    throw new Error('GitHub 接口访问受限（可能触发频率限制），请稍后重试')
  }
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`)

  const release = (await response.json()) as GithubRelease
  if (release.draft === true) throw new Error('最新版本尚未正式发布')
  return parseRelease(currentVersion, release)
}

async function runCheck(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion()
  const info = await fetchLatestRelease(currentVersion).catch((error: unknown) =>
    emptyInfo(currentVersion, describeError(error))
  )
  cached = {
    info,
    expiresAt: Date.now() + (info.error ? ERROR_CACHE_TTL : CACHE_TTL)
  }
  return info
}

export function checkForUpdates(force = false): Promise<UpdateInfo> {
  if (!force && cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.info)
  if (inFlight) return inFlight
  inFlight = runCheck().finally(() => {
    inFlight = null
  })
  return inFlight
}

export async function downloadUpdate(): Promise<UpdateDownloadResult> {
  if (downloading) return { ok: false, message: '更新包正在下载中，请稍候' }
  if (pendingInstaller && existsSync(pendingInstaller.filePath)) {
    emitProgress({
      phase: 'ready',
      percent: 100,
      received: 0,
      total: 0,
      message: `v${pendingInstaller.version} 已下载，可立即安装`
    })
    return { ok: true, filePath: pendingInstaller.filePath, version: pendingInstaller.version }
  }

  const info = await checkForUpdates(true)
  if (info.error) return { ok: false, message: info.error }
  if (!info.hasUpdate) return { ok: false, message: '当前已经是最新版本' }
  if (!info.asset) {
    await openReleasePage()
    return { ok: false, message: '该版本未提供 Windows 安装包，已打开 GitHub 发布页' }
  }

  const total = info.asset.size
  const fileName = path.basename(info.asset.name).replace(/[^a-zA-Z0-9._-]/g, '_')
  const dir = path.join(app.getPath('temp'), 'arbor-updater')
  const filePath = path.join(dir, fileName)
  const hash = createHash('sha256')
  let received = 0
  let lastEmit = 0

  downloading = true
  pendingInstaller = null
  emitProgress({ phase: 'downloading', percent: 0, received: 0, total })

  try {
    await fs.mkdir(dir, { recursive: true })
    const response = await net.fetch(info.asset.url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': `Arbor/${info.currentVersion}`
      },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT)
    })
    if (!response.ok || !response.body) {
      throw new Error(`下载安装包失败（HTTP ${response.status}）`)
    }

    const stream = createWriteStream(filePath)
    try {
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        received += value.byteLength
        hash.update(value)
        if (!stream.write(Buffer.from(value))) await once(stream, 'drain')
        const now = Date.now()
        if (now - lastEmit > 200) {
          lastEmit = now
          emitProgress({
            phase: 'downloading',
            percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0,
            received,
            total
          })
        }
      }
      stream.end()
      await once(stream, 'finish')
    } catch (error) {
      stream.destroy()
      throw error
    }

    if (total > 0 && received !== total) {
      throw new Error('安装包不完整，请重试')
    }

    emitProgress({ phase: 'verifying', percent: 100, received, total })
    const expected = info.asset.digest?.match(/^sha256:([0-9a-f]{64})$/i)?.[1]
    if (expected) {
      const actual = hash.digest('hex')
      if (actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error('安装包校验失败，文件可能已损坏，请重试')
      }
    }

    pendingInstaller = { filePath, version: info.latestVersion }
    emitProgress({
      phase: 'ready',
      percent: 100,
      received,
      total,
      message: `Arbor v${info.latestVersion} 已下载完成`
    })
    return { ok: true, filePath, version: info.latestVersion }
  } catch (error) {
    pendingInstaller = null
    await fs.rm(filePath, { force: true }).catch(() => undefined)
    const message = describeError(error)
    emitProgress({ phase: 'error', percent: 0, received, total, message })
    return { ok: false, message }
  } finally {
    downloading = false
  }
}

export async function installUpdate(): Promise<UpdateInstallResult> {
  if (!pendingInstaller) return { ok: false, message: '尚未下载更新安装包' }
  if (!existsSync(pendingInstaller.filePath)) {
    pendingInstaller = null
    return { ok: false, message: '更新安装包已不存在，请重新下载' }
  }

  const choice = await dialog.showMessageBox({
    type: 'question',
    title: '安装 Arbor 更新',
    message: `Arbor v${pendingInstaller.version} 已下载完成`,
    detail: '点击“立即安装并重启”会关闭 Arbor 并启动安装向导；安装完成后可重新打开应用。',
    buttons: ['立即安装并重启', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  if (choice.response !== 0) {
    return { ok: false, message: '已取消安装，安装包已保留，可稍后再次安装' }
  }

  emitProgress({
    phase: 'installing',
    percent: 100,
    received: 0,
    total: 0,
    message: '正在启动安装程序…'
  })
  const error = await shell.openPath(pendingInstaller.filePath)
  if (error) {
    return { ok: false, message: `启动安装程序失败：${error}` }
  }
  setTimeout(() => app.quit(), 300)
  return { ok: true, message: '正在启动安装程序' }
}

export async function openReleasePage(): Promise<void> {
  const url = cached?.info.releaseUrl ?? RELEASES_PAGE
  await shell.openExternal(safeReleaseUrl(url))
}
