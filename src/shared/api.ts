import type {
  AiActionId,
  AiActionOutput,
  AppSettings,
  BackupInfo,
  CanvasBoard,
  ChatContext,
  ChatSession,
  Collection,
  DocumentMeta,
  Excerpt,
  Highlight,
  HighlightColor,
  HighlightRect,
  ImportCandidate,
  ImportResult,
  InboxAttachment,
  InboxItem,
  InboxKind,
  InboxSuggestion,
  LibraryData,
  Property,
  PropertyType,
  ReadingPlan,
  RenderRequest,
  ResearchTopic,
  SavedView,
  SavedViewConfig,
  SearchResult,
  Tag,
  TaskItem,
  TranslationRecord,
  TranslationResult
} from './types'
import type { ComposeScope } from './compose'

export interface ChatEvent {
  requestId: string
  type: 'delta' | 'done' | 'error'
  delta?: string
  content?: string
  error?: string
}

export interface TranslateEvent {
  type: 'status' | 'result'
  status?: 'selecting' | 'capturing' | 'translating' | 'canceled' | 'error'
  message?: string
  result?: TranslationResult
}

export interface AppInfo {
  version: string
  dataDir: string
  shortcut: string
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface UpdateAsset {
  name: string
  url: string
  size: number
  digest?: string
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseName: string
  releaseUrl: string
  notes: string
  publishedAt?: string
  asset?: UpdateAsset
  checkedAt: number
  error?: string
}

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'
  percent: number
  received: number
  total: number
  message?: string
}

export interface UpdateDownloadResult {
  ok: boolean
  message?: string
  filePath?: string
  version?: string
}

export interface UpdateInstallResult {
  ok: boolean
  message?: string
}

export interface ExportResult {
  canceled: boolean
  filePath?: string
}

export type ReaderPanelTab = 'agent' | 'info' | 'notes' | 'highlights' | 'outline' | 'excerpts' | 'tasks'

export interface ReaderPanelState {
  open: boolean
  docId: string | null
  tab: ReaderPanelTab
  activeChatId: string | null
  pinned: boolean
}

export interface ReaderPanelQuote {
  text: string
  page?: number
  nonce: number
}

export interface ReaderPanelOutlineItem {
  title: string
  page: number | null
  children: ReaderPanelOutlineItem[]
}

export interface ReaderPanelOutlineState {
  outline: ReaderPanelOutlineItem[]
  outlineLoaded: boolean
  fallbackToc: { page: number; title: string }[]
}

export interface ReaderPanelClosedPayload {
  docId: string
  tab: ReaderPanelTab
  activeChatId: string | null
}

export interface ReaderPanelPagePayload {
  docId: string
  page: number
}

export interface ReaderPanelOpenDocPayload {
  docId: string
  page?: number
}

export interface ZotAgentApi {
  library: {
    getState(): Promise<LibraryData>
    pickPdfs(): Promise<ImportCandidate[]>
    importPdf(filePath: string, title: string): Promise<DocumentMeta>
    setText(id: string, pages: string[], meta?: { title?: string; authors?: string }): Promise<void>
    update(id: string, patch: Partial<DocumentMeta>): Promise<DocumentMeta | undefined>
    remove(id: string): Promise<void>
    getTexts(id: string): Promise<string[]>
    pdfUrl(id: string): string
  }
  collections: {
    add(name: string, parentId?: string): Promise<Collection>
    update(
      id: string,
      patch: Partial<Pick<Collection, 'name' | 'parentId' | 'includeChildren'>>
    ): Promise<Collection | undefined>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
  }
  tags: {
    add(input: { name: string; parentId?: string; color?: string }): Promise<Tag>
    update(id: string, patch: Partial<Pick<Tag, 'name' | 'parentId' | 'color'>>): Promise<Tag | undefined>
    remove(id: string): Promise<void>
  }
  properties: {
    add(input: { name: string; type: PropertyType; options?: string[] }): Promise<Property>
    update(id: string, patch: { name?: string; type?: PropertyType; options?: string[] }): Promise<Property | undefined>
    remove(id: string): Promise<void>
  }
  views: {
    add(name: string, config: SavedViewConfig): Promise<SavedView>
    update(id: string, patch: { name?: string; config?: SavedViewConfig }): Promise<SavedView | undefined>
    remove(id: string): Promise<void>
  }
  topics: {
    list(): Promise<ResearchTopic[]>
    add(input: { name: string; docIds: string[] }): Promise<ResearchTopic>
    update(
      id: string,
      patch: Partial<Pick<ResearchTopic, 'name' | 'docIds' | 'questions' | 'chatId'>>
    ): Promise<ResearchTopic | undefined>
    remove(id: string): Promise<void>
    suggest(id: string): Promise<string[]>
  }
  readingPlan: {
    generate(goal: string): Promise<ReadingPlan>
  }
  imports: {
    bibtex(): Promise<ImportResult>
    readwise(): Promise<ImportResult>
  }
  canvases: {
    add(name: string): Promise<CanvasBoard>
    update(
      id: string,
      patch: Partial<Pick<CanvasBoard, 'name' | 'nodes' | 'edges'>>
    ): Promise<CanvasBoard | undefined>
    remove(id: string): Promise<void>
  }
  chats: {
    create(docIds: string[]): Promise<ChatSession>
    update(id: string, patch: Partial<Pick<ChatSession, 'title' | 'docIds' | 'messages'>>): Promise<ChatSession | undefined>
    remove(id: string): Promise<void>
    pickAttachments(chatId: string, kind: 'image' | 'file'): Promise<InboxAttachment[]>
    saveAttachment(
      chatId: string,
      name: string,
      data: Uint8Array,
      kind?: 'image' | 'file'
    ): Promise<InboxAttachment>
    removeAttachment(chatId: string, file: string): Promise<void>
  }
  highlights: {
    add(input: {
      docId: string
      page: number
      color: HighlightColor
      text: string
      note?: string
      rects: HighlightRect[]
    }): Promise<Highlight>
    update(
      id: string,
      patch: Partial<Pick<Highlight, 'color' | 'note' | 'rects'>>
    ): Promise<Highlight | undefined>
    remove(id: string): Promise<void>
    list(docId: string): Promise<Highlight[]>
  }
  excerpts: {
    add(input: {
      docId?: string | null
      page?: number
      source?: string
      question?: string
      answer?: string
    }): Promise<Excerpt>
    update(
      id: string,
      patch: Partial<Pick<Excerpt, 'page' | 'source' | 'question' | 'answer'>>
    ): Promise<Excerpt | undefined>
    remove(id: string): Promise<void>
    list(): Promise<Excerpt[]>
    pickAttachments(excerptId: string, kind: 'image' | 'file'): Promise<InboxAttachment[]>
    removeAttachment(excerptId: string, attachmentId: string): Promise<void>
    exportZip(excerptId: string): Promise<{ canceled: boolean; filePath?: string }>
  }
  inbox: {
    list(): Promise<InboxItem[]>
    add(input: {
      kind: InboxKind
      content: string
      title?: string
      url?: string
      docId?: string
      page?: number
      due?: string
    }): Promise<InboxItem>
    update(
      id: string,
      patch: Partial<Pick<InboxItem, 'content' | 'title' | 'url' | 'archived'>>
    ): Promise<InboxItem | undefined>
    remove(id: string): Promise<void>
    suggest(): Promise<InboxSuggestion[]>
    apply(inboxId: string, suggestion: InboxSuggestion): Promise<{ ok: boolean }>
    pickAttachments(inboxId: string, kind: 'image' | 'file'): Promise<InboxAttachment[]>
    removeAttachment(inboxId: string, attachmentId: string): Promise<void>
    exportZip(inboxId: string): Promise<{ canceled: boolean; filePath?: string }>
  }
  tasks: {
    list(): Promise<TaskItem[]>
    add(input: { title: string; due?: string; docId?: string; excerptId?: string; inboxId?: string }): Promise<TaskItem>
    update(
      id: string,
      patch: Partial<Pick<TaskItem, 'title' | 'due' | 'done'>>
    ): Promise<TaskItem | undefined>
    remove(id: string): Promise<void>
  }
  agent: {
    send(req: {
      requestId: string
      chatId: string
      docIds: string[]
      messages: { role: 'user' | 'assistant'; content: string }[]
      context?: ChatContext
    }): Promise<{ ok: boolean }>
    cancel(requestId: string): Promise<void>
    compose(chatId: string, title: string, extraInstruction: string, scope?: ComposeScope, outline?: string): Promise<string>
  }
  actions: {
    run(input: {
      action: AiActionId
      text: string
      page?: number
      docId?: string
      targetDocId?: string
    }): Promise<AiActionOutput>
  }
  documents: {
    exportMarkdown(title: string, markdown: string, format: 'docx' | 'md'): Promise<ExportResult>
    exportBibtex(): Promise<ExportResult>
    exportLibrary(format: 'md' | 'zip'): Promise<ExportResult>
    exportPackage(docId: string): Promise<ExportResult>
  }
  search: {
    global(query: string): Promise<SearchResult[]>
  }
  translate: {
    start(): Promise<{ ok: boolean; reason?: string }>
    delete(id: string): Promise<void>
    list(): Promise<TranslationRecord[]>
    renderResponse(requestId: string, dataUrl: string | null): Promise<void>
    exportImage(id: string, variant: 'original' | 'translated'): Promise<ExportResult>
  }
  settings: {
    save(patch: Partial<AppSettings>): Promise<AppSettings>
    test(): Promise<TestResult>
    openDataDir(): Promise<void>
    info(): Promise<AppInfo>
  }
  backup: {
    list(): Promise<BackupInfo[]>
    run(): Promise<BackupInfo>
    restore(name: string): Promise<void>
  }
  app: {
    showInFolder(filePath: string): Promise<void>
  }
  updates: {
    check(force?: boolean): Promise<UpdateInfo>
    download(): Promise<UpdateDownloadResult>
    install(): Promise<UpdateInstallResult>
    openRelease(): Promise<void>
  }
  readerPanel: {
    open(docId: string, tab: ReaderPanelTab, activeChatId: string | null): Promise<ReaderPanelState>
    close(): Promise<{ ok: boolean }>
    state(): Promise<ReaderPanelState>
    setPinned(pinned: boolean): Promise<void>
    setDirty(dirty: boolean): void
    setTab(tab: ReaderPanelTab, activeChatId: string | null): void
    notifyChanged(): void
    refresh(): void
    quote(docId: string, text: string, page?: number): Promise<void>
    ready(docId: string): void
    openDoc(docId: string, page?: number): void
    sendPage(docId: string, page: number): void
    sendOutline(docId: string, state: ReaderPanelOutlineState): void
  }
  events: {
    onChat(cb: (event: ChatEvent) => void): () => void
    onTranslate(cb: (event: TranslateEvent) => void): () => void
    onRenderRequest(cb: (request: RenderRequest) => void): () => void
    onReaderPanelClosed(cb: (payload: ReaderPanelClosedPayload) => void): () => void
    onReaderPanelQuote(cb: (payload: ReaderPanelQuote) => void): () => void
    onReaderPanelPage(cb: (payload: ReaderPanelPagePayload) => void): () => void
    onReaderPanelOutline(cb: (payload: ReaderPanelOutlineState & { docId: string }) => void): () => void
    onReaderPanelDataChanged(cb: () => void): () => void
    onReaderPanelRefresh(cb: () => void): () => void
    onReaderPanelOpenDoc(cb: (payload: ReaderPanelOpenDocPayload) => void): () => void
    onReaderPanelReady(cb: (payload: { docId: string }) => void): () => void
    onReaderPanelBlockClose(cb: () => void): () => void
    onReaderPanelPinned(cb: (pinned: boolean) => void): () => void
    onUpdateProgress(cb: (progress: UpdateProgress) => void): () => void
  }
  overlay: {
    select(rect: { x: number; y: number; width: number; height: number }): Promise<void>
    cancel(): Promise<void>
  }
}

declare global {
  interface Window {
    api: ZotAgentApi
  }
}
