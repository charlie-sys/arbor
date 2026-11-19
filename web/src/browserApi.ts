import type {
  ChatEvent,
  ExportResult,
  ReaderPanelOutlineState,
  ReaderPanelQuote,
  ReaderPanelState,
  ReaderPanelTab,
  TestResult,
  TranslateEvent,
  ZotAgentApi
} from '@shared/api'
import type {
  AccountDevice,
  AccountState,
  DeviceEnrollment
} from '@shared/account'
import { hasAccountAccess } from '@shared/account'
import type {
  AppSettings,
  ActiveUsage,
  BackupInfo,
  CanvasBoard,
  ChatSession,
  Collection,
  DocumentAnnotations,
  DocumentMeta,
  Excerpt,
  Highlight,
  ImportResult,
  InboxAttachment,
  InboxItem,
  LibraryData,
  Property,
  ReadingPlan,
  ResearchTopic,
  SavedView,
  SearchResult,
  Tag,
  TaskItem,
  TranslationRecord,
  UsageRecord
} from '@shared/types'
import type {
  SyncEntity,
  SyncOperation,
  SyncSnapshot,
  SyncSnapshotDetail,
  SyncStatus
} from '@shared/sync'
import type {
  WebBounds,
  WebPageAction,
  WebPageSource,
  WebPageState
} from '@shared/web'
import type {
  AliEvent,
  AliHelpSection,
  AliMemoryState,
  AliSendRequest,
  AliState,
  AliSession
} from '@shared/ali'
import { defaultAliSettings } from '@shared/ali'
import { defaultSystemPrompt } from '@shared/i18n/defaults'
import { estimateTokens, normalizePricing } from '@shared/usage'
import { formatFromFileName } from '@shared/documents'
import { buildAiActionPrompt } from '@shared/aiActions'
import {
  deleteBlob,
  deleteJson,
  getBlob,
  getJson,
  putBlob,
  putJson,
  safePathSegment,
  sha256Hex
} from './browserStorage'
import {
  LIBRARY_ENTITY_TYPES,
  libraryToSyncEntities,
  stableJson,
  syncEntitiesToLibrary,
  syncEntityKey
} from './librarySync'
import { createZip } from './zip'
import {
  getAccountDeviceId,
  rotateAccountDeviceId,
  seedAccountDeviceId
} from './deviceIdentity'
import {
  cancelWebAli,
  consolidateWebAliMemory,
  removeWebAliMemoryLines,
  restoreWebAliMemoryLine,
  sendWebAli,
  testWebAli,
  webAliHelpSections
} from './aliAgent'

type Listener<T> = (value: T) => void

const uid = (): string => crypto.randomUUID()
const now = (): number => Date.now()
const storageKey = 'arbor-web-library-v1'
const accountKey = 'arbor-web-account-v1'

function randomBase64Url(bytes = 48): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  )
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function defaultSettings(): AppSettings {
  return {
    language: 'zh-CN',
    uiFontSize: 14,
    apiBaseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    chatModel: 'deepseek-chat',
    visionModel: '',
    temperature: 0.3,
    maxContextChars: 0,
    systemPrompt: defaultSystemPrompt('zh-CN'),
    usagePricing: normalizePricing(),
    petEnabled: false,
    petBubbles: false,
    ali: defaultAliSettings()
  }
}

function emptyLibrary(): LibraryData {
  return {
    version: 1,
    documents: [],
    collections: [],
    chats: [],
    translations: [],
    highlights: [],
    excerpts: [],
    inbox: [],
    tasks: [],
    researchTopics: [],
    canvases: [],
    tags: [],
    properties: [],
    savedViews: [],
    readingPlans: [],
    settings: defaultSettings()
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing may reject storage.
  }
}

function download(data: BlobPart, name: string, type: string): ExportResult {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { canceled: false, filePath: name }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function webArchiveHtml(title: string, url: string, text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{max-width:860px;margin:0 auto;padding:48px 28px 120px;font:17px/1.75 "Noto Serif SC","Source Han Serif SC",Georgia,serif;color:#2d2926;background:#fbfaf7}
h1{font:700 32px/1.25 "Noto Sans SC","Segoe UI",sans-serif;margin-bottom:8px}.source{color:#777;margin-bottom:36px}
p{margin:0 0 1em;white-space:normal}::selection{background:#f3d97a}
</style></head><body><h1>${escapeHtml(title)}</h1><p class="source">${escapeHtml(url)}</p>${paragraphs}</body></html>`
}

interface BlobBinding {
  path: string
  sha256: string
  size: number
  mimeType: string
  mtimeMs: number
}

class WebLibrary {
  data = readJson<LibraryData>(storageKey, emptyLibrary())
  private listeners = new Set<() => void>()
  private assetListeners = new Set<() => void>()
  private candidates = new Map<string, File>()
  private bindings = new Map<string, BlobBinding>()
  private urls = new Map<string, string>()
  private remoteBlob: ((sha256: string) => Promise<Blob>) | null = null

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onAssetChanged(listener: () => void): () => void {
    this.assetListeners.add(listener)
    return () => this.assetListeners.delete(listener)
  }

  setRemoteLoader(loader: (sha256: string) => Promise<Blob>): void {
    this.remoteBlob = loader
  }

  persist(notify = true): void {
    writeJson(storageKey, this.data)
    if (notify) for (const listener of this.listeners) listener()
  }

  private assetsChanged(): void {
    for (const listener of this.assetListeners) listener()
  }

  pickFiles(accept: string): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.multiple = true
      input.onchange = () => resolve([...(input.files ?? [])])
      input.click()
    })
  }

  pickOne(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.click()
    })
  }

  registerCandidate(file: File): string {
    const token = `web-file:${uid()}`
    this.candidates.set(token, file)
    return token
  }

  documentPath(doc: Pick<DocumentMeta, 'id' | 'fileName'>): string {
    return `files/${doc.id}/${safePathSegment(doc.fileName || 'document')}`
  }

  textPath(docId: string): string {
    return `texts/${docId}.json`
  }

  annotationPath(docId: string): string {
    return `annotations/${docId}.json`
  }

  attachmentPath(ownerId: string, file: string): string {
    return `attachments/${ownerId}/${safePathSegment(file)}`
  }

  translationPath(file: string): string {
    return `translations/${safePathSegment(file)}`
  }

  async saveBoundBlob(
    path: string,
    value: Blob,
    mimeType = value.type || 'application/octet-stream'
  ): Promise<BlobBinding> {
    const sha256 = await sha256Hex(value)
    await putBlob(`sha:${sha256}`, value)
    const binding: BlobBinding = {
      path,
      sha256,
      size: value.size,
      mimeType,
      mtimeMs: now()
    }
    this.bindings.set(path, binding)
    this.assetsChanged()
    return binding
  }

  async importFile(
    token: string,
    title: string,
    collectionId?: string
  ): Promise<DocumentMeta> {
    const file = this.candidates.get(token)
    if (!file) throw new Error('文件已失效，请重新选择')
    const id = uid()
    const timestamp = now()
    const sourceFormat = formatFromFileName(file.name)
    const doc: DocumentMeta = {
      id,
      title: title.trim() || file.name.replace(/\.[^.]+$/, ''),
      authors: '',
      year: '',
      journal: '',
      abstract: '',
      doi: '',
      url: '',
      tags: [],
      collections: collectionId ? [collectionId] : [],
      addedAt: timestamp,
      updatedAt: timestamp,
      fileName: file.name,
      sourceFormat: sourceFormat ?? undefined,
      pageCount: 0,
      starred: false,
      readingStatus: 'unread',
      lastPage: 1,
      notes: ''
    }
    await this.saveBoundBlob(this.documentPath(doc), file, file.type)
    this.candidates.delete(token)
    this.data.documents.unshift(doc)
    this.persist()
    return doc
  }

  binding(path: string): BlobBinding | undefined {
    return this.bindings.get(path)
  }

  bindingForDocument(doc: DocumentMeta): BlobBinding | undefined {
    const fileName = doc.fileName.trim()
    const extension =
      fileName.match(/\.[a-z0-9]{1,12}$/i)?.[0]?.toLowerCase() ??
      (doc.sourceFormat === 'pdf'
        ? '.pdf'
        : doc.sourceFormat === 'docx'
          ? '.docx'
          : '')
    const exactPaths = new Set([
      this.documentPath(doc),
      `files/${doc.id}${extension}`,
      `files/${fileName}`
    ])
    for (const path of exactPaths) {
      const exact = this.bindings.get(path)
      if (exact) return exact
    }

    const nestedPrefix = `files/${doc.id}/`
    const expectedNames = new Set([
      fileName,
      safePathSegment(fileName),
      `${doc.id}${extension}`
    ])
    return [...this.bindings.values()].find((binding) => {
      if (binding.path.startsWith(nestedPrefix)) return true
      const name = binding.path.split('/').at(-1) ?? ''
      return expectedNames.has(name) || name === `${doc.id}${extension}`
    })
  }

  allBindings(): BlobBinding[] {
    return [...this.bindings.values()]
  }

  applyRemoteBindings(bindings: BlobBinding[]): void {
    for (const binding of bindings) {
      if (!binding.path || !binding.sha256) continue
      this.bindings.set(binding.path, binding)
    }
  }

  removeBindingsForPath(path: string): void {
    this.bindings.delete(path)
    const url = this.urls.get(path)
    if (url) URL.revokeObjectURL(url)
    this.urls.delete(path)
    this.assetsChanged()
  }

  async blobForPath(path: string): Promise<Blob | undefined> {
    const binding = this.bindings.get(path)
    if (!binding) return undefined
    let blob = await getBlob(`sha:${binding.sha256}`)
    if (!blob && this.remoteBlob) {
      blob = await this.remoteBlob(binding.sha256)
      if (blob.size !== binding.size) {
        throw new Error('云端文件大小与索引不一致')
      }
      await putBlob(`sha:${binding.sha256}`, blob)
    }
    return blob
  }

  async urlForPath(path: string): Promise<string> {
    const current = this.urls.get(path)
    if (current) return current
    const blob = await this.blobForPath(path)
    if (!blob) throw new Error('文献文件尚未载入，请重新导入或等待云端同步')
    const url = URL.createObjectURL(blob)
    this.urls.set(path, url)
    return url
  }

  async documentUrl(id: string): Promise<string> {
    const doc = this.data.documents.find((item) => item.id === id)
    if (!doc) throw new Error('文献不存在')
    const binding = this.bindingForDocument(doc)
    if (!binding) throw new Error('文献文件尚未载入，请重新导入或等待云端同步')
    return this.urlForPath(binding.path)
  }

  async zotfileUrl(value: string): Promise<string> {
    const parsed = new URL(value)
    const decoded = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    let path = ''
    if (parsed.hostname === 'attachments') {
      const parts = decoded.split('/')
      const ownerId = parts.shift() ?? ''
      path = this.attachmentPath(ownerId, parts.join('/'))
    } else if (parsed.hostname === 'translations') {
      path = this.translationPath(decoded)
    } else if (parsed.hostname === 'files') {
      const fileName = decoded.split('/').at(-1) ?? ''
      const legacyDocId = fileName.replace(/\.[^.]+$/, '')
      path = this.bindings.has(`files/${decoded}`)
        ? `files/${decoded}`
        : [...this.bindings.keys()].find(
            (candidate) =>
              candidate.startsWith(`files/${legacyDocId}/`) ||
              candidate.endsWith(`/${fileName}`)
          ) ?? ''
    }
    if (path) return this.urlForPath(path)
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return value
    }
    throw new Error('文件尚未同步到当前设备')
  }

  async readJsonFile<T>(path: string, fallback: T): Promise<T> {
    try {
      const blob = await this.blobForPath(path)
      if (!blob) return fallback
      return JSON.parse(await blob.text()) as T
    } catch {
      return fallback
    }
  }

  async writeJsonFile(path: string, value: unknown): Promise<void> {
    const blob = new Blob([JSON.stringify(value)], {
      type: 'application/json; charset=utf-8'
    })
    await this.saveBoundBlob(path, blob, 'application/json; charset=utf-8')
  }

  async loadTexts(id: string): Promise<string[]> {
    return this.readJsonFile<string[]>(this.textPath(id), [])
  }

  async saveTexts(id: string, pages: string[]): Promise<void> {
    await this.writeJsonFile(this.textPath(id), pages)
  }

  async loadAnnotations(id: string): Promise<DocumentAnnotations> {
    return this.readJsonFile<DocumentAnnotations>(this.annotationPath(id), {
      version: 1,
      docId: id,
      notes: [],
      strokes: [],
      updatedAt: now()
    })
  }

  async saveAnnotations(id: string, value: DocumentAnnotations): Promise<void> {
    await this.writeJsonFile(this.annotationPath(id), value)
  }
}

interface AccountFile {
  serverUrl: string
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
  deviceId: string
  pendingRequestToken?: string
  state: AccountState
}

interface LoginPayload {
  accessToken: string
  refreshToken: string
  accessExpiresIn: number
  user: AccountState['user']
  device: AccountDevice
  session: AccountState['session']
  isPrimary: boolean
  approvalRequired?: boolean
  requestId?: string
  requestToken?: string
  primaryDeviceName?: string
  expiresAt?: string
}

class BrowserRuntime {
  readonly library = new WebLibrary()
  private accountListeners = new Set<Listener<AccountState>>()
  private sessionListeners = new Set<Listener<AccountState>>()
  private syncListeners = new Set<Listener<SyncStatus>>()
  private settingsListeners = new Set<Listener<AppSettings>>()
  private chatListeners = new Set<Listener<ChatEvent>>()
  private translateListeners = new Set<Listener<TranslateEvent>>()
  private aliListeners = new Set<Listener<AliEvent>>()
  private aliChangedListeners = new Set<() => void>()
  private usageListeners = new Set<
    Listener<{ record?: UsageRecord; cleared?: boolean; active: ActiveUsage[] }>
  >()
  private usageLiveListeners = new Set<Listener<ActiveUsage[]>>()
  private panelListeners = new Set<(message: Record<string, unknown>) => void>()
  private panelChannel: BroadcastChannel | null =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel('arbor-reader-panel')
  private readerPanelState: ReaderPanelState = {
    open: false,
    docId: null,
    tab: 'agent',
    activeChatId: null,
    pinned: false
  }
  private account: AccountFile | null = readJson<AccountFile | null>(accountKey, null)
  private syncing = false
  private syncRerun = false
  private syncScheduled: number | null = null
  private syncKnown = new Map<string, SyncEntity>()
  private uploadedHashes = new Set<string>()
  private localRevision = 0
  private remoteReady = false
  private applyingRemote = false
  private lastSyncedAt: number | null = null
  private lastError = ''
  private socket: WebSocket | null = null
  private socketRetry: number | null = null
  private socketRetryDelay = 1000
  private pendingPoll: number | null = null
  private chatControllers = new Map<string, AbortController>()
  private aliControllers = new Map<string, AbortController>()
  private importControllers = new Map<string, AbortController>()
  private activeWeb = {
    docId: '',
    url: '',
    title: '',
    source: 'online' as 'online' | 'offline',
    loading: false,
    error: ''
  }
  private serverUrl = localStorage.getItem('arbor-web-server') || location.origin

  constructor() {
    if (this.account) this.serverUrl = this.account.serverUrl
    if (this.account?.state.user?.email) {
      seedAccountDeviceId(
        localStorage,
        this.account.serverUrl,
        this.account.state.user.email,
        this.account.deviceId
      )
    }
    if (this.panelChannel) {
      this.panelChannel.onmessage = (event) => {
        const message = event.data as Record<string, unknown>
        if (!message || typeof message.type !== 'string') return
        if (message.type === 'closed') {
          this.readerPanelState = {
            ...this.readerPanelState,
            open: false,
            docId: null
          }
        }
        for (const listener of this.panelListeners) listener(message)
      }
    }
    this.library.setRemoteLoader(async (sha256) => {
      if (!this.account || this.account.state.status !== 'active') {
        throw new Error('请先登录后再读取云端文件')
      }
      const response = await this.request(
        `/v1/blobs/${encodeURIComponent(sha256)}`
      )
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? '云端文件尚未上传完成，请稍后重试'
            : `下载云端文件失败 (${response.status})`
        )
      }
      return response.blob()
    })
    this.library.onChanged(() => {
      if (this.applyingRemote) return
      this.localRevision += 1
      this.scheduleSync()
    })
    this.library.onAssetChanged(() => {
      if (this.applyingRemote) return
      this.localRevision += 1
      this.scheduleSync()
    })
    if (new URL(location.href).searchParams.has('code')) {
      void this.completeOidcLogin()
    } else if (
      this.account?.state.status === 'pendingApproval' &&
      this.account.pendingRequestToken
    ) {
      void this.pollPendingApproval()
    } else if (this.account) {
      void this.initializeSession()
    }
    window.addEventListener('online', () => {
      if (this.account?.state.status === 'active') {
        void this.refresh().then(() => this.scheduleSync(0))
      }
    })
  }

  accountState(): AccountState {
    return (
      this.account?.state ?? {
        status: 'signedOut',
        serverUrl: this.serverUrl,
        user: null,
        device: null,
        session: null,
        isPrimary: false,
        pendingApproval: null
      }
    )
  }

  assertAccountAccess(): void {
    if (!hasAccountAccess(this.accountState())) {
      throw new Error('请先登录后再使用阿栗')
    }
  }

  onAccount(listener: Listener<AccountState>): () => void {
    this.accountListeners.add(listener)
    return () => this.accountListeners.delete(listener)
  }

  onReplaced(listener: Listener<AccountState>): () => void {
    this.sessionListeners.add(listener)
    return () => this.sessionListeners.delete(listener)
  }

  onSync(listener: Listener<SyncStatus>): () => void {
    this.syncListeners.add(listener)
    return () => this.syncListeners.delete(listener)
  }

  private updateAccount(patch: Partial<AccountState>): AccountState {
    const state = { ...this.accountState(), ...patch }
    if (this.account) {
      this.account.state = state
      writeJson(accountKey, this.account)
    }
    for (const listener of this.accountListeners) listener(state)
    return state
  }

  async request(
    path: string,
    init: RequestInit = {},
    authenticated = true
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    if (authenticated) {
      if (!this.account) throw new Error('请先登录')
      if (this.account.accessExpiresAt <= now() + 20_000) await this.refresh()
      headers.set('authorization', `Bearer ${this.account.accessToken}`)
    }
    let response = await fetch(`${this.serverUrl}${path}`, { ...init, headers })
    if (response.status === 409 || response.status === 401) {
      const data = (await response.clone().json().catch(() => ({}))) as {
        code?: string
        message?: string
      }
      if (data.code === 'SESSION_REPLACED') {
        this.revoke(data.message || '账号已在另一台设备登录')
      } else if (response.status === 401 && authenticated && this.account) {
        await this.refresh().catch(() => undefined)
        if (this.account?.accessToken) {
          headers.set('authorization', `Bearer ${this.account.accessToken}`)
          response = await fetch(`${this.serverUrl}${path}`, {
            ...init,
            headers
          })
          if (response.status === 409) {
            const retryData = (await response
              .clone()
              .json()
              .catch(() => ({}))) as { code?: string; message?: string }
            if (retryData.code === 'SESSION_REPLACED') {
              this.revoke(
                retryData.message || '账号已在另一台设备登录'
              )
            }
          }
        }
      }
    }
    return response
  }

  async responseJson<T>(response: Response): Promise<T> {
    const data = (await response.json().catch(() => ({}))) as T & {
      message?: string
    }
    if (!response.ok) throw new Error(data.message || `请求失败 (${response.status})`)
    return data
  }

  private async initializeSession(): Promise<void> {
    if (!this.account || !this.account.refreshToken) return
    this.syncing = true
    this.remoteReady = false
    this.notifySync()
    try {
      if (this.account.accessExpiresAt <= now() + 20_000) await this.refresh()
      const response = await this.request('/v1/account')
      const account = await this.responseJson<{
        userId: string
        email: string
        displayName: string
        deviceId: string
        deviceName: string
        sessionId: string
        sessionEpoch: number
        isPrimary: boolean
      }>(response)
      this.updateAccount({
        status: 'active',
        user: {
          id: account.userId,
          email: account.email,
          displayName: account.displayName
        },
        device: {
          id: account.deviceId,
          name: account.deviceName,
          platform: 'web',
          active: true,
          current: true,
          primary: account.isPrimary
        },
        session: {
          id: account.sessionId,
          epoch: account.sessionEpoch,
          status: 'active',
          initialSyncMode: 'cloud-first'
        },
        isPrimary: account.isPrimary,
        pendingApproval: null,
        lastError: undefined
      })
      await this.pullLibrary()
      this.connectSocket()
    } catch (error) {
      const message = (error as Error).message
      if (!message.includes('登录')) {
        this.updateAccount({
          status: this.account?.state.user ? 'offline' : 'signedOut',
          lastError: message
        })
      }
    } finally {
      this.syncing = false
      this.notifySync()
    }
  }

  async signIn(
    email: string,
    displayName?: string,
    serverUrl = this.serverUrl,
    intent: 'cloud-first' | 'merge-local' = 'cloud-first'
  ) {
    const normalized = serverUrl.replace(/\/+$/, '')
    const currentAccountMatches =
      this.account &&
      this.account.serverUrl.replace(/\/+$/, '').toLowerCase() ===
        normalized.toLowerCase() &&
      this.account.state.user?.email.toLowerCase() === email.trim().toLowerCase()
    let deviceId = getAccountDeviceId(
      localStorage,
      normalized,
      email,
      currentAccountMatches ? this.account?.deviceId : undefined
    )
    localStorage.setItem('arbor-web-server', normalized)
    const login = (id: string): Promise<Response> =>
      fetch(`${normalized}/v1/auth/dev-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          displayName,
          intent,
          device: {
            id,
            name: `${navigator.platform || 'Browser'} · Arbor Web`,
            platform: 'web',
            appVersion: '0.1.19'
          }
        })
      })
    let response = await login(deviceId)
    if (response.status === 409) {
      const conflict = (await response.clone().json().catch(() => ({}))) as {
        code?: string
      }
      if (conflict.code === 'DEVICE_CONFLICT') {
        deviceId = rotateAccountDeviceId(localStorage, normalized, email)
        response = await login(deviceId)
      }
    }
    const payload = await this.responseJson<LoginPayload>(response)
    return this.acceptLogin(payload, normalized, deviceId)
  }

  private async acceptLogin(
    payload: LoginPayload,
    normalized: string,
    deviceId: string
  ): Promise<AccountState> {
    this.serverUrl = normalized
    localStorage.setItem('arbor-web-server', normalized)
    if (payload.user?.email) {
      seedAccountDeviceId(
        localStorage,
        normalized,
        payload.user.email,
        payload.device.id || deviceId
      )
    }
    this.uploadedHashes.clear()
    if (payload.approvalRequired) {
      this.account = {
        serverUrl: normalized,
        accessToken: '',
        refreshToken: '',
        accessExpiresAt: 0,
        deviceId: payload.device.id || deviceId,
        pendingRequestToken: payload.requestToken,
        state: {
          status: 'pendingApproval',
          serverUrl: normalized,
          user: payload.user,
          device: { ...payload.device, active: false, current: true },
          session: payload.session,
          isPrimary: false,
          pendingApproval: {
            requestId: payload.requestId ?? '',
            primaryDeviceName: payload.primaryDeviceName ?? '主设备',
            intent: 'cloud-first',
            expiresAt: payload.expiresAt ?? ''
          }
        }
      }
      writeJson(accountKey, this.account)
      this.remoteReady = false
      this.updateAccount({})
      this.notifySync()
      return this.accountState()
    }
    this.account = {
      serverUrl: normalized,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      accessExpiresAt: now() + payload.accessExpiresIn * 1000,
      deviceId: payload.device.id || deviceId,
      state: {
        status: 'active',
        serverUrl: normalized,
        user: payload.user,
        device: { ...payload.device, active: true, current: true },
        session: payload.session,
        isPrimary: payload.isPrimary,
        pendingApproval: null
      }
    }
    writeJson(accountKey, this.account)
    this.remoteReady = false
    this.updateAccount({})
    await this.pullLibrary()
    this.connectSocket()
    return this.accountState()
  }

  private async pollPendingApproval(): Promise<void> {
    if (!this.account) return
    const account = this.account
    const pendingApproval = account.state.pendingApproval
    if (
      account.state.status !== 'pendingApproval' ||
      !account.pendingRequestToken ||
      !pendingApproval?.requestId
    ) {
      return
    }
    if (this.pendingPoll !== null) window.clearTimeout(this.pendingPoll)
    try {
      const response = await fetch(
        `${account.serverUrl}/v1/auth/device-requests/${encodeURIComponent(
          pendingApproval.requestId
        )}/claim`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestToken: account.pendingRequestToken })
        }
      )
      if (response.status === 202) {
        this.pendingPoll = window.setTimeout(
          () => void this.pollPendingApproval(),
          3000
        )
        return
      }
      const payload = await this.responseJson<LoginPayload>(response)
      this.pendingPoll = null
      await this.acceptLogin(payload, account.serverUrl, account.deviceId)
    } catch (error) {
      this.updateAccount({ lastError: (error as Error).message })
      this.pendingPoll = null
    }
  }

  async signInOidc(
    serverUrlInput: string,
    _intent: 'cloud-first' | 'merge-local' = 'cloud-first'
  ): Promise<AccountState> {
    const normalized = serverUrlInput.replace(/\/+$/, '')
    const verifier = randomBase64Url()
    const challenge = await pkceChallenge(verifier)
    const state = randomBase64Url(24)
    const deviceId = this.account?.deviceId || uid()
    localStorage.setItem('arbor-web-server', normalized)
    sessionStorage.setItem(
      'arbor-web-oidc',
      JSON.stringify({ verifier, state, serverUrl: normalized, deviceId })
    )
    const start = await this.responseJson<{ authorizeUrl: string }>(
      await fetch(`${normalized}/v1/auth/oidc/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirectUri: `${location.origin}/`,
          state,
          codeChallenge: challenge
        })
      })
    )
    location.assign(start.authorizeUrl)
    return {
      status: 'signingIn',
      serverUrl: normalized,
      user: null,
      device: null,
      session: null,
      isPrimary: false,
      pendingApproval: null
    }
  }

  private async completeOidcLogin(): Promise<void> {
    const url = new URL(location.href)
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    let saved: {
      verifier: string
      state: string
      serverUrl: string
      deviceId?: string
    } | null = null
    try {
      const raw = sessionStorage.getItem('arbor-web-oidc')
      saved = raw
        ? (JSON.parse(raw) as {
            verifier: string
            state: string
            serverUrl: string
            deviceId?: string
          })
        : null
    } catch {
      saved = null
    }
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    history.replaceState({}, '', url.toString())
    if (!code || !returnedState || !saved || saved.state !== returnedState) {
      this.updateAccount({
        status: 'signedOut',
        lastError: 'OIDC 登录状态校验失败'
      })
      return
    }
    sessionStorage.removeItem('arbor-web-oidc')
    let deviceId =
      saved.deviceId && /^[0-9a-f-]{36}$/i.test(saved.deviceId)
        ? saved.deviceId
        : uid()
    try {
      const exchange = (id: string): Promise<Response> =>
        fetch(`${saved!.serverUrl}/v1/auth/oidc/exchange`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            codeVerifier: saved.verifier,
            intent: 'cloud-first',
            device: {
              id,
              name: `${navigator.platform || 'Browser'} · Arbor Web`,
              platform: 'web',
              appVersion: '0.1.19'
            }
          })
        })
      let response = await exchange(deviceId)
      if (response.status === 409) {
        const conflict = (await response.clone().json().catch(() => ({}))) as {
          code?: string
        }
        if (conflict.code === 'DEVICE_CONFLICT') {
          deviceId = uid()
          response = await exchange(deviceId)
        }
      }
      await this.acceptLogin(
        await this.responseJson<LoginPayload>(response),
        saved.serverUrl,
        deviceId
      )
    } catch (error) {
      this.updateAccount({
        status: 'signedOut',
        lastError: (error as Error).message
      })
    }
  }

  async refresh(): Promise<void> {
    if (!this.account) throw new Error('登录已失效')
    const response = await fetch(`${this.account.serverUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refreshToken: this.account.refreshToken,
        deviceId: this.account.deviceId
      })
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      this.revoke(data.message || '登录已失效')
      throw new Error(data.message || '登录已失效')
    }
    const payload = (await response.json()) as {
      accessToken: string
      refreshToken: string
      accessExpiresIn: number
      session: AccountState['session']
      isPrimary: boolean
    }
    this.account.accessToken = payload.accessToken
    this.account.refreshToken = payload.refreshToken
    this.account.accessExpiresAt = now() + payload.accessExpiresIn * 1000
    this.updateAccount({
      status: 'active',
      session: payload.session,
      isPrimary: payload.isPrimary
    })
  }

  async logout(): Promise<AccountState> {
    const serverUrl = this.serverUrl
    const accessToken = this.account?.accessToken
    this.socket?.close()
    this.socket = null
    if (this.socketRetry !== null) window.clearTimeout(this.socketRetry)
    this.socketRetry = null
    if (this.pendingPoll !== null) window.clearTimeout(this.pendingPoll)
    this.pendingPoll = null
    this.account = null
    this.remoteReady = false
    this.uploadedHashes.clear()
    localStorage.removeItem(accountKey)
    const state: AccountState = {
      status: 'signedOut',
      serverUrl: this.serverUrl,
      user: null,
      device: null,
      session: null,
      isPrimary: false,
      pendingApproval: null
    }
    this.notifySync()
    for (const listener of this.accountListeners) listener(state)
    if (accessToken) {
      void fetch(`${serverUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`
        },
        body: '{}'
      }).catch(() => undefined)
    }
    return state
  }

  private revoke(message: string): void {
    this.socket?.close(4001, 'Session replaced')
    this.socket = null
    this.remoteReady = false
    if (!this.account) return
    this.account.accessToken = ''
    this.account.refreshToken = ''
    const state = this.updateAccount({
      status: 'revoked',
      session: this.accountState().session
        ? { ...this.accountState().session!, status: 'revoked' }
        : null,
      lastError: message
    })
    this.notifySync()
    for (const listener of this.sessionListeners) listener(state)
  }

  private async connectSocket(): Promise<void> {
    if (!this.account || this.account.state.status !== 'active') return
    if (this.socketRetry !== null) window.clearTimeout(this.socketRetry)
    this.socketRetry = null
    this.socket?.close()
    try {
      const response = await this.request('/v1/session/socket-ticket', {
        method: 'POST'
      })
      const { ticket } = await this.responseJson<{ ticket: string }>(response)
      const url = new URL('/v1/session/socket', this.serverUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('ticket', ticket)
      this.socket = new WebSocket(url)
      this.socket.onmessage = (event) => {
        let message: { type?: string }
        try {
          message = JSON.parse(String(event.data)) as { type?: string }
        } catch {
          return
        }
        if (message.type === 'session.revoked') {
          this.revoke('账号已在另一台设备登录')
        } else if (message.type === 'sync.changed') {
          this.scheduleSync(60)
        }
      }
      this.socket.onopen = () => {
        this.socketRetryDelay = 1000
      }
      this.socket.onclose = (event) => {
        if (event.code === 4001 || event.code === 4003) {
          this.revoke('账号已在另一台设备登录')
          return
        }
        if (this.account?.state.status === 'active') {
          this.socketRetry = window.setTimeout(() => {
            this.socketRetry = null
            void this.connectSocket()
          }, this.socketRetryDelay)
          this.socketRetryDelay = Math.min(30_000, this.socketRetryDelay * 2)
        }
      }
    } catch {
      this.socketRetry = window.setTimeout(() => {
        this.socketRetry = null
        void this.connectSocket()
      }, this.socketRetryDelay)
      this.socketRetryDelay = Math.min(30_000, this.socketRetryDelay * 2)
    }
  }

  syncStatus(): SyncStatus {
    return {
      status:
        this.account?.state.status !== 'active'
          ? 'signedOut'
          : this.syncing
            ? 'syncing'
            : this.lastError
              ? 'error'
              : 'idle',
      pending: 0,
      conflicts: 0,
      initialMerge: null,
      initialSyncReady:
        Boolean(this.account?.state.status === 'active') && this.remoteReady,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError
    }
  }

  private notifySync(): void {
    const status = this.syncStatus()
    for (const listener of this.syncListeners) listener(status)
  }

  private scheduleSync(delay = 300): void {
    if (!this.account || this.account.state.status !== 'active') return
    if (this.syncScheduled !== null) window.clearTimeout(this.syncScheduled)
    this.syncScheduled = window.setTimeout(() => {
      this.syncScheduled = null
      void this.syncNow()
    }, delay)
  }

  async syncNow(): Promise<void> {
    if (!this.account || this.account.state.status !== 'active' || this.syncing) {
      if (this.syncing) this.syncRerun = true
      return
    }
    this.syncing = true
    this.syncRerun = false
    this.lastError = ''
    this.notifySync()
    try {
      await this.uploadLocalBlobs()
      await this.pushRemoteChanges()
      const revisionAfterPush = this.localRevision
      await this.pullRemoteSnapshot(revisionAfterPush)
      this.lastSyncedAt = now()
      this.remoteReady = true
    } catch (error) {
      this.lastError = (error as Error).message
    } finally {
      this.syncing = false
      this.notifySync()
      if (this.syncRerun) {
        this.syncRerun = false
        this.scheduleSync(100)
      }
    }
  }

  private async pullLibrary(): Promise<void> {
    if (!this.account || this.account.state.status !== 'active') return
    this.syncing = true
    this.remoteReady = false
    this.notifySync()
    try {
      await this.pullRemoteSnapshot()
      this.lastSyncedAt = now()
      this.lastError = ''
      this.remoteReady = true
    } catch (error) {
      this.lastError = (error as Error).message
    } finally {
      this.syncing = false
      this.notifySync()
    }
  }

  private async fetchRemoteSnapshot(): Promise<SyncEntity[]> {
    const entities: SyncEntity[] = []
    let cursorType = ''
    let cursorId = ''
    let snapshotSeq = 0
    for (let page = 0; page < 1000; page++) {
      const params = new URLSearchParams({ limit: '200' })
      if (cursorType) params.set('cursorType', cursorType)
      if (cursorId) params.set('cursorId', cursorId)
      if (snapshotSeq) params.set('afterSeq', String(snapshotSeq))
      const response = await this.request(`/v1/sync/snapshot?${params}`)
      const data = await this.responseJson<{
        entities: SyncEntity[]
        snapshotSeq: number
        hasMore: boolean
        nextCursor: { entityType: string; entityId: string } | null
      }>(response)
      entities.push(...data.entities)
      snapshotSeq = data.snapshotSeq
      if (!data.hasMore || !data.nextCursor) break
      cursorType = data.nextCursor.entityType
      cursorId = data.nextCursor.entityId
    }
    return entities
  }

  private async pullRemoteSnapshot(expectedRevision?: number): Promise<void> {
    const entities = await this.fetchRemoteSnapshot()
    this.syncKnown = new Map(
      entities.map((entity) => [
        syncEntityKey(entity.entityType, entity.entityId),
        entity
      ])
    )
    this.library.applyRemoteBindings(
      entities
        .filter(
          (entity) =>
            !entity.deleted && entity.entityType === 'blob_binding'
        )
        .map((entity) => entity.payload as BlobBinding)
        .filter(
          (binding) =>
            Boolean(
              binding &&
                typeof binding.path === 'string' &&
                typeof binding.sha256 === 'string'
            )
        )
    )
    const aliSessions = entities
      .filter(
        (entity) =>
          !entity.deleted && entity.entityType === 'ali_session'
      )
      .map((entity) => entity.payload as { position: number; session: AliSession })
      .filter(
        (item) =>
          Number.isFinite(item?.position) &&
          item?.session &&
          typeof item.session.id === 'string'
      )
      .sort((left, right) => left.position - right.position)
      .map((item) => item.session)
    const aliMemory = entities.find(
      (entity) =>
        !entity.deleted && entity.entityType === 'ali_memory'
    )?.payload as AliMemoryState | undefined
    writeJson('arbor-web-ali-sessions', aliSessions)
    for (const listener of this.aliChangedListeners) listener()
    if (aliMemory) {
      writeJson('arbor-web-ali-memory-v1', aliMemory)
    }
    const usageRecords = entities
      .filter(
        (entity) =>
          !entity.deleted && entity.entityType === 'usage_record'
      )
      .map((entity) => entity.payload as UsageRecord)
      .filter(
        (record) =>
          record &&
          typeof record.id === 'string' &&
          Number.isFinite(record.createdAt)
      )
      .sort((left, right) => right.createdAt - left.createdAt)
    const previousUsage = new Set(
      readJson<UsageRecord[]>('arbor-web-usage-v1', []).map(
        (record) => record.id
      )
    )
    writeJson('arbor-web-usage-v1', usageRecords)
    for (const record of usageRecords) {
      if (!previousUsage.has(record.id)) {
        for (const listener of this.usageListeners) {
          listener({ record, active: [] })
        }
      }
    }
    if (
      expectedRevision !== undefined &&
      this.localRevision !== expectedRevision
    ) {
      this.syncRerun = true
      return
    }
    this.applyingRemote = true
    try {
      this.library.data = syncEntitiesToLibrary(entities, this.library.data)
      this.library.persist()
    } finally {
      this.applyingRemote = false
    }
    this.settingsChanged()
  }

  private async uploadLocalBlobs(): Promise<void> {
    if (!this.account || this.account.state.status !== 'active') return
    for (const binding of this.library.allBindings()) {
      if (this.uploadedHashes.has(binding.sha256)) continue
      const blob = await getBlob(`sha:${binding.sha256}`)
      if (!blob) continue
      const prepared = await this.request('/v1/blobs/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sha256: binding.sha256,
          size: blob.size,
          mimeType: binding.mimeType || blob.type || 'application/octet-stream'
        })
      })
      const plan = await this.responseJson<{
        exists: boolean
        uploadId?: string
      }>(prepared)
      if (!plan.exists) {
        if (!plan.uploadId) throw new Error('服务器未返回文件上传任务')
        const form = new FormData()
        form.append(
          'file',
          blob,
          safePathSegment(binding.path.split('/').at(-1) ?? 'file')
        )
        await this.responseJson(
          await this.request(
            `/v1/blobs/upload/${encodeURIComponent(plan.uploadId)}`,
            { method: 'PUT', body: form }
          )
        )
      }
      this.uploadedHashes.add(binding.sha256)
    }
  }

  private bindingEntity(binding: BlobBinding): SyncEntity {
    const known = this.syncKnown.get(
      syncEntityKey('blob_binding', binding.path)
    )
    return {
      entityType: 'blob_binding',
      entityId: binding.path,
      version: known?.version ?? 1,
      payload: binding,
      deleted: false
    }
  }

  private async pushRemoteChanges(): Promise<void> {
    const current = new Map<string, SyncEntity>()
    for (const entity of libraryToSyncEntities(this.library.data)) {
      current.set(syncEntityKey(entity.entityType, entity.entityId), entity)
    }
    for (const binding of this.library.allBindings()) {
      const entity = this.bindingEntity(binding)
      current.set(syncEntityKey(entity.entityType, entity.entityId), entity)
    }
    for (const entity of this.aliEntities()) {
      current.set(syncEntityKey(entity.entityType, entity.entityId), entity)
    }
    for (const entity of this.usageEntities()) {
      current.set(syncEntityKey(entity.entityType, entity.entityId), entity)
    }

    const operations: SyncOperation[] = []
    for (const [key, entity] of current) {
      const known = this.syncKnown.get(key)
      if (known && !known.deleted && stableJson(known.payload) === stableJson(entity.payload)) {
        continue
      }
      const baseVersion = known?.version ?? 0
      operations.push({
        ...entity,
        opId: uid(),
        baseVersion,
        operation: 'put',
        version: baseVersion + 1
      })
    }

    const libraryTypes = new Set<string>([
      ...LIBRARY_ENTITY_TYPES,
      'blob_binding',
      'ali_session',
      'ali_memory'
    ])
    for (const [key, known] of this.syncKnown) {
      if (
        known.deleted ||
        !libraryTypes.has(known.entityType) ||
        current.has(key)
      ) {
        continue
      }
      operations.push({
        opId: uid(),
        entityType: known.entityType,
        entityId: known.entityId,
        baseVersion: known.version,
        version: known.version + 1,
        operation: 'delete',
        payload: null,
        deleted: true
      })
    }

    let offset = 0
    while (offset < operations.length) {
      const batch: SyncOperation[] = []
      let bytes = 0
      while (offset < operations.length && batch.length < 400) {
        const operation = operations[offset]
        const size = new TextEncoder().encode(JSON.stringify(operation)).length
        if (batch.length > 0 && bytes + size > 512 * 1024) break
        batch.push(operation)
        bytes += size
        offset++
      }
      const result = await this.responseJson<{
        accepted: string[]
        latestSeq: number
      }>(
        await this.request('/v1/sync/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operations: batch })
        })
      )
      const accepted = new Set(result.accepted)
      for (const operation of batch) {
        if (!accepted.has(operation.opId)) {
          throw new Error('同步服务未确认全部本地更改')
        }
        const next: SyncEntity = {
          entityType: operation.entityType,
          entityId: operation.entityId,
          version: operation.version,
          payload: operation.payload,
          deleted: Boolean(operation.deleted)
        }
        this.syncKnown.set(
          syncEntityKey(operation.entityType, operation.entityId),
          next
        )
      }
    }
  }

  async snapshots(): Promise<{ retentionDays: number; snapshots: SyncSnapshot[] }> {
    return this.responseJson(await this.request('/v1/snapshots'))
  }

  async snapshotChanges(id: string): Promise<SyncSnapshotDetail> {
    return this.responseJson(
      await this.request(`/v1/snapshots/${encodeURIComponent(id)}/changes`)
    )
  }

  async restoreSnapshot(id: string): Promise<{ ok: boolean; latestSeq: number }> {
    const result = await this.responseJson<{ ok: boolean; latestSeq: number }>(
      await this.request(`/v1/snapshots/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
        body: '{}'
      })
    )
    await this.pullLibrary()
    return result
  }

  settingsChanged(): void {
    for (const listener of this.settingsListeners) listener(this.library.data.settings)
  }

  onSettings(listener: Listener<AppSettings>): () => void {
    this.settingsListeners.add(listener)
    return () => this.settingsListeners.delete(listener)
  }

  onChat(listener: Listener<ChatEvent>): () => void {
    this.chatListeners.add(listener)
    return () => this.chatListeners.delete(listener)
  }

  onTranslate(listener: Listener<TranslateEvent>): () => void {
    this.translateListeners.add(listener)
    return () => this.translateListeners.delete(listener)
  }

  onUsage(listener: Listener<{ record?: UsageRecord; cleared?: boolean; active: ActiveUsage[] }>): () => void {
    this.usageListeners.add(listener)
    return () => this.usageListeners.delete(listener)
  }

  onUsageLive(listener: Listener<ActiveUsage[]>): () => void {
    this.usageLiveListeners.add(listener)
    return () => this.usageLiveListeners.delete(listener)
  }

  onPanelMessage(listener: (message: Record<string, unknown>) => void): () => void {
    this.panelListeners.add(listener)
    return () => this.panelListeners.delete(listener)
  }

  sendPanel(message: Record<string, unknown>): void {
    this.panelChannel?.postMessage(message)
  }

  panelState(): ReaderPanelState {
    return { ...this.readerPanelState }
  }

  async openPanel(
    docId: string,
    tab: ReaderPanelTab,
    activeChatId: string | null
  ): Promise<ReaderPanelState> {
    this.readerPanelState = {
      ...this.readerPanelState,
      open: true,
      docId,
      tab,
      activeChatId
    }
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('panelDoc', docId)
    url.searchParams.set('panelTab', tab)
    if (activeChatId) url.searchParams.set('panelChat', activeChatId)
    const opened = window.open(
      url.toString(),
      `arbor-reader-${docId}`,
      'popup,width=430,height=820'
    )
    if (!opened) {
      this.readerPanelState.open = false
      throw new Error('浏览器阻止了独立面板窗口，请允许本站打开弹出窗口')
    }
    return this.panelState()
  }

  closePanel(): void {
    this.readerPanelState = {
      ...this.readerPanelState,
      open: false,
      docId: null
    }
    this.sendPanel({ type: 'closed' })
    if (new URL(location.href).searchParams.has('panelDoc')) window.close()
  }

  recordUsage(input: {
    kind: 'chat' | 'action' | 'translate' | 'ali' | 'ali-memory'
    model: string
    prompt: string
    completion: string
    chatId?: string
  }): UsageRecord {
    const record: UsageRecord = {
      id: uid(),
      createdAt: now(),
      kind: input.kind,
      model: input.model,
      promptTokens: estimateTokens(input.prompt),
      completionTokens: estimateTokens(input.completion),
      chatId: input.chatId,
      estimated: true
    }
    const records = readJson<UsageRecord[]>('arbor-web-usage-v1', [])
    writeJson('arbor-web-usage-v1', [record, ...records].slice(0, 5000))
    for (const listener of this.usageListeners) listener({ record, active: [] })
    this.scheduleSync()
    return record
  }

  private usageEntities(): SyncEntity[] {
    return readJson<UsageRecord[]>('arbor-web-usage-v1', [])
      .filter(
        (record) =>
          record &&
          typeof record.id === 'string' &&
          Number.isFinite(record.createdAt)
      )
      .map((record) => ({
        entityType: 'usage_record',
        entityId: record.id,
        version: 1,
        payload: record,
        deleted: false
      }))
  }

  aliState(): AliState {
    this.assertAccountAccess()
    return {
      sessions: readJson<AliSession[]>('arbor-web-ali-sessions', []),
      settings: this.library.data.settings.ali,
      dataDir: '浏览器本地存储'
    }
  }

  saveAliSessions(sessions: AliSession[]): void {
    writeJson('arbor-web-ali-sessions', sessions)
    for (const listener of this.aliChangedListeners) listener()
    this.scheduleSync()
  }

  private aliEntities(): SyncEntity[] {
    const sessions = this.aliState().sessions
    return [
      ...sessions.map((session, position) => ({
        entityType: 'ali_session',
        entityId: session.id,
        version: 1,
        payload: { position, session },
        deleted: false
      })),
      {
        entityType: 'ali_memory',
        entityId: 'default',
        version: 1,
        payload: this.readAliMemory(),
        deleted: false
      }
    ]
  }

  async sendChat(req: {
    requestId: string
    chatId: string
    docIds: string[]
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    context?: unknown
  }): Promise<{ ok: boolean }> {
    const settings = this.library.data.settings
    if (!settings.apiKey || !settings.apiBaseUrl) {
      throw new Error('请先在设置中配置模型服务')
    }
    const emit = (event: ChatEvent): void => {
      for (const listener of this.chatListeners) listener(event)
    }
    const documents = (
      await Promise.all(
        req.docIds.map(async (docId) => {
          const doc = this.library.data.documents.find((item) => item.id === docId)
          const pages = await this.library.loadTexts(docId)
          const text = pages.join('\n\n').trim()
          return doc && text ? `《${doc.title}》\n${text}` : ''
        })
      )
    ).filter(Boolean)
    const contextLimit = settings.maxContextChars > 0
      ? settings.maxContextChars
      : 120_000
    let context = documents.join('\n\n---\n\n')
    if (context.length > contextLimit) {
      context = `${context.slice(0, contextLimit)}\n\n[文献上下文已按设置截断]`
    }
    if (context) emit({ requestId: req.requestId, type: 'context', promptContext: context })
    const controller = new AbortController()
    this.chatControllers.set(req.requestId, controller)
    const response = await fetch(
      `${settings.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.chatModel,
          temperature: settings.temperature,
          stream: true,
          messages: [
            {
              role: 'system',
              content: context
                ? `${settings.systemPrompt}\n\n以下是本次回答可引用的文献正文：\n${context}`
                : settings.systemPrompt
            },
            ...req.messages
          ]
        })
      }
    )
    try {
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(
          detail.error?.message || `模型请求失败 (${response.status})`
        )
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('模型未返回流式响应')
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const raw = line.trim().replace(/^data:\s*/, '')
          if (!raw || raw === '[DONE]') continue
          try {
            const chunk = JSON.parse(raw) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const delta = chunk.choices?.[0]?.delta?.content ?? ''
            if (!delta) continue
            content += delta
            emit({ requestId: req.requestId, type: 'delta', delta })
          } catch {
            // Ignore provider keepalive frames.
          }
        }
      }
      this.recordUsage({
        kind: 'chat',
        model: settings.chatModel,
        prompt: `${context}\n${req.messages.map((item) => item.content).join('\n')}`,
        completion: content,
        chatId: req.chatId
      })
      emit({ requestId: req.requestId, type: 'done', content })
      return { ok: true }
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? '已取消生成'
          : (error as Error).message
      emit({ requestId: req.requestId, type: 'error', error: message })
      throw error
    } finally {
      this.chatControllers.delete(req.requestId)
    }
  }

  async sendAli(req: AliSendRequest): Promise<{ ok: boolean }> {
    this.assertAccountAccess()
    return sendWebAli(req, {
      settings: () => this.library.data.settings,
      getSession: (id) =>
        this.aliState().sessions.find((session) => session.id === id),
      appendMessage: (id, message) => {
        const sessions = this.aliState().sessions
        const session = sessions.find((item) => item.id === id)
        if (!session) return undefined
        session.messages.push(message)
        session.updatedAt = now()
        if (
          message.role === 'user' &&
          session.title === '新的对话' &&
          message.content.trim()
        ) {
          session.title = message.content.trim().slice(0, 36)
        }
        this.saveAliSessions(sessions)
        return session
      },
      updateSession: (id, patch) => {
        const sessions = this.aliState().sessions
        const session = sessions.find((item) => item.id === id)
        if (!session) return undefined
        Object.assign(session, patch, { updatedAt: now() })
        this.saveAliSessions(sessions)
        return session
      },
      memory: () => this.readAliMemory(),
      saveMemory: (state) => this.saveAliMemory(state),
      emit: (event) => {
        for (const listener of this.aliListeners) listener(event)
      },
      recordUsage: (input) => {
        this.recordUsage(input)
      },
      fetchUrl: async (url) => {
        const response = await this.request('/v1/web/fetch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url })
        })
        return this.responseJson<{
          url: string
          title: string
          text: string
        }>(response)
      },
      searchWeb: async (query, limit) => {
        const settings = this.library.data.settings.ali
        const response = await this.request('/v1/ali/search-web', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query,
            limit,
            provider: settings.webProvider,
            endpoint: settings.webEndpoint,
            apiKey: settings.webApiKey
          })
        })
        return this.responseJson<{
          sources: Array<{ title: string; url: string; snippet: string }>
          raw: string
        }>(response)
      },
      searchGithub: async (query, type, limit) => {
        const response = await this.request('/v1/ali/search-github', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query,
            type,
            limit,
            token: this.library.data.settings.ali.githubToken
          })
        })
        return this.responseJson<{
          sources: Array<{ title: string; url: string; snippet: string }>
          raw: string
        }>(response)
      }
    })
  }

  cancelChat(requestId: string): void {
    this.chatControllers.get(requestId)?.abort()
  }

  cancelAli(requestId: string): void {
    cancelWebAli(requestId)
    this.aliControllers.get(requestId)?.abort()
    this.aliControllers.delete(requestId)
  }

  async complete(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    const settings = this.library.data.settings
    if (!settings.apiBaseUrl || !settings.apiKey) {
      throw new Error('请先在设置中配置模型服务')
    }
    const response = await fetch(
      `${settings.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.chatModel,
          temperature: settings.temperature,
          messages
        })
      }
    )
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string }
      choices?: Array<{ message?: { content?: string } }>
    }
    if (!response.ok) {
      throw new Error(
        payload.error?.message || `模型请求失败 (${response.status})`
      )
    }
    return payload.choices?.[0]?.message?.content?.trim() ?? ''
  }

  async startTranslate(): Promise<{ ok: boolean; reason?: string }> {
    const emit = (event: TranslateEvent): void => {
      for (const listener of this.translateListeners) listener(event)
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const reason = '当前浏览器不支持截图，请使用 HTTPS 或 localhost'
      emit({ type: 'status', status: 'error', message: reason })
      return { ok: false, reason }
    }
    let stream: MediaStream | null = null
    try {
      emit({ type: 'status', status: 'selecting' })
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false
      })
      emit({ type: 'status', status: 'capturing' })
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      await video.play()
      await new Promise<void>((resolve) => {
        if (video.videoWidth) resolve()
        else video.onloadedmetadata = () => resolve()
      })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      const imageBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('截图编码失败'))),
          'image/png'
        )
      })
      stream.getTracks().forEach((track) => track.stop())
      stream = null
      const settings = this.library.data.settings
      if (!settings.apiKey || !settings.apiBaseUrl) {
        throw new Error('请先在设置中配置支持视觉输入的模型服务')
      }
      emit({ type: 'status', status: 'translating' })
      const dataUrl = canvas.toDataURL('image/png')
      const response = await fetch(
        `${settings.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${settings.apiKey}`
          },
          body: JSON.stringify({
            model: settings.visionModel || settings.chatModel,
            temperature: 0.1,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `请识别并翻译截图中的文字为${settings.language === 'en' ? 'English' : '简体中文'}。保留公式、段落和列表结构，只输出 Markdown。`
                  },
                  { type: 'image_url', image_url: { url: dataUrl } }
                ]
              }
            ]
          })
        }
      )
      if (!response.ok) throw new Error(`翻译请求失败 (${response.status})`)
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const structured =
        payload.choices?.[0]?.message?.content?.trim() || '（模型未返回翻译内容）'
      const id = uid()
      const imageFile = `${id}.png`
      await this.library.saveBoundBlob(
        this.library.translationPath(imageFile),
        imageBlob,
        'image/png'
      )
      const record: TranslationRecord = {
        id,
        createdAt: now(),
        imageFile,
        structured,
        plain: structured.replace(/[#*_`>~-]/g, '').replace(/\n{3,}/g, '\n\n').trim(),
        model: settings.visionModel || settings.chatModel
      }
      this.library.data.translations.unshift(record)
      this.library.persist()
      emit({
        type: 'result',
        result: { ...record, imageUrl: dataUrl }
      })
      return { ok: true }
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      const message = (error as Error).message
      emit({
        type: 'status',
        status:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'canceled'
            : 'error',
        message
      })
      return { ok: false, reason: message }
    }
  }

  readAliMemory(): AliMemoryState {
    this.assertAccountAccess()
    const fallback: AliMemoryState = {
      self: '',
      memory: '',
      topics: [],
      archive: '',
      usage: {
        self: { chars: 0, quota: 1_800 },
        memory: { chars: 0, quota: 3_000 }
      }
    }
    const saved = readJson<AliMemoryState>('arbor-web-ali-memory-v1', fallback)
    return {
      ...fallback,
      ...saved,
      usage: {
        self: {
          chars: saved.self?.length ?? 0,
          quota: saved.usage?.self?.quota ?? 1_800
        },
        memory: {
          chars: saved.memory?.length ?? 0,
          quota: saved.usage?.memory?.quota ?? 3_000
        }
      }
    }
  }

  saveAliMemory(value: AliMemoryState): AliMemoryState {
    this.assertAccountAccess()
    const next = {
      ...value,
      usage: {
        self: {
          chars: value.self.length,
          quota: value.usage?.self?.quota ?? 1_800
        },
        memory: {
          chars: value.memory.length,
          quota: value.usage?.memory?.quota ?? 3_000
        }
      }
    }
    writeJson('arbor-web-ali-memory-v1', next)
    this.scheduleSync()
    return next
  }
}

function genericFallback(path: string[]): unknown {
  return new Proxy(
    function fallback() {},
    {
      get(_target, property) {
        if (property === 'then') return undefined
        return genericFallback([...path, String(property)])
      },
      apply() {
        const name = path.at(-1) ?? ''
        if (name.startsWith('on')) return () => {}
        if (name === 'state' || name === 'get' || name === 'list') {
          return Promise.resolve(null)
        }
        return Promise.resolve(undefined)
      }
    }
  )
}

function withFallback<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, property) {
      const current = Reflect.get(target, property)
      if (current !== undefined) {
        if (
          current &&
          typeof current === 'object' &&
          !Array.isArray(current) &&
          Object.getPrototypeOf(current) === Object.prototype
        ) {
          return withFallback(current)
        }
        return current
      }
      return genericFallback([String(property)])
    }
  })
}

export function installBrowserApi(): void {
  document.documentElement.dataset.arborWeb = 'true'
  const runtime = new BrowserRuntime()
  const emitLibrary = (): void => runtime.settingsChanged()
  const updateDocument = (id: string, patch: Partial<DocumentMeta>): DocumentMeta | undefined => {
    const doc = runtime.library.data.documents.find((item) => item.id === id)
    if (!doc) return undefined
    Object.assign(doc, patch, { updatedAt: now() })
    runtime.library.persist()
    return doc
  }
  const saveAttachmentBlob = async (
    ownerId: string,
    name: string,
    blob: Blob,
    kind: 'image' | 'file'
  ): Promise<InboxAttachment> => {
    const safeName = safePathSegment(name)
    await runtime.library.saveBoundBlob(
      runtime.library.attachmentPath(ownerId, safeName),
      blob,
      blob.type || 'application/octet-stream'
    )
    return {
      id: uid(),
      name,
      file: safeName,
      kind,
      size: blob.size,
      createdAt: now()
    }
  }
  const pickAttachmentBlobs = async (
    ownerId: string,
    kind: 'image' | 'file'
  ): Promise<InboxAttachment[]> => {
    const files = await runtime.library.pickFiles(kind === 'image' ? 'image/*' : '*/*')
    const result: InboxAttachment[] = []
    for (const file of files) {
      const detectedKind = file.type.startsWith('image/') ? 'image' : 'file'
      result.push(
        await saveAttachmentBlob(
          ownerId,
          file.name,
          file,
          kind === 'image' ? 'image' : detectedKind
        )
      )
    }
    return result
  }
  const markdownToDocx = async (title: string, markdown: string): Promise<Blob> => {
    const {
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      TextRun
    } = await import('docx')
    const paragraphs = markdown.split(/\n/).map((line) => {
      const heading = line.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        return new Paragraph({
          text: heading[2],
          heading:
            [
              HeadingLevel.HEADING_1,
              HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,
              HeadingLevel.HEADING_4,
              HeadingLevel.HEADING_5,
              HeadingLevel.HEADING_6
            ][Math.min(5, heading[1].length - 1)]
        })
      }
      return new Paragraph({
        children: [new TextRun(line.replace(/^[-*]\s+/, '• '))]
      })
    })
    return Packer.toBlob(
      new Document({
        sections: [{ properties: {}, children: paragraphs }],
        title
      })
    )
  }
  const exportAttachmentZip = async (
    name: string,
    ownerId: string,
    attachments: InboxAttachment[] | undefined,
    markdown: string
  ): Promise<ExportResult> => {
    const entries: { name: string; data: Blob | string }[] = [
      { name: '内容.md', data: markdown }
    ]
    for (const attachment of attachments ?? []) {
      const blob = await runtime.library.blobForPath(
        runtime.library.attachmentPath(ownerId, attachment.file)
      )
      if (blob) entries.push({ name: `attachments/${attachment.file}`, data: blob })
    }
    return download(
      await createZip(entries),
      `${safePathSegment(name)}.zip`,
      'application/zip'
    )
  }
  const onPanel = <T,>(
    type: string,
    callback: (payload: T) => void
  ): (() => void) =>
    runtime.onPanelMessage((message) => {
      if (message.type === type) callback(message as T)
    })
  const api = {
    library: {
      getState: async () => runtime.library.data,
      pickDocuments: async () => {
        const files = await runtime.library.pickFiles(
          '.pdf,.docx,.doc,.txt,.md,.markdown'
        )
        return files.map((file) => ({
          filePath: runtime.library.registerCandidate(file),
          title: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          format: formatFromFileName(file.name)
        }))
      },
      importDocument: async (
        filePath: string,
        title: string,
        collectionId?: string
      ) => runtime.library.importFile(filePath, title, collectionId),
      importUrl: async (url: string, requestId?: string, collectionId?: string) => {
        const controller = new AbortController()
        if (requestId) runtime['importControllers'].set(requestId, controller)
        const fetched = await runtime
          .request('/v1/web/fetch', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url })
          })
          .then((response) =>
            runtime.responseJson<{
              url: string
              title: string
              text: string
            }>(response)
          )
          .finally(() => {
            if (requestId) runtime['importControllers'].delete(requestId)
          })
        const timestamp = now()
        const id = uid()
        const doc: DocumentMeta = {
          id,
          title: fetched.title || new URL(fetched.url).hostname,
          authors: '',
          year: '',
          journal: new URL(fetched.url).hostname,
          abstract: fetched.text.slice(0, 500),
          doi: '',
          url: fetched.url,
          tags: [],
          collections: collectionId ? [collectionId] : [],
          addedAt: timestamp,
          updatedAt: timestamp,
          fileName: 'page.html',
          sourceFormat: 'web',
          webArchivedAt: timestamp,
          webCapturedAt: timestamp,
          pageCount: 1,
          starred: false,
          readingStatus: 'unread',
          lastPage: 1,
          notes: ''
        }
        await runtime.library.saveTexts(id, [fetched.text])
        await runtime.library.saveBoundBlob(
          `files/${id}/page.html`,
          new Blob([webArchiveHtml(doc.title, fetched.url, fetched.text)], {
            type: 'text/html; charset=utf-8'
          }),
          'text/html; charset=utf-8'
        )
        runtime.library.data.documents.unshift(doc)
        runtime.library.persist()
        return doc
      },
      cancelImport: async (requestId: string) => {
        const controller = runtime['importControllers'].get(requestId)
        controller?.abort()
        runtime['importControllers'].delete(requestId)
        return { canceled: Boolean(controller) }
      },
      update: async (id: string, patch: Partial<DocumentMeta>) =>
        updateDocument(id, patch),
      remove: async (id: string) => {
        const doc = runtime.library.data.documents.find((item) => item.id === id)
        const binding = doc ? runtime.library.bindingForDocument(doc) : undefined
        if (binding) runtime.library.removeBindingsForPath(binding.path)
        runtime.library.data.documents = runtime.library.data.documents.filter(
          (item) => item.id !== id
        )
        runtime.library.data.highlights = runtime.library.data.highlights.filter(
          (item) => item.docId !== id
        )
        runtime.library.removeBindingsForPath(runtime.library.textPath(id))
        runtime.library.removeBindingsForPath(runtime.library.annotationPath(id))
        runtime.library.persist()
      },
      batchUpdate: async (ids: string[], patch: Record<string, unknown>) => {
        for (const id of ids) updateDocument(id, patch as Partial<DocumentMeta>)
        return ids.length
      },
      batchRemove: async (ids: string[]) => {
        for (const id of ids) await api.library.remove(id)
        return ids.length
      },
      getTexts: async (id: string) => runtime.library.loadTexts(id),
      setText: async (
        id: string,
        pages: string[],
        meta?: { title?: string; authors?: string }
      ) => {
        await runtime.library.saveTexts(id, pages)
        updateDocument(id, {
          pageCount: pages.length,
          ...(meta?.title ? { title: meta.title } : {}),
          ...(meta?.authors ? { authors: meta.authors } : {})
        })
      },
      extractText: async (id: string) => {
        const doc = runtime.library.data.documents.find((item) => item.id === id)
        if (!doc) throw new Error('文献不存在')
        const { extractPdf } = await import('@renderer/pdf')
        const format = (doc.sourceFormat || formatFromFileName(doc.fileName)) ?? ''
        if (format === 'pdf') {
          return extractPdf(await runtime.library.documentUrl(id))
        }
        const blob = await runtime.library.blobForPath(
          runtime.library.bindingForDocument(doc)?.path ?? ''
        )
        if (!blob) throw new Error('文献文件尚未载入')
        if (format === 'docx') {
          const mammoth = await import('mammoth')
          const result = await mammoth.extractRawText({
            arrayBuffer: await blob.arrayBuffer()
          })
          return {
            pageCount: 1,
            pages: [result.value.trim()]
          }
        }
        if (format === 'doc') {
          throw new Error('浏览器无法直接解析旧版 .doc，请另存为 .docx 或 PDF 后导入')
        }
        const text = await blob.text()
        return {
          pageCount: 1,
          pages: [text]
        }
      },
      pdfUrl: (id: string) => runtime.library.documentUrl(id)
    },
    imports: {
      bibtex: async (): Promise<ImportResult> => {
        const file = await runtime.library.pickOne('.bib')
        if (!file) return { canceled: true }
        const raw = await file.text()
        let imported = 0
        let updated = 0
        let skipped = 0
        const chunks = raw.split(/(?=@\w+\s*\{)/g)
        for (const chunk of chunks) {
          const fields: Record<string, string> = {}
          for (const match of chunk.matchAll(
            /(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)")/g
          )) {
            fields[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '')
              .replace(/\s+/g, ' ')
              .trim()
          }
          const title = fields.title
          if (!title) {
            skipped++
            continue
          }
          const existing = runtime.library.data.documents.find(
            (doc) =>
              (fields.doi && doc.doi.toLowerCase() === fields.doi.toLowerCase()) ||
              doc.title.toLowerCase() === title.toLowerCase()
          )
          if (existing) {
            Object.assign(existing, {
              authors: fields.author || existing.authors,
              year: fields.year || existing.year,
              journal:
                fields.journal || fields.booktitle || existing.journal,
              doi: fields.doi || existing.doi,
              url: fields.url || existing.url,
              abstract: fields.abstract || existing.abstract,
              updatedAt: now()
            })
            updated++
            continue
          }
          const timestamp = now()
          runtime.library.data.documents.unshift({
            id: uid(),
            title,
            authors: fields.author ?? '',
            year: fields.year ?? '',
            journal: fields.journal ?? fields.booktitle ?? '',
            abstract: fields.abstract ?? '',
            doi: fields.doi ?? '',
            url: fields.url ?? '',
            tags: [],
            collections: [],
            addedAt: timestamp,
            updatedAt: timestamp,
            fileName: '',
            sourceFormat: 'txt',
            pageCount: 0,
            starred: false,
            readingStatus: 'unread',
            lastPage: 1,
            notes: ''
          })
          imported++
        }
        runtime.library.persist()
        return {
          canceled: false,
          summary: {
            kind: 'bibtex',
            documentsAdded: imported,
            documentsMerged: updated,
            excerptsAdded: 0,
            skipped
          }
        }
      },
      readwise: async (): Promise<ImportResult> => {
        const files = await runtime.library.pickFiles('.json')
        if (!files.length) return { canceled: true }
        let imported = 0
        let skipped = 0
        for (const file of files) {
          let payload: unknown
          try {
            payload = JSON.parse(await file.text())
          } catch {
            skipped++
            continue
          }
          const rows = Array.isArray(payload)
            ? payload
            : (payload as { books?: unknown[] }).books ?? []
          for (const raw of rows as Array<Record<string, unknown>>) {
            const book = (raw.book ?? raw) as Record<string, unknown>
            const title = String(book.title ?? raw.title ?? '')
            const highlights = Array.isArray(book.highlights)
              ? book.highlights
              : Array.isArray(raw.highlights)
                ? raw.highlights
                : [raw]
            const doc = runtime.library.data.documents.find(
              (item) => item.title.toLowerCase() === title.toLowerCase()
            )
            for (const highlightRaw of highlights as Array<
              Record<string, unknown>
            >) {
              const text = String(highlightRaw.text ?? highlightRaw.content ?? '')
              if (!text) {
                skipped++
                continue
              }
              runtime.library.data.highlights.push({
                id: uid(),
                docId: doc?.id ?? '',
                page: Number(highlightRaw.location ?? 1) || 1,
                color: 'yellow',
                text,
                note: String(highlightRaw.note ?? ''),
                rects: [],
                createdAt: now(),
                updatedAt: now()
              })
              imported++
            }
          }
        }
        runtime.library.persist()
        return {
          canceled: false,
          summary: {
            kind: 'readwise',
            documentsAdded: 0,
            documentsMerged: 0,
            excerptsAdded: imported,
            skipped
          }
        }
      }
    },
    events: {
      onLibraryChanged: (callback: () => void) => runtime.library.onChanged(callback),
      onSettingsChanged: (callback: Listener<AppSettings>) =>
        runtime.onSettings(callback),
      onAccountChanged: (callback: Listener<AccountState>) =>
        runtime.onAccount(callback),
      onSessionReplaced: (callback: Listener<AccountState>) =>
        runtime.onReplaced(callback),
      onSyncStatus: (callback: Listener<SyncStatus>) =>
        runtime.onSync(callback),
      onChat: (callback: Listener<ChatEvent>) => runtime.onChat(callback),
      onAli: (callback: Listener<AliEvent>) => {
        runtime['aliListeners'].add(callback)
        return () => runtime['aliListeners'].delete(callback)
      },
      onTranslate: (callback: Listener<TranslateEvent>) => runtime.onTranslate(callback),
      onUsageRecorded: (
        callback: Listener<{
          record?: UsageRecord
          cleared?: boolean
          active: ActiveUsage[]
        }>
      ) => runtime.onUsage(callback),
      onUsageLive: (callback: Listener<ActiveUsage[]>) =>
        runtime.onUsageLive(callback),
      onReaderPanelClosed: (callback: (payload: {
        docId: string
        tab: ReaderPanelTab
        activeChatId: string | null
      }) => void) => onPanel('closed', callback),
      onReaderPanelQuote: (callback: (payload: ReaderPanelQuote) => void) =>
        onPanel('quote', callback),
      onReaderPanelPage: (callback: (payload: {
        docId: string
        page: number
      }) => void) => onPanel('page', callback),
      onReaderPanelOutline: (
        callback: (
          payload: ReaderPanelOutlineState & { docId: string }
        ) => void
      ) => onPanel('outline', callback),
      onReaderPanelDataChanged: (callback: () => void) =>
        onPanel('data-changed', () => callback()),
      onReaderPanelRefresh: (callback: () => void) =>
        onPanel('refresh', () => callback()),
      onReaderPanelOpenDoc: (
        callback: (payload: { docId: string; page?: number }) => void
      ) => onPanel('open-doc', callback),
      onReaderPanelReady: (
        callback: (payload: { docId: string }) => void
      ) => onPanel('ready', callback),
      onReaderPanelBlockClose: (callback: () => void) =>
        onPanel('block-close', () => callback()),
      onReaderPanelPinned: (callback: (pinned: boolean) => void) =>
        onPanel('pinned', (payload: { pinned: boolean }) =>
          callback(payload.pinned)
        ),
      onAliSessionsChanged: (callback: () => void) => {
        runtime['aliChangedListeners'].add(callback)
        return () => runtime['aliChangedListeners'].delete(callback)
      }
    },
    web: {
      mount: async (
        docId: string,
        _bounds: WebBounds,
        source: WebPageSource = 'offline'
      ) => {
        const doc = runtime.library.data.documents.find((item) => item.id === docId)
        if (!doc) throw new Error('文献不存在')
        runtime['activeWeb'] = {
          docId,
          url: doc.url,
          title: doc.title,
          source: doc.webArchivedAt ? source : 'online',
          loading: false,
          error: ''
        }
        return {
          url: doc.url,
          title: doc.title,
          loading: false,
          canGoBack: false,
          canGoForward: false,
          source: doc.webArchivedAt ? source : ('online' as const),
          hasArchive: Boolean(doc.webArchivedAt),
          readable: true,
          visible: true
        } satisfies WebPageState
      },
      unmount: async () => undefined,
      bounds: async () => undefined,
      navigate: async (url: string) => {
        const active = runtime['activeWeb']
        if (!active.docId) throw new Error('没有正在阅读的网页')
        active.loading = true
        active.error = ''
        try {
          const fetched = await runtime.responseJson<{
            url: string
            title: string
            text: string
          }>(
            await runtime.request('/v1/web/fetch', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ url })
            })
          )
          const doc = runtime.library.data.documents.find(
            (item) => item.id === active.docId
          )
          if (!doc) throw new Error('文献不存在')
          const timestamp = now()
          Object.assign(doc, {
            title: fetched.title || new URL(fetched.url).hostname,
            url: fetched.url,
            fileName: 'page.html',
            sourceFormat: 'web',
            webArchivedAt: timestamp,
            webCapturedAt: timestamp,
            updatedAt: timestamp,
            pageCount: 1
          })
          await runtime.library.saveTexts(doc.id, [fetched.text])
          await runtime.library.saveBoundBlob(
            `files/${doc.id}/page.html`,
            new Blob([webArchiveHtml(doc.title, fetched.url, fetched.text)], {
              type: 'text/html; charset=utf-8'
            }),
            'text/html; charset=utf-8'
          )
          runtime.library.persist()
          active.url = fetched.url
          active.title = doc.title
        } catch (error) {
          active.error = (error as Error).message
          throw error
        } finally {
          active.loading = false
        }
      },
      action: async (action: WebPageAction) => {
        if (action === 'reload') {
          await api.web.navigate(runtime['activeWeb'].url)
        }
      },
      state: async () => {
        const active = runtime['activeWeb']
        return {
          url: active.url,
          title: active.title,
          loading: active.loading,
          canGoBack: false,
          canGoForward: false,
          error: active.error || undefined,
          source: active.source,
          hasArchive: Boolean(
            runtime.library.data.documents.find(
              (doc) => doc.id === active.docId
            )?.webArchivedAt
          ),
          readable: true,
          visible: true
        } satisfies WebPageState
      },
      source: async (source: WebPageSource) => {
        runtime['activeWeb'].source = source
        return api.web.state()
      },
      capture: async () => {
        const active = runtime['activeWeb']
        const doc = runtime.library.data.documents.find(
          (item) => item.id === active.docId
        )
        if (!doc) throw new Error('网页记录不存在')
        doc.webCapturedAt = now()
        doc.webArchivedAt = doc.webArchivedAt ?? doc.webCapturedAt
        doc.updatedAt = now()
        runtime.library.persist()
        return doc
      },
      selection: async () => {
        const text = (window as unknown as { __arborWebSelection?: string })
          .__arborWebSelection ?? ''
        const active = runtime['activeWeb']
        return { text, url: active.url, title: active.title }
      },
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    },
    account: {
      state: async () => runtime.accountState(),
      signInDev: async (input: {
        email: string
        displayName?: string
        serverUrl: string
        intent?: 'cloud-first' | 'merge-local'
      }) =>
        runtime.signIn(
          input.email,
          input.displayName,
          input.serverUrl,
          input.intent
        ),
      signInOidc: async (
        serverUrl: string,
        intent: 'cloud-first' | 'merge-local' = 'cloud-first'
      ) => runtime.signInOidc(serverUrl, intent),
      logout: async () => runtime.logout(),
      devices: async () => {
        const response = await runtime['request']('/v1/devices')
        return (await runtime['responseJson'](response) as { devices: AccountDevice[] }).devices
      },
      revokeDevice: async (id: string) => {
        await runtime['responseJson'](
          await runtime['request'](`/v1/devices/${encodeURIComponent(id)}`, {
            method: 'DELETE'
          })
        )
        return api.account.devices()
      },
      deviceRequests: async (): Promise<DeviceEnrollment[]> => {
        const response = await runtime['request']('/v1/device-requests')
        return (await runtime['responseJson'](response) as { requests: DeviceEnrollment[] }).requests
      },
      approveDeviceRequest: async (id: string) => {
        await runtime['responseJson'](
          await runtime['request'](`/v1/device-requests/${id}/approve`, {
            method: 'POST',
            body: '{}'
          })
        )
        return api.account.deviceRequests()
      },
      rejectDeviceRequest: async (id: string) => {
        await runtime['responseJson'](
          await runtime['request'](`/v1/device-requests/${id}/reject`, {
            method: 'POST',
            body: '{}'
          })
        )
        return api.account.deviceRequests()
      },
      transferPrimary: async (id: string) => {
        await runtime['responseJson'](
          await runtime['request'](`/v1/devices/${id}/primary`, {
            method: 'POST',
            body: '{}'
          })
        )
        return api.account.devices()
      }
    },
    sync: {
      status: async () => runtime.syncStatus(),
      conflicts: async () => [],
      snapshots: async () => runtime.snapshots(),
      snapshotChanges: async (id: string) => runtime.snapshotChanges(id),
      restoreSnapshot: async (id: string) => runtime.restoreSnapshot(id),
      now: async () => runtime.syncNow(),
      resolveConflict: async () => runtime.syncStatus(),
      applyInitialMerge: async () => runtime.syncStatus()
    },
    collections: {
      add: async (name: string, parentId?: string, color?: string) => {
        const item: Collection = { id: uid(), name, parentId, color, createdAt: now() }
        runtime.library.data.collections.push(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<Collection>) => {
        const item = runtime.library.data.collections.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch)
        runtime.library.persist()
        return item
      },
      rename: async (id: string, name: string) => {
        await api.collections.update(id, { name })
      },
      remove: async (id: string) => {
        runtime.library.data.collections = runtime.library.data.collections.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      }
    },
    tags: {
      add: async (input: { name: string; parentId?: string; color?: string }) => {
        const item: Tag = { id: uid(), ...input }
        runtime.library.data.tags.push(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<Tag>) => {
        const item = runtime.library.data.tags.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch)
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.tags = runtime.library.data.tags.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      }
    },
    properties: {
      add: async (input: { name: string; type: Property['type']; options?: Property['options'] }) => {
        const item: Property = { id: uid(), ...input }
        runtime.library.data.properties.push(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<Property>) => {
        const item = runtime.library.data.properties.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch)
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.properties = runtime.library.data.properties.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      }
    },
    views: {
      add: async (name: string, config: SavedView['config']) => {
        const item: SavedView = { id: uid(), name, config, createdAt: now(), updatedAt: now() }
        runtime.library.data.savedViews.push(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<SavedView>) => {
        const item = runtime.library.data.savedViews.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch, { updatedAt: now() })
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.savedViews = runtime.library.data.savedViews.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      }
    },
    chats: {
      create: async (docIds: string[]) => {
        const item: ChatSession = {
          id: uid(),
          title: '新的对话',
          docIds,
          messages: [],
          createdAt: now(),
          updatedAt: now()
        }
        runtime.library.data.chats.unshift(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<ChatSession>) => {
        const item = runtime.library.data.chats.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch, { updatedAt: now() })
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.chats = runtime.library.data.chats.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      },
      batchRemove: async (ids: string[]) => {
        for (const id of ids) await api.chats.remove(id)
        return ids.length
      },
      pickAttachments: async (chatId: string, kind: 'image' | 'file') =>
        pickAttachmentBlobs(chatId, kind),
      saveAttachment: async (
        chatId: string,
        name: string,
        data: Uint8Array,
        kind: 'image' | 'file' = 'file'
      ) =>
        saveAttachmentBlob(
          chatId,
          name,
          new Blob([data as unknown as BlobPart], {
            type: name.match(/\.(png|jpe?g|gif|webp|svg)$/i)
              ? `image/${name.split('.').at(-1)?.replace('jpg', 'jpeg')}`
              : 'application/octet-stream'
          }),
          kind
        ),
      removeAttachment: async (chatId: string, file: string) => {
        runtime.library.removeBindingsForPath(
          runtime.library.attachmentPath(chatId, file)
        )
      },
    },
    attachments: {
      open: async (ownerId: string, file: string) => {
        try {
          const url = await runtime.library.urlForPath(
            runtime.library.attachmentPath(ownerId, file)
          )
          window.open(url, '_blank', 'noopener,noreferrer')
          return { ok: true }
        } catch (error) {
          return { ok: false, error: (error as Error).message }
        }
      },
      saveAs: async (ownerId: string, file: string, name: string) => {
        const blob = await runtime.library.blobForPath(
          runtime.library.attachmentPath(ownerId, file)
        )
        if (!blob) throw new Error('附件不存在')
        return download(blob, name, blob.type || 'application/octet-stream')
      }
    },
    topics: {
      list: async () => runtime.library.data.researchTopics,
      add: async (input: { name: string; docIds: string[] }) => {
        const item: ResearchTopic = {
          id: uid(),
          name: input.name,
          docIds: input.docIds,
          questions: [],
          createdAt: now(),
          updatedAt: now()
        }
        runtime.library.data.researchTopics.unshift(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<ResearchTopic>) => {
        const item = runtime.library.data.researchTopics.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch, { updatedAt: now() })
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.researchTopics = runtime.library.data.researchTopics.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      },
      suggest: async (id: string) => {
        const topic = runtime.library.data.researchTopics.find(
          (item) => item.id === id
        )
        if (!topic) return []
        const docs = runtime.library.data.documents.filter((doc) =>
          topic.docIds.includes(doc.id)
        )
        const content =
          docs.length > 0
            ? await runtime
                .complete([
                  {
                    role: 'system',
                    content:
                      '你是研究助理。只输出 JSON 字符串数组，包含 4 个具体、可研究的建议问题。'
                  },
                  {
                    role: 'user',
                    content: `主题：${topic.name}\n文献：\n${docs
                      .map(
                        (doc) =>
                          `- ${doc.title}\n作者：${doc.authors}\n摘要：${doc.abstract}`
                      )
                      .join('\n')}`
                  }
                ])
                .catch(() => '')
            : ''
        let questions: string[] = []
        try {
          const parsed = JSON.parse(
            content.replace(/^```json\s*|\s*```$/g, '')
          ) as unknown
          if (Array.isArray(parsed)) {
            questions = parsed.filter(
              (item): item is string => typeof item === 'string'
            )
          }
        } catch {
          questions = []
        }
        if (!questions.length) {
          questions = [
            `${topic.name} 的核心争议是什么？`,
            `这些文献使用了哪些关键方法，证据强度如何？`,
            `现有研究还有哪些明显空白？`,
            `如何设计一个可验证的后续实验或分析？`
          ]
        }
        topic.questions = [...new Set([...topic.questions, ...questions])]
        topic.updatedAt = now()
        runtime.library.persist()
        return topic.questions
      }
    },
    readingPlan: {
      generate: async (goal: string): Promise<ReadingPlan> => {
        const docs = runtime.library.data.documents.slice(0, 30)
        const fallback: ReadingPlan = {
          id: uid(),
          goal,
          createdAt: now(),
          model: runtime.library.data.settings.chatModel,
          items: docs.map((doc, index) => ({
            docId: doc.id,
            order: index + 1,
            focus: `围绕“${goal}”阅读 ${doc.title}`,
            questions: [
              '作者要解决的核心问题是什么？',
              '方法与证据是否支持结论？',
              '这项工作与目标主题的具体关系是什么？'
            ]
          }))
        }
        if (!docs.length) return fallback
        const content = await runtime
          .complete([
            {
              role: 'system',
              content:
                '你是科研阅读规划助手。根据目标和文献元数据安排阅读顺序。只输出 JSON 数组，每项包含 docId、focus、questions（字符串数组）。'
            },
            {
              role: 'user',
              content: `目标：${goal}\n\n文献：\n${docs
                .map(
                  (doc) =>
                    `docId=${doc.id}\n标题=${doc.title}\n年份=${doc.year}\n摘要=${doc.abstract}`
                )
                .join('\n\n')}`
            }
          ])
          .catch(() => '')
        try {
          const parsed = JSON.parse(
            content.replace(/^```json\s*|\s*```$/g, '')
          ) as Array<{
            docId?: string
            focus?: string
            questions?: string[]
          }>
          const valid = parsed
            .filter(
              (item) =>
                item.docId && docs.some((doc) => doc.id === item.docId)
            )
            .map((item, index) => ({
              docId: item.docId!,
              order: index + 1,
              focus: item.focus || goal,
              questions: Array.isArray(item.questions)
                ? item.questions.filter(
                    (question): question is string =>
                      typeof question === 'string'
                  )
                : []
            }))
          if (valid.length) fallback.items = valid
        } catch {
          // Keep the deterministic plan when the model is not configured.
        }
        return fallback
      },
      list: async (): Promise<ReadingPlan[]> => {
        return [...runtime.library.data.readingPlans].sort(
          (a, b) => b.createdAt - a.createdAt
        )
      },
      save: async (plan: ReadingPlan): Promise<ReadingPlan> => {
        const plans = runtime.library.data.readingPlans
        const index = plans.findIndex((item) => item.id === plan.id)
        if (index >= 0) plans[index] = plan
        else plans.unshift(plan)
        runtime.library.persist()
        return plan
      },
      remove: async (id: string): Promise<void> => {
        runtime.library.data.readingPlans =
          runtime.library.data.readingPlans.filter((plan) => plan.id !== id)
        runtime.library.persist()
      }
    },
    highlights: {
      list: async (docId: string) =>
        runtime.library.data.highlights.filter((item) => item.docId === docId),
      add: async (input: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt' | 'note'> & { note?: string }) => {
        const item: Highlight = {
          ...input,
          note: input.note ?? '',
          id: uid(),
          createdAt: now(),
          updatedAt: now()
        }
        runtime.library.data.highlights.push(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<Highlight>) => {
        const item = runtime.library.data.highlights.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch, { updatedAt: now() })
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.highlights = runtime.library.data.highlights.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      }
    },
    annotations: {
      load: async (docId: string) => runtime.library.loadAnnotations(docId),
      save: async (docId: string, data: DocumentAnnotations) =>
        runtime.library.saveAnnotations(docId, data),
      remove: async (docId: string) => {
        runtime.library.removeBindingsForPath(runtime.library.annotationPath(docId))
        await deleteJson(`arbor-web-annotations:${docId}`)
      }
    },
    excerpts: {
      list: async () => runtime.library.data.excerpts,
      add: async (input: {
        docId?: string | null
        page?: number
        source?: string
        question?: string
        answer?: string
      }) => {
        const doc = runtime.library.data.documents.find((item) => item.id === input.docId)
        const item: Excerpt = {
          id: uid(),
          docId: input.docId ?? null,
          docTitle: doc?.title ?? '',
          page: input.page,
          source: input.source ?? '',
          question: input.question ?? '',
          answer: input.answer ?? '',
          attachments: [],
          createdAt: now(),
          updatedAt: now()
        }
        runtime.library.data.excerpts.unshift(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<Excerpt>) => {
        const item = runtime.library.data.excerpts.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch, { updatedAt: now() })
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.excerpts = runtime.library.data.excerpts.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      },
      pickAttachments: async (excerptId: string, kind: 'image' | 'file') =>
        pickAttachmentBlobs(excerptId, kind),
      removeAttachment: async (excerptId: string, attachmentId: string) => {
        const excerpt = runtime.library.data.excerpts.find(
          (item) => item.id === excerptId
        )
        const attachment = excerpt?.attachments?.find(
          (item) => item.id === attachmentId
        )
        if (attachment) {
          runtime.library.removeBindingsForPath(
            runtime.library.attachmentPath(excerptId, attachment.file)
          )
        }
      },
      exportZip: async (excerptId: string) => {
        const excerpt = runtime.library.data.excerpts.find(
          (item) => item.id === excerptId
        )
        if (!excerpt) throw new Error('摘录不存在')
        return exportAttachmentZip(
          excerpt.docTitle || excerpt.question || '摘录',
          excerptId,
          excerpt.attachments,
          [excerpt.source, excerpt.question, excerpt.answer]
            .filter(Boolean)
            .join('\n\n')
        )
      }
    },
    inbox: {
      list: async () => runtime.library.data.inbox,
      add: async (input: {
        kind: string
        content: string
        title?: string
        url?: string
        docId?: string
        page?: number
        due?: string
      }) => {
        const item: InboxItem = {
          id: uid(),
          kind: input.kind as InboxItem['kind'],
          content: input.content,
          title: input.title ?? '',
          url: input.url ?? '',
          docId: input.docId,
          page: input.page,
          tags: [],
          attachments: [],
          archived: false,
          createdAt: now(),
          updatedAt: now()
        }
        runtime.library.data.inbox.unshift(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<InboxItem>) => {
        const item = runtime.library.data.inbox.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch, { updatedAt: now() })
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.inbox = runtime.library.data.inbox.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      },
      suggest: async () => {
        return runtime.library.data.inbox
          .filter((item) => !item.archived)
          .map((item) => {
            if (item.kind === 'todo') {
              return {
                inboxId: item.id,
                type: 'task' as const,
                value: item.title || item.content.slice(0, 80),
                reason: '适合加入任务清单'
              }
            }
            return {
              inboxId: item.id,
              type: 'excerpt' as const,
              value: item.content,
              reason: '保存为可检索摘录'
            }
          })
      },
      apply: async (inboxId: string, suggestion: {
        type: 'tag' | 'collection' | 'excerpt' | 'task'
        value: string
      }) => {
        const item = runtime.library.data.inbox.find(
          (entry) => entry.id === inboxId
        )
        if (!item) throw new Error('灵感记录不存在')
        if (suggestion.type === 'task') {
          await api.tasks.add({
            title: suggestion.value,
            inboxId,
            docId: item.docId
          })
        } else if (suggestion.type === 'excerpt') {
          await api.excerpts.add({
            docId: item.docId ?? null,
            page: item.page,
            source: item.title || item.url,
            answer: suggestion.value
          })
        } else if (suggestion.type === 'tag') {
          const name = suggestion.value.trim()
          if (name && !runtime.library.data.tags.some((tag) => tag.name === name)) {
            await api.tags.add({ name })
          }
          item.tags = [...new Set([...(item.tags ?? []), name])].filter(Boolean)
          item.updatedAt = now()
          runtime.library.persist()
        } else {
          const name = suggestion.value.trim()
          if (name && !runtime.library.data.collections.some((c) => c.name === name)) {
            await api.collections.add(name)
          }
          if (item.docId) {
            const doc = runtime.library.data.documents.find(
              (entry) => entry.id === item.docId
            )
            const collection = runtime.library.data.collections.find(
              (entry) => entry.name === name
            )
            if (doc && collection && !doc.collections.includes(collection.id)) {
              doc.collections.push(collection.id)
              doc.updatedAt = now()
            }
          }
          runtime.library.persist()
        }
        item.archived = true
        item.updatedAt = now()
        runtime.library.persist()
        return { ok: true }
      },
      pickAttachments: async (inboxId: string, kind: 'image' | 'file') =>
        pickAttachmentBlobs(inboxId, kind),
      removeAttachment: async (inboxId: string, attachmentId: string) => {
        const inbox = runtime.library.data.inbox.find((item) => item.id === inboxId)
        const attachment = inbox?.attachments?.find(
          (item) => item.id === attachmentId
        )
        if (attachment) {
          runtime.library.removeBindingsForPath(
            runtime.library.attachmentPath(inboxId, attachment.file)
          )
        }
      },
      exportZip: async (inboxId: string) => {
        const item = runtime.library.data.inbox.find(
          (entry) => entry.id === inboxId
        )
        if (!item) throw new Error('灵感记录不存在')
        return exportAttachmentZip(
          item.title || '灵感收集',
          inboxId,
          item.attachments,
          [item.title, item.content, item.url].filter(Boolean).join('\n\n')
        )
      }
    },
    tasks: {
      list: async () => runtime.library.data.tasks,
      add: async (input: { title: string; due?: string; docId?: string; excerptId?: string; inboxId?: string }) => {
        const item: TaskItem = {
          id: uid(),
          title: input.title,
          due: input.due,
          done: false,
          docId: input.docId,
          excerptId: input.excerptId,
          inboxId: input.inboxId,
          createdAt: now(),
          updatedAt: now()
        }
        runtime.library.data.tasks.unshift(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<TaskItem>) => {
        const item = runtime.library.data.tasks.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch, { updatedAt: now() })
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.tasks = runtime.library.data.tasks.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      }
    },
    canvases: {
      add: async (name: string) => {
        const item: CanvasBoard = {
          id: uid(),
          name,
          nodes: [],
          edges: [],
          createdAt: now(),
          updatedAt: now()
        }
        runtime.library.data.canvases.unshift(item)
        runtime.library.persist()
        return item
      },
      update: async (id: string, patch: Partial<CanvasBoard>) => {
        const item = runtime.library.data.canvases.find((entry) => entry.id === id)
        if (item) Object.assign(item, patch, { updatedAt: now() })
        runtime.library.persist()
        return item
      },
      remove: async (id: string) => {
        runtime.library.data.canvases = runtime.library.data.canvases.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      }
    },
    actions: {
      run: async (input: {
        action: 'translate' | 'summarize' | 'explain-formula' | 'compare'
        text: string
        page?: number
        docId?: string
        targetDocId?: string
      }) => {
        const doc = runtime.library.data.documents.find(
          (item) => item.id === input.docId
        )
        const target = runtime.library.data.documents.find(
          (item) => item.id === input.targetDocId
        )
        const targetContext = target
          ? (await runtime.library.loadTexts(target.id)).join('\n').slice(0, 40_000)
          : ''
        const prompt = buildAiActionPrompt(input.action, {
          selection: input.text,
          docTitle: doc?.title,
          page: input.page,
          target: target
            ? { title: target.title, context: targetContext }
            : undefined
        })
        const content = await runtime.complete([{ role: 'user', content: prompt }])
        return {
          action: input.action,
          content,
          model: runtime.library.data.settings.chatModel
        }
      }
    },
    agent: {
      send: async (request: {
        requestId: string
        chatId: string
        docIds: string[]
        messages: Array<{ role: 'user' | 'assistant'; content: string }>
        context?: unknown
      }) => runtime.sendChat(request),
      cancel: async (requestId: string) => runtime.cancelChat(requestId),
      compose: async (_chatId: string, title: string, instruction: string) => {
        return `# ${title}\n\n${instruction}\n`
      }
    },
    ali: {
      getState: async () => runtime.aliState(),
      createSession: async () => {
        const timestamp = now()
        const session: AliSession = {
          id: uid(),
          title: '新的对话',
          messages: [],
          summary: '',
          createdAt: timestamp,
          updatedAt: timestamp
        }
        runtime.saveAliSessions([session, ...runtime.aliState().sessions])
        return session
      },
      updateSession: async (id: string, patch: Partial<AliSession>) => {
        const sessions = runtime.aliState().sessions
        const session = sessions.find((item) => item.id === id)
        if (session) Object.assign(session, patch, { updatedAt: now() })
        runtime.saveAliSessions(sessions)
        return session
      },
      deleteSession: async (id: string) => {
        runtime.saveAliSessions(
          runtime.aliState().sessions.filter((item) => item.id !== id)
        )
      },
      batchDeleteSessions: async (ids: string[]) => {
        const set = new Set(ids)
        const sessions = runtime.aliState().sessions
        const next = sessions.filter((item) => !set.has(item.id))
        runtime.saveAliSessions(next)
        return sessions.length - next.length
      },
      send: async (request: AliSendRequest) => runtime.sendAli(request),
      cancel: async (requestId: string) => runtime.cancelAli(requestId),
      test: async () => testWebAli(runtime.library.data.settings),
      undoMemory: async (lines: string[]) =>
        removeWebAliMemoryLines(
          {
            settings: () => runtime.library.data.settings,
            getSession: () => undefined,
            appendMessage: () => undefined,
            updateSession: () => undefined,
            memory: () => runtime.readAliMemory(),
            saveMemory: (state) => runtime.saveAliMemory(state),
            emit: () => undefined,
            recordUsage: () => undefined,
            fetchUrl: async () => ({ url: '', title: '', text: '' })
          },
          lines
        ),
      help: async (): Promise<AliHelpSection[]> => webAliHelpSections(),
      memory: {
        get: async () => runtime.readAliMemory(),
        save: async (doc: string, content: string) => {
          const state = runtime.readAliMemory()
          if (doc === 'SELF.md') state.self = content
          else if (doc === 'MEMORY.md') state.memory = content
          else {
            const title = doc.replace(/^.*\//, '').replace(/\.md$/i, '')
            const existing = state.topics.find((item) => item.doc === doc)
            if (existing) existing.content = content
            else {
              state.topics.push({
                doc,
                title,
                description: '',
                pinned: false,
                content
              })
            }
          }
          return runtime.saveAliMemory(state)
        },
        remove: async (doc: string) => {
          const state = runtime.readAliMemory()
          state.topics = state.topics.filter((item) => item.doc !== doc)
          runtime.saveAliMemory(state)
        },
        pin: async (doc: string, pinned: boolean) => {
          const state = runtime.readAliMemory()
          const topic = state.topics.find((item) => item.doc === doc)
          if (topic) topic.pinned = pinned
          runtime.saveAliMemory(state)
        },
        clear: async () => {
          runtime.saveAliMemory({
            self: '',
            memory: '',
            topics: [],
            archive: '',
            usage: {
              self: { chars: 0, quota: 1_800 },
              memory: { chars: 0, quota: 3_000 }
            }
          })
        },
        consolidate: async () =>
          consolidateWebAliMemory({
            settings: () => runtime.library.data.settings,
            getSession: () => undefined,
            appendMessage: () => undefined,
            updateSession: () => undefined,
            memory: () => runtime.readAliMemory(),
            saveMemory: (state) => runtime.saveAliMemory(state),
            emit: () => undefined,
            recordUsage: (input) => runtime.recordUsage(input),
            fetchUrl: async () => ({ url: '', title: '', text: '' })
          }),
        restore: async (doc: string, line: string) => {
          if (doc !== 'SELF.md' && doc !== 'MEMORY.md') {
            throw new Error('归档条目无效')
          }
          restoreWebAliMemoryLine(
            {
              settings: () => runtime.library.data.settings,
              getSession: () => undefined,
              appendMessage: () => undefined,
              updateSession: () => undefined,
              memory: () => runtime.readAliMemory(),
              saveMemory: (state) => runtime.saveAliMemory(state),
              emit: () => undefined,
              recordUsage: () => undefined,
              fetchUrl: async () => ({ url: '', title: '', text: '' })
            },
            doc,
            line
          )
        },
        export: async () => {
          const state = runtime.readAliMemory()
          return download(
            JSON.stringify(state, null, 2),
            `阿栗记忆-${new Date().toISOString().slice(0, 10)}.json`,
            'application/json'
          )
        },
        import: async () => {
          const file = await runtime.library.pickOne('.json')
          if (!file) return { canceled: true }
          const parsed = JSON.parse(await file.text()) as AliMemoryState
          runtime.saveAliMemory({
            ...runtime.readAliMemory(),
            ...parsed
          })
          return { canceled: false, imported: 1 }
        }
      }
    },
    settings: {
      save: async (patch: Partial<AppSettings>) => {
        runtime.library.data.settings = {
          ...runtime.library.data.settings,
          ...patch,
          ali: { ...runtime.library.data.settings.ali, ...(patch.ali ?? {}) }
        }
        runtime.library.persist()
        runtime.settingsChanged()
        return runtime.library.data.settings
      },
      test: async (): Promise<TestResult> => {
        const settings = runtime.library.data.settings
        if (!settings.apiBaseUrl || !settings.apiKey) {
          return { ok: false, message: '请先填写 API 地址和密钥' }
        }
        try {
          const response = await fetch(
            `${settings.apiBaseUrl.replace(/\/+$/, '')}/models`,
            {
              headers: { authorization: `Bearer ${settings.apiKey}` }
            }
          )
          return {
            ok: response.ok,
            message: response.ok ? '连接成功' : `连接失败 (${response.status})`
          }
        } catch (error) {
          return { ok: false, message: (error as Error).message }
        }
      },
      openDataDir: async () => {
        throw new Error('浏览器数据保存在当前站点的 IndexedDB，可通过浏览器站点设置清理')
      },
      info: async () => ({
        version: '0.1.19-web',
        dataDir: '浏览器本地存储',
        shortcut: ''
      })
    },
    usage: {
      snapshot: async () => ({
        records: readJson<UsageRecord[]>('arbor-web-usage-v1', []),
        active: []
      }),
      clear: async () => {
        writeJson('arbor-web-usage-v1', [])
        for (const listener of runtime['usageListeners']) {
          listener({ cleared: true, active: [] })
        }
        runtime['scheduleSync']()
      }
    },
    backup: {
      list: async () =>
        (await getJson<BackupInfo[]>('backup-index')) ?? [],
      run: async () => {
        const createdAt = now()
        const name = `arbor-web-${new Date(createdAt)
          .toISOString()
          .replace(/[:.]/g, '-')}.json`
        const serialized = JSON.stringify(runtime.library.data)
        const info: BackupInfo = {
          name,
          createdAt,
          size: new Blob([serialized]).size
        }
        await putJson(`backup:${name}`, runtime.library.data)
        const existing = (await getJson<BackupInfo[]>('backup-index')) ?? []
        const next = [info, ...existing].slice(0, 20)
        await putJson('backup-index', next)
        for (const removed of existing.slice(19)) {
          await deleteJson(`backup:${removed.name}`)
        }
        return info
      },
      restore: async (name: string) => {
        const value = await getJson<LibraryData>(`backup:${name}`)
        if (!value) throw new Error('浏览器备份不存在')
        runtime.library.data = value
        runtime.library.persist()
        runtime.settingsChanged()
      }
    },
    translate: {
      list: async () => runtime.library.data.translations,
      delete: async (id: string) => {
        const record = runtime.library.data.translations.find(
          (item) => item.id === id
        )
        if (record) {
          runtime.library.removeBindingsForPath(
            runtime.library.translationPath(record.imageFile)
          )
          if (record.translatedImageFile) {
            runtime.library.removeBindingsForPath(
              runtime.library.translationPath(record.translatedImageFile)
            )
          }
        }
        runtime.library.data.translations = runtime.library.data.translations.filter(
          (item) => item.id !== id
        )
        runtime.library.persist()
      },
      start: async () => runtime.startTranslate(),
      renderResponse: async () => undefined,
      exportImage: async (
        id: string,
        variant: 'original' | 'translated'
      ) => {
        const record = runtime.library.data.translations.find(
          (item) => item.id === id
        )
        const file =
          variant === 'translated' && record?.translatedImageFile
            ? record.translatedImageFile
            : record?.imageFile
        if (!record || !file) throw new Error('翻译图片不存在')
        const blob = await runtime.library.blobForPath(
          runtime.library.translationPath(file)
        )
        if (!blob) throw new Error('翻译图片尚未同步到当前设备')
        return download(blob, file, blob.type || 'image/png')
      }
    },
    search: {
      global: async (query: string): Promise<SearchResult[]> => {
        const needle = query.toLowerCase().trim()
        if (!needle) return []
        return runtime.library.data.documents
          .filter((doc) =>
            `${doc.title} ${doc.authors} ${doc.abstract} ${doc.notes}`
              .toLowerCase()
              .includes(needle)
          )
          .map((doc) => ({
            id: doc.id,
            type: 'document',
            title: doc.title,
            snippet: doc.abstract || doc.notes || doc.authors,
            docId: doc.id,
            updatedAt: doc.updatedAt
          }))
      }
    },
    documents: {
      exportMarkdown: async (title: string, markdown: string, format: 'docx' | 'md') => {
        if (format === 'docx') {
          return download(
            await markdownToDocx(title, markdown),
            `${safePathSegment(title)}.docx`,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          )
        }
        return download(
          markdown,
          `${safePathSegment(title)}.md`,
          'text/markdown; charset=utf-8'
        )
      },
      exportBibtex: async () => {
        const escape = (value: string): string =>
          value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
        const entries = runtime.library.data.documents
          .map((doc) => {
            const key = `arbor_${doc.id.replace(/-/g, '').slice(0, 12)}`
            return [
              `@article{${key},`,
              `  title = {${escape(doc.title)}},`,
              `  author = {${escape(doc.authors)}},`,
              `  year = {${escape(doc.year)}},`,
              `  journal = {${escape(doc.journal)}},`,
              `  doi = {${escape(doc.doi)}},`,
              `  url = {${escape(doc.url)}}`,
              '}'
            ].join('\n')
          })
          .join('\n\n')
        return download(entries, 'arbor.bib', 'text/plain; charset=utf-8')
      },
      exportLibrary: async (format: 'md' | 'zip') => {
        if (format === 'md') {
          const markdown = runtime.library.data.documents
            .map(
              (doc) =>
                `## ${doc.title}\n\n${[
                  doc.authors,
                  doc.year,
                  doc.journal,
                  doc.doi ? `DOI: ${doc.doi}` : '',
                  doc.url
                ]
                  .filter(Boolean)
                  .join(' · ')}\n\n${doc.abstract || doc.notes}\n`
            )
            .join('\n')
          return download(markdown, 'Arbor-文献库.md', 'text/markdown; charset=utf-8')
        }
        const entries: { name: string; data: Blob | string }[] = [
          {
            name: 'library.json',
            data: JSON.stringify(runtime.library.data, null, 2)
          }
        ]
        for (const doc of runtime.library.data.documents) {
          const binding = runtime.library.bindingForDocument(doc)
          if (!binding) continue
          const blob = await runtime.library.blobForPath(binding.path)
          if (blob) entries.push({ name: binding.path, data: blob })
          const texts = await runtime.library.loadTexts(doc.id)
          if (texts.length) {
            entries.push({
              name: runtime.library.textPath(doc.id),
              data: JSON.stringify(texts)
            })
          }
        }
        return download(
          await createZip(entries),
          'Arbor-文献库.zip',
          'application/zip'
        )
      },
      exportPackage: async (docId: string) => {
        const doc = runtime.library.data.documents.find((item) => item.id === docId)
        if (!doc) throw new Error('文献不存在')
        const entries: { name: string; data: Blob | string }[] = [
          { name: 'metadata.json', data: JSON.stringify(doc, null, 2) },
          {
            name: 'texts.json',
            data: JSON.stringify(await runtime.library.loadTexts(docId))
          },
          {
            name: 'annotations.json',
            data: JSON.stringify(await runtime.library.loadAnnotations(docId))
          }
        ]
        const binding = runtime.library.bindingForDocument(doc)
        if (binding) {
          const blob = await runtime.library.blobForPath(binding.path)
          if (blob) {
            entries.push({
              name: `files/${safePathSegment(doc.fileName)}`,
              data: blob
            })
          }
        }
        return download(
          await createZip(entries),
          `${safePathSegment(doc.title)}.zip`,
          'application/zip'
        )
      }
    },
    app: {
      newWindow: async (docId?: string) => {
        window.open(`${location.pathname}?openDoc=${encodeURIComponent(docId ?? '')}`, '_blank')
      },
      showInFolder: async () => undefined
    },
    blindBox: {
      open: async () => {
        window.open(
          '/blind-box.html',
          'arbor-blind-box',
          'popup,width=520,height=720'
        )
      }
    },
    readerPanel: {
      state: async () => runtime.panelState(),
      open: async (
        docId: string,
        tab: ReaderPanelTab,
        activeChatId: string | null
      ) => runtime.openPanel(docId, tab, activeChatId),
      close: async () => {
        runtime.closePanel()
        return { ok: true }
      },
      setPinned: async (pinned: boolean) => {
        runtime['readerPanelState'].pinned = pinned
        runtime.sendPanel({ type: 'pinned', pinned })
      },
      setDirty: () => undefined,
      setTab: (tab: ReaderPanelTab, activeChatId: string | null) => {
        runtime['readerPanelState'] = {
          ...runtime['readerPanelState'],
          tab,
          activeChatId
        }
      },
      notifyChanged: () => runtime.sendPanel({ type: 'data-changed' }),
      refresh: () => runtime.sendPanel({ type: 'refresh' }),
      quote: async (docId: string, text: string, page?: number) => {
        runtime.sendPanel({ type: 'quote', docId, text, page, nonce: now() })
      },
      ready: (docId: string) => runtime.sendPanel({ type: 'ready', docId }),
      openDoc: (docId: string, page?: number) =>
        runtime.sendPanel({ type: 'open-doc', docId, page }),
      sendPage: (docId: string, page: number) =>
        runtime.sendPanel({ type: 'page', docId, page }),
      sendOutline: (docId: string, state: ReaderPanelOutlineState) =>
        runtime.sendPanel({ type: 'outline', docId, ...state })
    },
    updates: {
      check: async () => ({
        currentVersion: '0.1.19', latestVersion: '0.1.19', hasUpdate: false, notes: ''
      }),
      progress: async () => null,
      download: async () => ({ ok: false, canceled: false, message: 'Web 端通过浏览器更新' }),
      install: async () => ({ ok: false, message: 'Web 端无需安装' }),
      cancel: async () => undefined,
      openRelease: async () => window.open('https://github.com/charlie-sys/arbor-sync-preview/releases', '_blank')
    }
  }
  window.__arborAssetResolver = (url) => runtime.library.zotfileUrl(url)
  window.api = withFallback(api) as unknown as ZotAgentApi
}
