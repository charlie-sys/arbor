import { contextBridge, ipcRenderer } from 'electron'
import type { ZotAgentApi, ChatEvent, TranslateEvent, UpdateProgress } from '../shared/api'
import type {
  AiActionId,
  AppSettings,
  CanvasBoard,
  ChatSession,
  Collection,
  DocumentMeta,
  Excerpt,
  Highlight,
  InboxAttachment,
  InboxItem,
  InboxKind,
  InboxSuggestion,
  PropertyType,
  RenderRequest,
  ResearchTopic,
  SavedViewConfig,
  Tag,
  TaskItem
} from '../shared/types'
import type { ComposeScope } from '../shared/compose'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ZotAgentApi = {
  library: {
    getState: () => ipcRenderer.invoke('library:get-state'),
    pickPdfs: () => ipcRenderer.invoke('library:pick-pdfs'),
    importPdf: (filePath: string, title: string) => ipcRenderer.invoke('library:import', { filePath, title }),
    setText: (id: string, pages: string[], meta?: { title?: string; authors?: string }) =>
      ipcRenderer.invoke('library:set-text', { id, pages, ...meta }),
    update: (id: string, patch: Partial<DocumentMeta>) => ipcRenderer.invoke('library:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('library:delete', id),
    getTexts: (id: string) => ipcRenderer.invoke('library:get-texts', id),
    pdfUrl: (id: string) => `zotfile://files/${id}.pdf`
  },
  collections: {
    add: (name: string, parentId?: string) => ipcRenderer.invoke('collection:add', { name, parentId }),
    update: (id: string, patch: Partial<Pick<Collection, 'name' | 'parentId' | 'includeChildren'>>) =>
      ipcRenderer.invoke('collection:update', { id, patch }),
    rename: (id: string, name: string) => ipcRenderer.invoke('collection:rename', { id, name }),
    remove: (id: string) => ipcRenderer.invoke('collection:delete', id)
  },
  tags: {
    add: (input: { name: string; parentId?: string; color?: string }) => ipcRenderer.invoke('tag:add', input),
    update: (id: string, patch: Partial<Pick<Tag, 'name' | 'parentId' | 'color'>>) =>
      ipcRenderer.invoke('tag:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('tag:delete', id)
  },
  properties: {
    add: (input: { name: string; type: PropertyType; options?: string[] }) =>
      ipcRenderer.invoke('property:add', input),
    update: (id: string, patch: { name?: string; type?: PropertyType; options?: string[] }) =>
      ipcRenderer.invoke('property:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('property:delete', id)
  },
  views: {
    add: (name: string, config: SavedViewConfig) => ipcRenderer.invoke('view:add', { name, config }),
    update: (id: string, patch: { name?: string; config?: SavedViewConfig }) =>
      ipcRenderer.invoke('view:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('view:delete', id)
  },
  topics: {
    list: (): Promise<ResearchTopic[]> => ipcRenderer.invoke('topic:list'),
    add: (input: { name: string; docIds: string[] }) => ipcRenderer.invoke('topic:add', input),
    update: (id: string, patch: Partial<Pick<ResearchTopic, 'name' | 'docIds' | 'questions' | 'chatId'>>) =>
      ipcRenderer.invoke('topic:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('topic:remove', id),
    suggest: (id: string): Promise<string[]> => ipcRenderer.invoke('topic:suggest', id)
  },
  readingPlan: {
    generate: (goal: string) => ipcRenderer.invoke('reading-plan:generate', goal)
  },
  imports: {
    bibtex: () => ipcRenderer.invoke('import:bibtex'),
    readwise: () => ipcRenderer.invoke('import:readwise')
  },
  canvases: {
    add: (name: string) => ipcRenderer.invoke('canvas:add', name),
    update: (id: string, patch: Partial<Pick<CanvasBoard, 'name' | 'nodes' | 'edges'>>) =>
      ipcRenderer.invoke('canvas:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('canvas:delete', id)
  },
  chats: {
    create: (docIds: string[]) => ipcRenderer.invoke('chat:create', docIds),
    update: (id: string, patch: Partial<Pick<ChatSession, 'title' | 'docIds' | 'messages'>>) =>
      ipcRenderer.invoke('chat:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('chat:delete', id),
    pickAttachments: (chatId: string, kind: 'image' | 'file'): Promise<InboxAttachment[]> =>
      ipcRenderer.invoke('chat:pick-attachments', { chatId, kind }),
    saveAttachment: (
      chatId: string,
      name: string,
      data: Uint8Array,
      kind?: 'image' | 'file'
    ): Promise<InboxAttachment> => ipcRenderer.invoke('chat:save-attachment', { chatId, name, data, kind }),
    removeAttachment: (chatId: string, file: string) =>
      ipcRenderer.invoke('chat:remove-attachment', { chatId, file })
  },
  highlights: {
    add: (input) => ipcRenderer.invoke('highlight:add', input),
    update: (id: string, patch: Partial<Pick<Highlight, 'color' | 'note' | 'rects'>>) =>
      ipcRenderer.invoke('highlight:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('highlight:remove', id),
    list: (docId: string) => ipcRenderer.invoke('highlight:list', docId)
  },
  excerpts: {
    add: (input: { docId?: string | null; page?: number; source?: string; question?: string; answer?: string }) =>
      ipcRenderer.invoke('excerpt:add', input),
    update: (id: string, patch: Partial<Pick<Excerpt, 'page' | 'source' | 'question' | 'answer'>>) =>
      ipcRenderer.invoke('excerpt:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('excerpt:remove', id),
    list: () => ipcRenderer.invoke('excerpt:list'),
    pickAttachments: (excerptId: string, kind: 'image' | 'file'): Promise<InboxAttachment[]> =>
      ipcRenderer.invoke('excerpt:pick-attachments', { excerptId, kind }),
    removeAttachment: (excerptId: string, attachmentId: string) =>
      ipcRenderer.invoke('excerpt:remove-attachment', { excerptId, attachmentId }),
    exportZip: (excerptId: string): Promise<{ canceled: boolean; filePath?: string }> =>
      ipcRenderer.invoke('excerpt:export-zip', excerptId)
  },
  inbox: {
    list: () => ipcRenderer.invoke('inbox:list'),
    add: (input: {
      kind: InboxKind
      content: string
      title?: string
      url?: string
      docId?: string
      page?: number
      due?: string
    }) => ipcRenderer.invoke('inbox:add', input),
    update: (id: string, patch: Partial<Pick<InboxItem, 'content' | 'title' | 'url' | 'archived'>>) =>
      ipcRenderer.invoke('inbox:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('inbox:remove', id),
    suggest: (): Promise<InboxSuggestion[]> => ipcRenderer.invoke('inbox:suggest'),
    apply: (inboxId: string, suggestion: InboxSuggestion) =>
      ipcRenderer.invoke('inbox:apply', { inboxId, suggestion }),
    pickAttachments: (inboxId: string, kind: 'image' | 'file'): Promise<InboxAttachment[]> =>
      ipcRenderer.invoke('inbox:pick-attachments', { inboxId, kind }),
    removeAttachment: (inboxId: string, attachmentId: string) =>
      ipcRenderer.invoke('inbox:remove-attachment', { inboxId, attachmentId }),
    exportZip: (inboxId: string): Promise<{ canceled: boolean; filePath?: string }> =>
      ipcRenderer.invoke('inbox:export-zip', inboxId)
  },
  tasks: {
    list: (): Promise<TaskItem[]> => ipcRenderer.invoke('task:list'),
    add: (input: { title: string; due?: string; docId?: string; excerptId?: string; inboxId?: string }) =>
      ipcRenderer.invoke('task:add', input),
    update: (id: string, patch: Partial<Pick<TaskItem, 'title' | 'due' | 'done'>>) =>
      ipcRenderer.invoke('task:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('task:remove', id)
  },
  agent: {
    send: (req) => ipcRenderer.invoke('chat:send', req),
    cancel: (requestId: string) => ipcRenderer.invoke('chat:cancel', requestId),
    compose: (chatId: string, title: string, extraInstruction: string, scope?: ComposeScope, outline?: string) =>
      ipcRenderer.invoke('agent:compose', { chatId, title, extraInstruction, scope, outline })
  },
  actions: {
    run: (input: { action: AiActionId; text: string; page?: number; docId?: string; targetDocId?: string }) =>
      ipcRenderer.invoke('ai-action:run', input)
  },
  documents: {
    exportMarkdown: (title: string, markdown: string, format: 'docx' | 'md') =>
      ipcRenderer.invoke('documents:export', { title, markdown, format }),
    exportBibtex: () => ipcRenderer.invoke('documents:export-bibtex'),
    exportLibrary: (format: 'md' | 'zip') => ipcRenderer.invoke('documents:export-library', format),
    exportPackage: (docId: string) => ipcRenderer.invoke('documents:export-package', docId)
  },
  search: {
    global: (query: string) => ipcRenderer.invoke('search:global', query)
  },
  translate: {
    start: () => ipcRenderer.invoke('translate:start'),
    delete: (id: string) => ipcRenderer.invoke('translate:delete', id),
    list: () => ipcRenderer.invoke('translate:list'),
    renderResponse: (requestId: string, dataUrl: string | null) =>
      ipcRenderer.invoke('translate:render-response', { requestId, dataUrl }),
    exportImage: (id: string, variant: 'original' | 'translated') =>
      ipcRenderer.invoke('translate:export-image', { id, variant })
  },
  settings: {
    save: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', patch),
    test: () => ipcRenderer.invoke('settings:test'),
    openDataDir: () => ipcRenderer.invoke('settings:open-data-dir'),
    info: () => ipcRenderer.invoke('settings:info')
  },
  backup: {
    list: () => ipcRenderer.invoke('backup:list'),
    run: () => ipcRenderer.invoke('backup:run'),
    restore: (name: string) => ipcRenderer.invoke('backup:restore', name)
  },
  app: {
    showInFolder: (filePath: string) => ipcRenderer.invoke('app:show-in-folder', filePath)
  },
  updates: {
    check: (force?: boolean) => ipcRenderer.invoke('update:check', force === true),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    openRelease: () => ipcRenderer.invoke('update:open-release')
  },
  readerPanel: {
    open: (docId, tab, activeChatId) => ipcRenderer.invoke('reader-panel:open', { docId, tab, activeChatId }),
    close: () => ipcRenderer.invoke('reader-panel:close'),
    state: () => ipcRenderer.invoke('reader-panel:state'),
    setPinned: (pinned) => ipcRenderer.invoke('reader-panel:set-pinned', pinned),
    setDirty: (dirty) => ipcRenderer.send('reader-panel:set-dirty', dirty),
    setTab: (tab, activeChatId) => ipcRenderer.send('reader-panel:set-tab', { tab, activeChatId }),
    notifyChanged: () => ipcRenderer.send('reader-panel:notify-changed'),
    refresh: () => ipcRenderer.send('reader-panel:refresh'),
    quote: (docId, text, page) => ipcRenderer.invoke('reader-panel:quote', { docId, text, page }),
    ready: (docId) => ipcRenderer.send('reader-panel:ready', docId),
    openDoc: (docId, page) => ipcRenderer.send('reader-panel:open-doc', { docId, page }),
    sendPage: (docId, page) => ipcRenderer.send('reader-panel:send-page', { docId, page }),
    sendOutline: (docId, state) => ipcRenderer.send('reader-panel:send-outline', { docId, ...state })
  },
  events: {
    onChat: (cb) => subscribe<ChatEvent>('chat:event', cb),
    onTranslate: (cb) => subscribe<TranslateEvent>('translate:event', cb),
    onRenderRequest: (cb) => subscribe<RenderRequest>('translate:render-request', cb),
    onReaderPanelClosed: (cb) => subscribe('reader-panel:closed', cb),
    onReaderPanelQuote: (cb) => subscribe('reader-panel:quote-event', cb),
    onReaderPanelPage: (cb) => subscribe('reader-panel:page', cb),
    onReaderPanelOutline: (cb) => subscribe('reader-panel:outline', cb),
    onReaderPanelDataChanged: (cb) => subscribe('reader-panel:data-changed', cb),
    onReaderPanelRefresh: (cb) => subscribe('reader-panel:refresh', cb),
    onReaderPanelOpenDoc: (cb) => subscribe('reader-panel:open-doc-event', cb),
    onReaderPanelReady: (cb) => subscribe('reader-panel:ready-event', cb),
    onReaderPanelBlockClose: (cb) => subscribe('reader-panel:block-close', cb),
    onReaderPanelPinned: (cb) => subscribe('reader-panel:pinned', cb),
    onUpdateProgress: (cb) => subscribe<UpdateProgress>('update:progress', cb)
  },
  overlay: {
    select: (rect) => ipcRenderer.invoke('capture:selection', rect),
    cancel: () => ipcRenderer.invoke('capture:cancel')
  }
}

contextBridge.exposeInMainWorld('api', api)
