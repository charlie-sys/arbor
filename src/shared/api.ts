import type {
  AppSettings,
  ChatSession,
  Collection,
  DocumentMeta,
  ImportCandidate,
  LibraryData,
  RenderRequest,
  TranslationRecord,
  TranslationResult
} from './types'

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

export interface ExportResult {
  canceled: boolean
  filePath?: string
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
    add(name: string): Promise<Collection>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
  }
  chats: {
    create(docIds: string[]): Promise<ChatSession>
    update(id: string, patch: Partial<Pick<ChatSession, 'title' | 'docIds' | 'messages'>>): Promise<ChatSession | undefined>
    remove(id: string): Promise<void>
  }
  agent: {
    send(req: {
      requestId: string
      chatId: string
      docIds: string[]
      messages: { role: 'user' | 'assistant'; content: string }[]
      contextMode?: 'auto' | 'none'
    }): Promise<{ ok: boolean }>
    cancel(requestId: string): Promise<void>
    compose(chatId: string, title: string, extraInstruction: string): Promise<string>
  }
  documents: {
    exportMarkdown(title: string, markdown: string, format: 'docx' | 'md'): Promise<ExportResult>
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
  app: {
    showInFolder(filePath: string): Promise<void>
  }
  events: {
    onChat(cb: (event: ChatEvent) => void): () => void
    onTranslate(cb: (event: TranslateEvent) => void): () => void
    onRenderRequest(cb: (request: RenderRequest) => void): () => void
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
