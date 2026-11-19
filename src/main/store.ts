import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { existsSync, statSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { formatFromFileName } from '../shared/documents'
import { normalizePricing } from '../shared/usage'
import { defaultAliSettings, normalizeAliSettings } from '../shared/ali'
import { localeFromStored, localeFromSystemTag, t, type Locale } from '../shared/i18n'
import { defaultSystemPrompt, isDefaultSystemPrompt } from '../shared/i18n/defaults'
import type { WebPageSnapshot } from '../shared/web'
import { splitIntoPages } from './documentPages'
import { LocalSyncStore, type LocalSyncStatus } from './localSync'
import type { SyncChange, SyncConflict, SyncEntity, SyncOperation } from '../shared/sync'
import type {
  AppSettings,
  CanvasBoard,
  ChatSession,
  Collection,
  DocumentMeta,
  Excerpt,
  Highlight,
  InboxItem,
  InboxKind,
  InboxAttachment,
  LibraryData,
  Property,
  PropertyType,
  ReadingPlan,
  ResearchTopic,
  SavedView,
  SavedViewConfig,
  Tag,
  TaskItem,
  TranslationRecord
} from '../shared/types'

import { normalizeUpdateSource } from '../shared/updateSource'

const DEFAULT_SETTINGS: AppSettings = {
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
  petEnabled: true,
  petBubbles: true,
  ali: defaultAliSettings()
}

export function uid(): string {
  return crypto.randomUUID()
}

function emptyData(): LibraryData {
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
    settings: { ...DEFAULT_SETTINGS, ali: defaultAliSettings() }
  }
}

interface StoredSettings extends Partial<AppSettings> {
  apiKeyEnc?: string
  aliApiKeyEnc?: string
  aliAuxApiKeyEnc?: string
  aliWebApiKeyEnc?: string
  aliGithubTokenEnc?: string
}

interface StoredData extends Omit<LibraryData, 'settings'> {
  settings: StoredSettings
}

class Store {
  root = ''
  filesDir = ''
  textsDir = ''
  translationsDir = ''
  attachmentsDir = ''
  data: LibraryData = emptyData()
  private localSync = new LocalSyncStore()
  private saveChain: Promise<void> = Promise.resolve()
  private changeListeners = new Set<() => void>()

  onChanged(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  get libraryFile(): string {
    return path.join(this.root, 'library.json')
  }

  async init(): Promise<void> {
    this.localSync.close()
    this.root = path.join(app.getPath('userData'), 'data')
    this.filesDir = path.join(this.root, 'files')
    this.textsDir = path.join(this.root, 'texts')
    this.translationsDir = path.join(this.root, 'translations')
    this.attachmentsDir = path.join(this.root, 'attachments')
    await fs.mkdir(this.filesDir, { recursive: true })
    await fs.mkdir(this.textsDir, { recursive: true })
    await fs.mkdir(this.translationsDir, { recursive: true })
    await fs.mkdir(this.attachmentsDir, { recursive: true })
    await this.localSync.init(this.root)

    let diskData: LibraryData | null = null
    try {
      const raw = await fs.readFile(this.libraryFile, 'utf-8')
      const parsed = JSON.parse(raw) as StoredData
      const settings: AppSettings = { ...DEFAULT_SETTINGS, ...parsed.settings }
      if (!Number.isInteger(settings.uiFontSize) || settings.uiFontSize < 12 || settings.uiFontSize > 20) settings.uiFontSize = 14
      settings.ali = normalizeAliSettings(parsed.settings.ali)
      // 旧数据没有语言字段：保留用户已有的简体中文界面，避免升级后被自动切换。
      settings.language =
        typeof parsed.settings.language === 'string'
          ? localeFromStored(parsed.settings.language)
          : 'zh-CN'
      if (!settings.systemPrompt?.trim()) settings.systemPrompt = defaultSystemPrompt(settings.language)
      settings.usagePricing = normalizePricing(parsed.settings.usagePricing)
      const decrypt = (value?: string): string => {
        if (!value) return ''
        try {
          return safeStorage.decryptString(Buffer.from(value, 'base64'))
        } catch {
          return ''
        }
      }
      if (parsed.settings.apiKeyEnc) settings.apiKey = decrypt(parsed.settings.apiKeyEnc)
      if (parsed.settings.aliApiKeyEnc) settings.ali.apiKey = decrypt(parsed.settings.aliApiKeyEnc)
      if (parsed.settings.aliAuxApiKeyEnc) settings.ali.auxApiKey = decrypt(parsed.settings.aliAuxApiKeyEnc)
      if (parsed.settings.aliWebApiKeyEnc) settings.ali.webApiKey = decrypt(parsed.settings.aliWebApiKeyEnc)
      if (parsed.settings.aliGithubTokenEnc) settings.ali.githubToken = decrypt(parsed.settings.aliGithubTokenEnc)
      delete (settings as StoredSettings).apiKeyEnc
      delete (settings as StoredSettings).aliApiKeyEnc
      delete (settings as StoredSettings).aliAuxApiKeyEnc
      delete (settings as StoredSettings).aliWebApiKeyEnc
      delete (settings as StoredSettings).aliGithubTokenEnc
      // 旧版本默认上限为 24000；现在默认不限制注入的文献上下文
      if (settings.maxContextChars === 24000) settings.maxContextChars = 0
      const documents = (parsed.documents ?? []).map((doc) => ({
        ...doc,
        sourceFormat: doc.sourceFormat ?? (doc.fileName ? formatFromFileName(doc.fileName) : null) ?? 'pdf',
        readingStatus: doc.readingStatus ?? 'unread'
      }))
      const tags: Tag[] = [...(parsed.tags ?? [])]
      for (const doc of documents) {
        for (const name of doc.tags ?? []) {
          if (!tags.some((tag) => tag.name === name)) tags.push({ id: uid(), name })
        }
      }
      diskData = {
        version: 1,
        documents,
        collections: parsed.collections ?? [],
        chats: parsed.chats ?? [],
        translations: parsed.translations ?? [],
        highlights: parsed.highlights ?? [],
        excerpts: (parsed.excerpts ?? []).map((item) => ({ ...item, attachments: item.attachments ?? [] })),
        inbox: (parsed.inbox ?? []).map((item) => ({
          ...item,
          tags: item.tags ?? [],
          attachments: item.attachments ?? []
        })),
        tasks: parsed.tasks ?? [],
        researchTopics: parsed.researchTopics ?? [],
        canvases: parsed.canvases ?? [],
        tags,
        properties: parsed.properties ?? [],
        savedViews: parsed.savedViews ?? [],
        readingPlans: parsed.readingPlans ?? [],
        settings
      }
    } catch {
      const locale: Locale = localeFromSystemTag(app.getLocale())
      diskData = emptyData()
      diskData.settings.language = locale
      diskData.settings.systemPrompt = defaultSystemPrompt(locale)
    }

    if (this.localSync.hasLibrarySnapshot()) {
      this.data = this.localSync.loadLibrary(diskData.settings) ?? diskData
    } else {
      this.data = diskData
      await this.localSync.importLibrary(this.data, this.libraryFile)
    }
    if (
      !this.localSync.listLocalEntities('reading_plan').length &&
      diskData.readingPlans.length
    ) {
      this.data.readingPlans = diskData.readingPlans
      await this.save()
    }
    if (!diskData.documents.length && !diskData.collections.length && !diskData.chats.length) {
      await this.save()
    }
  }

  save(): Promise<void> {
    this.saveChain = this.saveChain.then(() => this.writeNow()).catch((err) => {
      console.error('Failed to save library', err)
    })
    return this.saveChain
  }

  private async writeNow(): Promise<void> {
    this.localSync.persistLibrary(this.data)
    const ali = { ...(this.data.settings.ali ?? defaultAliSettings()) }
    const settings: StoredSettings = { ...this.data.settings, ali }
    const encrypt = (value?: string): string | undefined =>
      value && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value).toString('base64') : undefined
    if (settings.apiKey) settings.apiKeyEnc = encrypt(settings.apiKey)
    if (ali.apiKey) settings.aliApiKeyEnc = encrypt(ali.apiKey)
    if (ali.auxApiKey) settings.aliAuxApiKeyEnc = encrypt(ali.auxApiKey)
    if (ali.webApiKey) settings.aliWebApiKeyEnc = encrypt(ali.webApiKey)
    if (ali.githubToken) settings.aliGithubTokenEnc = encrypt(ali.githubToken)
    const disk: StoredData = { ...this.data, settings }
    delete (disk.settings as StoredSettings).apiKey
    disk.settings.ali = { ...ali, apiKey: '', auxApiKey: '', webApiKey: '', githubToken: '' }
    const tmp = `${this.libraryFile}.tmp`
    await fs.writeFile(tmp, JSON.stringify(disk, null, 2), 'utf-8')
    await fs.rename(tmp, this.libraryFile)
    for (const listener of this.changeListeners) listener()
  }

  async prepareBackup(): Promise<void> {
    await this.saveChain
    this.localSync.checkpoint()
  }

  async prepareRestore(): Promise<void> {
    await this.saveChain
    this.localSync.checkpoint()
    this.localSync.close()
  }

  localSyncStatus(): LocalSyncStatus {
    return this.localSync.status()
  }

  userDataEntityCount(): number {
    return this.localSync.userDataEntityCount()
  }

  exportSyncSnapshot(): SyncEntity[] {
    return this.localSync.exportSnapshot()
  }

  pendingSyncOperations(limit = 200): SyncOperation[] {
    return this.localSync.pendingOperations(limit)
  }

  acknowledgeSyncOperations(opIds: string[]): void {
    this.localSync.acknowledgeOperations(opIds)
  }

  clearPendingSyncOperations(): void {
    this.localSync.clearPendingOperations()
  }

  markSyncConflicts(opIds: string[]): void {
    this.localSync.markOperationsConflict(opIds)
  }

  recordSyncConflicts(
    operations: SyncOperation[],
    conflicts: Array<{
      opId: string
      serverVersion: number
      serverPayload?: unknown
      serverDeleted?: boolean
    }>
  ): void {
    this.localSync.recordConflicts(operations, conflicts)
  }

  syncConflicts(): SyncConflict[] {
    return this.localSync.listConflicts()
  }

  resolveSyncConflict(
    opId: string,
    strategy: 'local' | 'server' | 'merge' | 'custom',
    payload?: unknown
  ): void {
    this.localSync.resolveConflict(opId, strategy, payload)
    this.reloadFromLocalSync()
  }

  syncConflictCount(): number {
    return this.localSync.conflictCount()
  }

  reconcileEquivalentBlobConflicts(): number {
    return this.localSync.reconcileEquivalentBlobConflicts()
  }

  clearSyncConflicts(): number {
    return this.localSync.clearConflicts()
  }

  initialMergePreview(userId?: string) {
    return this.localSync.initialMergePreview(userId)
  }

  stageInitialMerge(entities: SyncEntity[], userId: string, snapshotSeq: number) {
    return this.localSync.stageInitialMerge(entities, userId, snapshotSeq)
  }

  applyInitialMerge(userId: string): void {
    this.localSync.applyInitialMerge(userId)
    this.reloadFromLocalSync()
  }

  discardInitialMerge(): void {
    this.localSync.discardInitialMerge()
  }

  upsertSyncBinding(entityType: string, entityId: string, payload: unknown): void {
    this.localSync.upsertLocalEntity(entityType, entityId, payload)
  }

  upsertSyncEntity(entityType: string, entityId: string, payload: unknown): void {
    this.localSync.upsertLocalEntity(entityType, entityId, payload)
  }

  deleteSyncEntity(entityType: string, entityId: string): void {
    this.localSync.deleteLocalEntity(entityType, entityId)
  }

  getSyncBinding(entityType: string, entityId: string): unknown | null {
    return this.localSync.getLocalEntity(entityType, entityId)
  }

  listSyncBindings(entityType = 'blob_binding'): SyncEntity[] {
    return this.localSync.listLocalEntities(entityType)
  }

  syncServerUserId(): string | null {
    return this.localSync.serverUserId()
  }

  syncCursor(userId: string): number {
    return this.localSync.serverCursor(userId)
  }

  setSyncCursor(userId: string, seq: number): void {
    this.localSync.setServerCursor(userId, seq)
  }

  replaceFromSyncSnapshot(entities: SyncEntity[], userId: string, seq: number): void {
    this.localSync.replaceFromSnapshot(entities, userId, seq)
    this.reloadFromLocalSync()
  }

  applySyncChanges(changes: SyncChange[]): void {
    this.localSync.applyChanges(changes)
    this.reloadFromLocalSync()
  }

  reloadFromLocalSync(): void {
    const next = this.localSync.loadLibrary(this.data.settings)
    if (!next) return
    this.data = next
    for (const listener of this.changeListeners) listener()
  }

  getDocument(id: string): DocumentMeta | undefined {
    return this.data.documents.find((d) => d.id === id)
  }

  private documentFileCandidates(doc: DocumentMeta): Set<string> {
    const fileName = path.basename(doc.fileName || '')
    const extension =
      path.extname(fileName).toLowerCase() ||
      (doc.sourceFormat === 'pdf'
        ? '.pdf'
        : doc.sourceFormat === 'docx'
          ? '.docx'
          : doc.sourceFormat === 'doc'
            ? '.doc'
            : doc.sourceFormat === 'txt'
              ? '.txt'
              : '')
    const candidates = new Set<string>()
    if (fileName) {
      candidates.add(path.join(this.filesDir, doc.id, fileName))
      candidates.add(path.join(this.filesDir, fileName))
    }
    if (extension) {
      candidates.add(path.join(this.filesDir, `${doc.id}${extension}`))
    }
    const nestedPrefix = `files/${doc.id}/`
    for (const binding of this.listSyncBindings('blob_binding')) {
      const bindingPath =
        binding.payload &&
        typeof binding.payload === 'object' &&
        typeof (binding.payload as { path?: unknown }).path === 'string'
          ? String((binding.payload as { path: string }).path)
          : ''
      if (!bindingPath.startsWith(nestedPrefix)) continue
      const segment = bindingPath.slice(nestedPrefix.length)
      if (!segment || segment.includes('/') || segment.includes('\\')) continue
      candidates.add(path.join(this.filesDir, doc.id, segment))
    }
    return candidates
  }

  resolveDocumentFileSync(id: string): string {
    const doc = this.getDocument(id)
    if (!doc) throw new Error(t('文献不存在'))
    if (!/^[0-9a-f-]{36}$/i.test(doc.id)) {
      throw new Error(t('文献文件不存在'))
    }
    for (const candidate of this.documentFileCandidates(doc)) {
      const relative = path.relative(this.filesDir, candidate)
      if (
        !relative ||
        relative.startsWith('..') ||
        path.isAbsolute(relative)
      ) {
        continue
      }
      try {
        if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
      } catch {
        continue
      }
      return candidate
    }
    throw new Error(t('文献文件尚未同步到本机'))
  }

  async resolveDocumentFile(id: string): Promise<string> {
    return this.resolveDocumentFileSync(id)
  }

  async documentFileUrl(id: string): Promise<string> {
    const filePath = await this.resolveDocumentFile(id)
    const relative = path.relative(this.filesDir, filePath)
    const encoded = relative
      .split(path.sep)
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `zotfile://files/${encoded}`
  }

  private importCollections(collectionId?: string): string[] {
    if (collectionId === undefined || collectionId === '') return []
    if (typeof collectionId !== 'string' || !this.data.collections.some(item => item.id === collectionId)) throw new Error(t('目标文件夹不存在，请重新选择导入位置'))
    return [collectionId]
  }

  async addWebLink(metadata: { url: string; title: string; author: string }, archive?: (file: string) => Promise<void>, collectionId?: string): Promise<DocumentMeta> {
    const id = uid()
    const now = Date.now()
    const doc: DocumentMeta = {
      id, title: metadata.title, authors: metadata.author, year: '', journal: new URL(metadata.url).hostname,
      abstract: '', doi: '', url: metadata.url, tags: [], collections: this.importCollections(collectionId), addedAt: now, updatedAt: now,
      fileName: archive ? `${id}.mhtml` : '', sourceFormat: 'web', pageCount: 0,
      ...(archive ? { webArchivedAt: now } : {}),
      starred: false, readingStatus: 'unread', lastPage: 1, notes: ''
    }
    const file = archive ? path.join(this.filesDir, doc.fileName) : undefined
    try {
      if (archive && file) await archive(file)
      doc.collections = this.importCollections(collectionId)
      this.data.documents.unshift(doc)
      await this.save()
      return doc
    } catch (error) {
      this.data.documents = this.data.documents.filter((item) => item.id !== id)
      if (file) await fs.rm(file, { force: true })
      throw error
    }
  }

  async addWebDocument(snapshot: WebPageSnapshot): Promise<DocumentMeta> {
    const id = uid()
    const now = Date.now()
    const pages = splitIntoPages(snapshot.text)
    const doc: DocumentMeta = {
      id, title: snapshot.title, authors: snapshot.author, year: '', journal: new URL(snapshot.url).hostname,
      abstract: '', doi: '', url: snapshot.url, tags: [], collections: [], addedAt: now, updatedAt: now,
      fileName: `${id}.md`, sourceFormat: 'web', webCapturedAt: now, pageCount: pages.length,
      starred: false, readingStatus: 'unread', lastPage: 1, notes: ''
    }
    const file = path.join(this.filesDir, doc.fileName)
    const textFile = path.join(this.textsDir, `${id}.json`)
    try {
      await fs.writeFile(file, snapshot.text, 'utf8')
      await fs.writeFile(textFile, JSON.stringify(pages), 'utf8')
      this.data.documents.unshift(doc)
      await this.save()
      return doc
    } catch (error) {
      this.data.documents = this.data.documents.filter((item) => item.id !== id)
      await Promise.all([fs.rm(file, { force: true }), fs.rm(textFile, { force: true })])
      throw error
    }
  }

  getChat(id: string): ChatSession | undefined {
    return this.data.chats.find((c) => c.id === id)
  }

  async addDocument(filePath: string, title: string, collectionId?: string): Promise<DocumentMeta> {
    this.importCollections(collectionId)
    const sourceFormat = formatFromFileName(filePath)
    if (!sourceFormat) throw new Error(t("不支持的文献格式，请选择 PDF、Word、Markdown 或 TXT 文件"))
    const id = uid()
    const extension = path.extname(filePath).toLowerCase() || '.pdf'
    const fileName = `${id}${extension}`
    await fs.copyFile(filePath, path.join(this.filesDir, fileName))
    let collections: string[]
    try { collections = this.importCollections(collectionId) }
    catch (error) { await fs.rm(path.join(this.filesDir, fileName), { force: true }); throw error }
    const now = Date.now()
    const doc: DocumentMeta = {
      id,
      title,
      authors: '',
      year: '',
      journal: '',
      abstract: '',
      doi: '',
      url: '',
      tags: [],
      collections,
      addedAt: now,
      updatedAt: now,
      fileName,
      sourceFormat,
      pageCount: 0,
      starred: false,
      readingStatus: 'unread',
      lastPage: 1,
      notes: ''
    }
    this.data.documents.unshift(doc)
    await this.save()
    return doc
  }

  async setDocumentText(id: string, pages: string[], meta?: { title?: string; authors?: string }): Promise<void> {
    await fs.writeFile(path.join(this.textsDir, `${id}.json`), JSON.stringify(pages), 'utf-8')
    const doc = this.getDocument(id)
    if (!doc) return
    doc.pageCount = pages.length
    if (meta?.title && (!doc.title || doc.title === path.basename(doc.fileName))) doc.title = meta.title
    if (meta?.authors && !doc.authors) doc.authors = meta.authors
    doc.updatedAt = Date.now()
    await this.save()
  }

  async getDocumentTexts(id: string): Promise<string[]> {
    try {
      const raw = await fs.readFile(path.join(this.textsDir, `${id}.json`), 'utf-8')
      const pages = JSON.parse(raw)
      return Array.isArray(pages) ? pages : []
    } catch {
      return []
    }
  }

  async updateDocument(id: string, patch: Partial<DocumentMeta>, persist = true): Promise<DocumentMeta | undefined> {
    const doc = this.getDocument(id)
    if (!doc) return undefined
    if (Array.isArray(patch.tags)) {
      for (const name of patch.tags) {
        if (!this.data.tags.some((tag) => tag.name === name)) {
          this.data.tags.push({ id: uid(), name })
        }
      }
    }
    Object.assign(doc, patch, { id: doc.id, updatedAt: Date.now() })
    if (persist) await this.save()
    return doc
  }

  async deleteDocument(id: string, persist = true): Promise<void> {
    const removed = this.getDocument(id)
    this.data.documents = this.data.documents.filter((d) => d.id !== id)
    this.data.chats.forEach((chat) => {
      chat.docIds = chat.docIds.filter((d) => d !== id)
    })
    this.data.researchTopics.forEach((topic) => {
      topic.docIds = topic.docIds.filter((d) => d !== id)
    })
    this.deleteHighlightsByDoc(id, false)
    this.data.excerpts.forEach((excerpt) => {
      if (excerpt.docId === id) {
        excerpt.docMissing = true
        excerpt.updatedAt = Date.now()
      }
    })
    const resolvedFile = removed
      ? await this.resolveDocumentFile(id).catch(() => null)
      : null
    const legacyFile = path.join(
      this.filesDir,
      removed?.fileName || `${id}.pdf`
    )
    const nestedDirectory = path.join(this.filesDir, id)
    await Promise.allSettled([
      fs.rm(resolvedFile || legacyFile, { force: true }),
      path.dirname(resolvedFile || legacyFile) === nestedDirectory
        ? fs.rm(nestedDirectory, { recursive: true, force: true })
        : Promise.resolve(),
      fs.unlink(path.join(this.textsDir, `${id}.json`))
    ])
    if (persist) await this.save()
  }

  getHighlights(docId: string): Highlight[] {    return this.data.highlights
      .filter((item) => item.docId === docId)
      .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
  }

  async addHighlight(input: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'>): Promise<Highlight> {
    const now = Date.now()
    const highlight: Highlight = { ...input, id: uid(), createdAt: now, updatedAt: now }
    this.data.highlights.push(highlight)
    await this.save()
    return highlight
  }

  async updateHighlight(
    id: string,
    patch: Partial<Pick<Highlight, 'color' | 'note' | 'rects'>>
  ): Promise<Highlight | undefined> {
    const highlight = this.data.highlights.find((item) => item.id === id)
    if (!highlight) return undefined
    Object.assign(highlight, patch, { id: highlight.id, docId: highlight.docId, updatedAt: Date.now() })
    await this.save()
    return highlight
  }

  async deleteHighlight(id: string): Promise<void> {
    const before = this.data.highlights.length
    this.data.highlights = this.data.highlights.filter((item) => item.id !== id)
    if (this.data.highlights.length === before) return
    await this.save()
  }

  deleteHighlightsByDoc(docId: string, persist = true): void {
    this.data.highlights = this.data.highlights.filter((item) => item.docId !== docId)
    if (persist) void this.save()
  }

  getExcerpts(): Excerpt[] {
    return [...this.data.excerpts].sort((a, b) => b.createdAt - a.createdAt)
  }

  async addExcerpt(input: {
    docId?: string | null
    page?: number
    source?: string
    question?: string
    answer?: string
  }): Promise<Excerpt> {
    const now = Date.now()
    const doc = input.docId ? this.getDocument(input.docId) : undefined
    const excerpt: Excerpt = {
      id: uid(),
      docId: doc?.id ?? input.docId ?? null,
      docTitle: doc?.title ?? (input.docId ? t("未知文献") : t("未关联文献")),
      page: input.page,
      source: input.source ?? '',
      question: input.question ?? '',
      answer: input.answer ?? '',
      createdAt: now,
      updatedAt: now,
      docMissing: false
    }
    this.data.excerpts.push(excerpt)
    await this.save()
    return excerpt
  }

  async updateExcerpt(
    id: string,
    patch: Partial<Pick<Excerpt, 'page' | 'source' | 'question' | 'answer'>>
  ): Promise<Excerpt | undefined> {
    const excerpt = this.data.excerpts.find((item) => item.id === id)
    if (!excerpt) return undefined
    Object.assign(excerpt, patch, { id: excerpt.id, updatedAt: Date.now() })
    await this.save()
    return excerpt
  }

  async deleteExcerpt(id: string): Promise<void> {
    const before = this.data.excerpts.length
    this.data.excerpts = this.data.excerpts.filter((item) => item.id !== id)
    if (this.data.excerpts.length === before) return
    await this.save()
    await fs.rm(path.join(this.attachmentsDir, id), { recursive: true, force: true }).catch(() => undefined)
  }

  async addExcerptAttachments(
    excerptId: string,
    files: { sourcePath: string; name: string; kind: 'image' | 'file' }[]
  ): Promise<InboxAttachment[]> {
    const excerpt = this.data.excerpts.find((entry) => entry.id === excerptId)
    if (!excerpt) throw new Error(t("摘录不存在"))
    const dir = path.join(this.attachmentsDir, excerptId)
    await fs.mkdir(dir, { recursive: true })
    const added: InboxAttachment[] = []
    for (const file of files) {
      const stored = await this.uniqueAttachmentName(dir, file.name)
      const target = path.join(dir, stored)
      await fs.copyFile(file.sourcePath, target)
      const stat = await fs.stat(target)
      added.push({
        id: uid(),
        name: file.name,
        file: stored,
        kind: file.kind,
        size: stat.size,
        createdAt: Date.now()
      })
    }
    excerpt.attachments = [...(excerpt.attachments ?? []), ...added]
    excerpt.updatedAt = Date.now()
    await this.save()
    return added
  }

  async removeExcerptAttachment(excerptId: string, attachmentId: string): Promise<void> {
    const excerpt = this.data.excerpts.find((entry) => entry.id === excerptId)
    if (!excerpt) throw new Error(t("摘录不存在"))
    const attachment = (excerpt.attachments ?? []).find((entry) => entry.id === attachmentId)
    if (!attachment) return
    excerpt.attachments = (excerpt.attachments ?? []).filter((entry) => entry.id !== attachmentId)
    excerpt.updatedAt = Date.now()
    await this.save()
    await fs.rm(path.join(this.attachmentsDir, excerptId, attachment.file), { force: true }).catch(() => undefined)
  }

  getInbox(): InboxItem[] {
    return [...this.data.inbox].sort((a, b) => b.createdAt - a.createdAt)
  }

  async addInbox(input: {
    kind: InboxKind
    content: string
    title?: string
    url?: string
    docId?: string
    page?: number
    due?: string
  }): Promise<InboxItem> {
    const content = input.content.trim()
    if (!content) throw new Error(t("捕获内容不能为空"))
    const now = Date.now()
    const item: InboxItem = {
      id: uid(),
      kind: input.kind,
      content,
      title: (input.title ?? '').trim(),
      url: (input.url ?? '').trim(),
      tags: [],
      archived: false,
      createdAt: now,
      updatedAt: now
    }
    if (input.docId) item.docId = input.docId
    if (input.page && input.page > 0) item.page = Math.round(input.page)
    this.data.inbox.push(item)
    if (input.kind === 'todo') {
      const task: TaskItem = {
        id: uid(),
        title: content,
        done: false,
        inboxId: item.id,
        createdAt: now,
        updatedAt: now
      }
      const due = (input.due ?? '').trim()
      if (due) task.due = due
      if (input.docId) task.docId = input.docId
      this.data.tasks.push(task)
    }
    await this.save()
    return item
  }

  async updateInbox(
    id: string,
    patch: Partial<Pick<InboxItem, 'content' | 'title' | 'url' | 'archived' | 'tags'>>
  ): Promise<InboxItem | undefined> {
    const item = this.data.inbox.find((entry) => entry.id === id)
    if (!item) return undefined
    if (patch.content !== undefined) {
      const content = patch.content.trim()
      if (!content) throw new Error(t("捕获内容不能为空"))
      patch = { ...patch, content }
    }
    Object.assign(item, patch, { id: item.id, updatedAt: Date.now() })
    await this.save()
    return item
  }

  async deleteInbox(id: string): Promise<void> {
    const before = this.data.inbox.length
    this.data.inbox = this.data.inbox.filter((item) => item.id !== id)
    if (this.data.inbox.length === before) return
    this.data.tasks.forEach((task) => {
      if (task.inboxId === id) delete task.inboxId
    })
    await this.save()
    await fs.rm(path.join(this.attachmentsDir, id), { recursive: true, force: true }).catch(() => undefined)
  }

  async addInboxAttachments(
    inboxId: string,
    files: { sourcePath: string; name: string; kind: 'image' | 'file' }[]
  ): Promise<InboxAttachment[]> {
    const item = this.data.inbox.find((entry) => entry.id === inboxId)
    if (!item) throw new Error(t("Inbox 条目不存在"))
    const dir = path.join(this.attachmentsDir, inboxId)
    await fs.mkdir(dir, { recursive: true })
    const added: InboxAttachment[] = []
    for (const file of files) {
      const stored = await this.uniqueAttachmentName(dir, file.name)
      const target = path.join(dir, stored)
      await fs.copyFile(file.sourcePath, target)
      const stat = await fs.stat(target)
      added.push({
        id: uid(),
        name: file.name,
        file: stored,
        kind: file.kind,
        size: stat.size,
        createdAt: Date.now()
      })
    }
    item.attachments = [...(item.attachments ?? []), ...added]
    item.updatedAt = Date.now()
    await this.save()
    return added
  }

  async removeInboxAttachment(inboxId: string, attachmentId: string): Promise<void> {
    const item = this.data.inbox.find((entry) => entry.id === inboxId)
    if (!item) throw new Error(t("Inbox 条目不存在"))
    const attachment = (item.attachments ?? []).find((entry) => entry.id === attachmentId)
    if (!attachment) return
    item.attachments = (item.attachments ?? []).filter((entry) => entry.id !== attachmentId)
    item.updatedAt = Date.now()
    await this.save()
    await fs.rm(path.join(this.attachmentsDir, inboxId, attachment.file), { force: true }).catch(() => undefined)
  }

  private async uniqueAttachmentName(dir: string, original: string): Promise<string> {
    const parsed = path.parse(original)
    const base =
      parsed.name
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .trim()
        .slice(0, 80) || 'file'
    const ext = parsed.ext.replace(/[^.\w-]/g, '')
    const existing = new Set(await fs.readdir(dir).catch(() => [] as string[]))
    let candidate = `${base}${ext}`
    let index = 1
    while (existing.has(candidate)) {
      candidate = `${base} (${index})${ext}`
      index += 1
    }
    return candidate
  }

  getTasks(): TaskItem[] {
    return [...this.data.tasks].sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.due ?? '9999-12-31').localeCompare(b.due ?? '9999-12-31') ||
        b.createdAt - a.createdAt
    )
  }

  async addTask(input: {
    title: string
    due?: string
    docId?: string
    excerptId?: string
    inboxId?: string
  }): Promise<TaskItem> {
    const title = input.title.trim()
    if (!title) throw new Error(t("任务标题不能为空"))
    const now = Date.now()
    const task: TaskItem = { id: uid(), title, done: false, createdAt: now, updatedAt: now }
    const due = (input.due ?? '').trim()
    if (due) task.due = due
    if (input.docId) task.docId = input.docId
    if (input.excerptId) task.excerptId = input.excerptId
    if (input.inboxId) task.inboxId = input.inboxId
    this.data.tasks.push(task)
    await this.save()
    return task
  }

  async updateTask(
    id: string,
    patch: Partial<Pick<TaskItem, 'title' | 'due' | 'done'>>
  ): Promise<TaskItem | undefined> {
    const task = this.data.tasks.find((item) => item.id === id)
    if (!task) return undefined
    const next = { ...patch }
    if (next.title !== undefined) {
      const title = next.title.trim()
      if (!title) throw new Error(t("任务标题不能为空"))
      next.title = title
    }
    if (next.due !== undefined) {
      const due = next.due.trim()
      next.due = due || undefined
    }
    Object.assign(task, next, { id: task.id, updatedAt: Date.now() })
    if (!task.due) delete task.due
    await this.save()
    return task
  }

  async deleteTask(id: string): Promise<void> {
    const before = this.data.tasks.length
    this.data.tasks = this.data.tasks.filter((item) => item.id !== id)
    if (this.data.tasks.length === before) return
    await this.save()
  }

  async addCollection(name: string, parentId?: string, color?: string): Promise<Collection> {
    if (typeof name !== 'string' || !name.trim()) throw new Error(t('文件夹名称不能为空'))
    if (parentId && !this.data.collections.some(c => c.id === parentId)) throw new Error(t('父文件夹不存在'))
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error(t('请输入有效的 HEX 颜色'))
    name = name.trim()
    const collection: Collection = { id: uid(), name, createdAt: Date.now() }
    if (parentId && this.data.collections.some((c) => c.id === parentId)) collection.parentId = parentId
    if (color) collection.color = color.toLowerCase()
    this.data.collections.push(collection)
    await this.save()
    return collection
  }

  async updateCollection(
    id: string,
    patch: Partial<Pick<Collection, 'name' | 'parentId' | 'includeChildren' | 'color'>>
  ): Promise<Collection | undefined> {
    const collection = this.data.collections.find((c) => c.id === id)
    if (!collection) return undefined
    if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) throw new Error(t('文件夹名称不能为空'))
    if (patch.color !== undefined && (typeof patch.color !== 'string' || patch.color !== '' && !/^#[0-9a-f]{6}$/i.test(patch.color))) throw new Error(t('请输入有效的 HEX 颜色'))
    if (patch.includeChildren !== undefined && typeof patch.includeChildren !== 'boolean') throw new Error(t('请求参数无效'))
    if (patch.parentId !== undefined) {
      const nextParentId = patch.parentId
      if (nextParentId) {
        const parent = this.data.collections.find((c) => c.id === nextParentId)
        let cyclic = !parent
        let cursor = parent
        const guard = new Set<string>()
        while (cursor && !guard.has(cursor.id)) {
          if (cursor.id === id) {
            cyclic = true
            break
          }
          guard.add(cursor.id)
          const parentId = cursor.parentId
          cursor = parentId ? this.data.collections.find((c) => c.id === parentId) : undefined
        }
        if (cyclic) throw new Error(t('不能将文件夹移到自身或子文件夹中，请选择有效的父文件夹'))
      }
    }
    if (patch.name !== undefined) collection.name = patch.name.trim()
    if (patch.includeChildren !== undefined) collection.includeChildren = patch.includeChildren
    if (patch.parentId !== undefined) {
      if (patch.parentId) collection.parentId = patch.parentId
      else delete collection.parentId
    }
    if (patch.color !== undefined) {
      if (patch.color) collection.color = patch.color.toLowerCase()
      else delete collection.color
    }
    await this.save()
    return collection
  }

  async renameCollection(id: string, name: string): Promise<void> {
    await this.updateCollection(id, { name })
  }

  async deleteCollection(id: string): Promise<void> {
    const target = this.data.collections.find((c) => c.id === id)
    if (!target) return
    const grandParentId = target.parentId
    this.data.collections = this.data.collections.filter((c) => c.id !== id)
    this.data.collections.forEach((c) => {
      if (c.parentId !== id) return
      if (grandParentId) c.parentId = grandParentId
      else delete c.parentId
    })
    this.data.documents.forEach((doc) => {
      doc.collections = doc.collections.filter((c) => c !== id)
    })
    await this.save()
  }

  async addTag(input: { name: string; parentId?: string; color?: string }): Promise<Tag> {
    const name = input.name.trim()
    const existing = this.data.tags.find((tag) => tag.name === name)
    if (existing) return existing
    const tag: Tag = { id: uid(), name }
    if (input.parentId) tag.parentId = input.parentId
    if (input.color) tag.color = input.color
    this.data.tags.push(tag)
    await this.save()
    return tag
  }

  async updateTag(id: string, patch: Partial<Pick<Tag, 'name' | 'parentId' | 'color'>>): Promise<Tag | undefined> {
    const tag = this.data.tags.find((item) => item.id === id)
    if (!tag) return undefined
    const previousName = tag.name
    if (patch.parentId) {
      let cursor: Tag | undefined = this.data.tags.find((item) => item.id === patch.parentId)
      const guard = new Set<string>()
      while (cursor && !guard.has(cursor.id)) {
        if (cursor.id === id) {
          delete patch.parentId
          break
        }
        guard.add(cursor.id)
        const parentId = cursor.parentId
        cursor = parentId ? this.data.tags.find((item) => item.id === parentId) : undefined
      }
    } else if (patch.parentId === '') {
      delete patch.parentId
      delete tag.parentId
    }
    Object.assign(tag, patch)
    if (patch.name && patch.name.trim() && patch.name !== previousName) {
      const nextName = patch.name.trim()
      tag.name = nextName
      this.data.documents.forEach((doc) => {
        doc.tags = doc.tags.map((name) => (name === previousName ? nextName : name))
      })
    }
    await this.save()
    return tag
  }

  async deleteTag(id: string): Promise<void> {
    const tag = this.data.tags.find((item) => item.id === id)
    if (!tag) return
    this.data.tags = this.data.tags.filter((item) => item.id !== id)
    this.data.tags.forEach((item) => {
      if (item.parentId === id) delete item.parentId
    })
    this.data.documents.forEach((doc) => {
      doc.tags = doc.tags.filter((name) => name !== tag.name)
    })
    await this.save()
  }

  async addProperty(input: { name: string; type: PropertyType; options?: string[] }): Promise<Property> {
    const options = (input.options ?? [])
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ id: uid(), name }))
    const property: Property = { id: uid(), name: input.name.trim(), type: input.type }
    if (options.length) property.options = options
    this.data.properties.push(property)
    await this.save()
    return property
  }

  async updateProperty(
    id: string,
    patch: { name?: string; type?: PropertyType; options?: string[] }
  ): Promise<Property | undefined> {
    const property = this.data.properties.find((item) => item.id === id)
    if (!property) return undefined
    if (patch.name !== undefined && patch.name.trim()) property.name = patch.name.trim()
    if (patch.type) property.type = patch.type
    if (patch.options) {
      const previous = property.options ?? []
      property.options = patch.options
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => previous.find((option) => option.name === name) ?? { id: uid(), name })
    }
    await this.save()
    return property
  }

  async deleteProperty(id: string): Promise<void> {
    this.data.properties = this.data.properties.filter((item) => item.id !== id)
    this.data.documents.forEach((doc) => {
      if (doc.propertyValues) delete doc.propertyValues[id]
    })
    await this.save()
  }

  async addSavedView(name: string, config: SavedViewConfig): Promise<SavedView> {
    const now = Date.now()
    const view: SavedView = { id: uid(), name: name.trim(), config, createdAt: now, updatedAt: now }
    this.data.savedViews.push(view)
    await this.save()
    return view
  }

  async updateSavedView(id: string, patch: { name?: string; config?: SavedViewConfig }): Promise<SavedView | undefined> {
    const view = this.data.savedViews.find((item) => item.id === id)
    if (!view) return undefined
    if (patch.name !== undefined && patch.name.trim()) view.name = patch.name.trim()
    if (patch.config) view.config = patch.config
    view.updatedAt = Date.now()
    await this.save()
    return view
  }

  async deleteSavedView(id: string): Promise<void> {
    this.data.savedViews = this.data.savedViews.filter((item) => item.id !== id)
    await this.save()
  }

  async saveReadingPlan(plan: ReadingPlan): Promise<ReadingPlan> {
    const index = this.data.readingPlans.findIndex((item) => item.id === plan.id)
    if (index >= 0) this.data.readingPlans[index] = plan
    else this.data.readingPlans.unshift(plan)
    await this.save()
    return plan
  }

  async removeReadingPlan(id: string): Promise<void> {
    this.data.readingPlans = this.data.readingPlans.filter((item) => item.id !== id)
    await this.save()
  }

  getResearchTopics(): ResearchTopic[] {
    return [...this.data.researchTopics].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async addResearchTopic(input: { name: string; docIds: string[] }): Promise<ResearchTopic> {
    const name = input.name.trim()
    if (!name) throw new Error(t("研究主题名称不能为空"))
    const docIds = [...new Set(input.docIds)].filter((id) => this.getDocument(id))
    if (!docIds.length) throw new Error(t("请至少选择一篇文献"))
    const now = Date.now()
    const topic: ResearchTopic = { id: uid(), name, docIds, questions: [], createdAt: now, updatedAt: now }
    this.data.researchTopics.push(topic)
    await this.save()
    return topic
  }

  async updateResearchTopic(
    id: string,
    patch: Partial<Pick<ResearchTopic, 'name' | 'docIds' | 'questions' | 'chatId'>>
  ): Promise<ResearchTopic | undefined> {
    const topic = this.data.researchTopics.find((item) => item.id === id)
    if (!topic) return undefined
    Object.assign(topic, patch, { id: topic.id, updatedAt: Date.now() })
    await this.save()
    return topic
  }

  async deleteResearchTopic(id: string): Promise<void> {
    this.data.researchTopics = this.data.researchTopics.filter((item) => item.id !== id)
    await this.save()
  }

  async addCanvas(name: string): Promise<CanvasBoard> {
    const now = Date.now()
    const canvas: CanvasBoard = {
      id: uid(),
      name: name.trim() || t("未命名画布"),
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now
    }
    this.data.canvases.unshift(canvas)
    await this.save()
    return canvas
  }

  async updateCanvas(
    id: string,
    patch: Partial<Pick<CanvasBoard, 'name' | 'nodes' | 'edges'>>
  ): Promise<CanvasBoard | undefined> {
    const canvas = this.data.canvases.find((item) => item.id === id)
    if (!canvas) return undefined
    if (patch.name !== undefined && patch.name.trim()) canvas.name = patch.name.trim()
    if (patch.nodes) canvas.nodes = patch.nodes
    if (patch.edges) canvas.edges = patch.edges
    canvas.updatedAt = Date.now()
    await this.save()
    return canvas
  }

  async deleteCanvas(id: string): Promise<void> {
    this.data.canvases = this.data.canvases.filter((item) => item.id !== id)
    await this.save()
  }

  async createChat(docIds: string[]): Promise<ChatSession> {    const now = Date.now()
    const chat: ChatSession = {
      id: uid(),
      title: t("新的对话"),
      docIds,
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    this.data.chats.unshift(chat)
    await this.save()
    return chat
  }

  async updateChat(id: string, patch: Partial<Pick<ChatSession, 'title' | 'docIds' | 'messages'>>): Promise<ChatSession | undefined> {
    const chat = this.getChat(id)
    if (!chat) return undefined
    Object.assign(chat, patch, { updatedAt: Date.now() })
    await this.save()
    return chat
  }

  async addChatAttachments(
    chatId: string,
    files: { sourcePath: string; name: string; kind: 'image' | 'file' }[]
  ): Promise<InboxAttachment[]> {
    const dir = path.join(this.attachmentsDir, chatId)
    await fs.mkdir(dir, { recursive: true })
    const added: InboxAttachment[] = []
    for (const file of files) {
      const stored = await this.uniqueAttachmentName(dir, file.name)
      const target = path.join(dir, stored)
      await fs.copyFile(file.sourcePath, target)
      const stat = await fs.stat(target)
      added.push({
        id: uid(),
        name: file.name,
        file: stored,
        kind: file.kind,
        size: stat.size,
        createdAt: Date.now()
      })
    }
    return added
  }

  async saveChatAttachment(
    chatId: string,
    name: string,
    data: Buffer,
    kind: 'image' | 'file'
  ): Promise<InboxAttachment> {
    const dir = path.join(this.attachmentsDir, chatId)
    await fs.mkdir(dir, { recursive: true })
    const stored = await this.uniqueAttachmentName(dir, name)
    const target = path.join(dir, stored)
    await fs.writeFile(target, data)
    return {
      id: uid(),
      name,
      file: stored,
      kind,
      size: data.length,
      createdAt: Date.now()
    }
  }

  async removeChatAttachment(chatId: string, file: string): Promise<void> {
    await fs.rm(path.join(this.attachmentsDir, chatId, file), { force: true }).catch(() => undefined)
  }

  async deleteChat(id: string, persist = true): Promise<void> {
    this.data.chats = this.data.chats.filter((c) => c.id !== id)
    this.data.researchTopics.forEach((topic) => {
      if (topic.chatId === id) delete topic.chatId
    })
    if (persist) await this.save()
    await fs.rm(path.join(this.attachmentsDir, id), { recursive: true, force: true }).catch(() => undefined)
  }

  async addTranslation(record: TranslationRecord): Promise<void> {
    this.data.translations.unshift(record)
    await this.save()
  }

  async deleteTranslation(id: string): Promise<void> {
    const record = this.data.translations.find((t) => t.id === id)
    this.data.translations = this.data.translations.filter((t) => t.id !== id)
    if (record) {
      await fs.unlink(path.join(this.translationsDir, record.imageFile)).catch(() => undefined)
      if (record.translatedImageFile) {
        await fs.unlink(path.join(this.translationsDir, record.translatedImageFile)).catch(() => undefined)
      }
    }
    await this.save()
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    if (patch.updateDownloadSource !== undefined) patch = { ...patch, updateDownloadSource: normalizeUpdateSource(patch.updateDownloadSource) }
    if (patch.uiFontSize !== undefined && (!Number.isInteger(patch.uiFontSize) || patch.uiFontSize < 12 || patch.uiFontSize > 20)) throw new Error(t('界面字号应在 12 到 20 之间'))
    const prev = this.data.settings
    const next: AppSettings = {
      ...prev,
      ...patch,
      ali: normalizeAliSettings({ ...prev.ali, ...(patch.ali ?? {}) }),
      language: patch.language ? localeFromStored(patch.language) : prev.language
    }
    // 默认提示词随界面语言切换；用户自定义过的提示词保持不变。
    if (patch.language && patch.systemPrompt === undefined && isDefaultSystemPrompt(prev.systemPrompt)) {
      next.systemPrompt = defaultSystemPrompt(next.language)
    }
    this.data.settings = next
    await this.save()
    return this.data.settings
  }
}

export const store = new Store()
