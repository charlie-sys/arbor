import { contextBridge, ipcRenderer } from 'electron'
import type { ZotAgentApi, ChatEvent, ExportResult, TranslateEvent, UpdateProgress, UsageRecordedEvent } from '../shared/api'
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
  TaskItem,
  ActiveUsage
} from '../shared/types'
import type { ComposeScope } from '../shared/compose'
import type { AliEvent, AliSendRequest, AliSessionPatch } from '../shared/ali'
import type {
  PetRuntimeConfig,
  PetSettings,
  PetSignal,
  PetSnapshot,
  PetState
} from '../shared/pet'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ZotAgentApi = {
  library: {
    getState: () => ipcRenderer.invoke('library:get-state'),
    pickDocuments: () => ipcRenderer.invoke('library:pick-documents'),
    importDocument: (filePath: string, title: string) =>
      ipcRenderer.invoke('library:import-document', { filePath, title }),
    extractText: (id: string) => ipcRenderer.invoke('library:extract-text', id),
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
  attachments: {
    open: (ownerId: string, file: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('attachment:open', { ownerId, file }),
    saveAs: (ownerId: string, file: string, name: string): Promise<ExportResult> =>
      ipcRenderer.invoke('attachment:save-as', { ownerId, file, name })
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
  ali: {
    getState: () => ipcRenderer.invoke('ali:get-state'),
    createSession: () => ipcRenderer.invoke('ali:session:create'),
    updateSession: (id: string, patch: AliSessionPatch) =>
      ipcRenderer.invoke('ali:session:update', { id, patch }),
    deleteSession: (id: string) => ipcRenderer.invoke('ali:session:delete', id),
    send: (req: AliSendRequest) => ipcRenderer.invoke('ali:send', req),
    cancel: (requestId: string) => ipcRenderer.invoke('ali:cancel', requestId),
    test: () => ipcRenderer.invoke('ali:test'),
    undoMemory: (lines: string[]) => ipcRenderer.invoke('ali:memory:undo', lines),
    help: () => ipcRenderer.invoke('ali:help'),
    memory: {
      get: () => ipcRenderer.invoke('ali:memory:get'),
      save: (doc: string, content: string) => ipcRenderer.invoke('ali:memory:save', { doc, content }),
      remove: (doc: string) => ipcRenderer.invoke('ali:memory:remove', doc),
      pin: (doc: string, pinned: boolean) => ipcRenderer.invoke('ali:memory:pin', { doc, pinned }),
      clear: () => ipcRenderer.invoke('ali:memory:clear'),
      consolidate: () => ipcRenderer.invoke('ali:memory:consolidate'),
      restore: (doc: string, line: string) => ipcRenderer.invoke('ali:memory:restore', { doc, line }),
      export: () => ipcRenderer.invoke('ali:memory:export'),
      import: () => ipcRenderer.invoke('ali:memory:import')
    }
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
  usage: {
    snapshot: () => ipcRenderer.invoke('usage:snapshot'),
    clear: () => ipcRenderer.invoke('usage:clear')
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
    onAli: (cb) => subscribe<AliEvent>('ali:event', cb),
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
    onUpdateProgress: (cb) => subscribe<UpdateProgress>('update:progress', cb),
    onUsageRecorded: (cb) => subscribe<UsageRecordedEvent>('usage:recorded', cb),
    onUsageLive: (cb) => subscribe<ActiveUsage[]>('usage:live', cb),
    onSettingsChanged: (cb) => subscribe<AppSettings>('settings:changed', cb)
  },
  overlay: {
    select: (rect) => ipcRenderer.invoke('capture:selection', rect),
    cancel: () => ipcRenderer.invoke('capture:cancel')
  },
  pet: {
    signal: (signal: PetSignal) => ipcRenderer.send('pet:signal', signal),
    getState: (): Promise<PetSnapshot> => ipcRenderer.invoke('pet:get-state'),
    getConfig: (): Promise<PetRuntimeConfig> => ipcRenderer.invoke('pet:get-config'),
    setEnabled: (enabled: boolean): Promise<PetRuntimeConfig> =>
      ipcRenderer.invoke('pet:set-enabled', enabled),
    applySettings: (patch: Partial<PetSettings>) => ipcRenderer.send('pet:apply-settings', patch),
    celebrate: () => ipcRenderer.send('pet:celebrate'),
    setTheme: (theme: string) => ipcRenderer.send('pet:theme', theme),
    menu: () => ipcRenderer.send('pet:menu'),
    openMain: () => ipcRenderer.send('pet:open-main'),
    openSettings: () => ipcRenderer.send('pet:open-settings'),
    openAli: () => ipcRenderer.send('pet:open-ali'),
    openAliChat: () => ipcRenderer.send('pet:open-ali-chat'),
    debugForce: (state: PetState | null) => ipcRenderer.send('pet:debug-force', state),
    window: {
      bounds: () => ipcRenderer.invoke('pet:window-bounds'),
      move: (x: number, y: number) => ipcRenderer.send('pet:window-move', { x, y }),
      ignoreMouse: (ignore: boolean) => ipcRenderer.send('pet:mouse-ignore', ignore),
      reset: () => ipcRenderer.invoke('pet:window-reset')
    },
    onState: (cb: (snapshot: PetSnapshot) => void) => subscribe('pet:state', cb),
    onTheme: (cb: (theme: string) => void) => subscribe('pet:theme', cb),
    onConfig: (cb: (config: PetRuntimeConfig) => void) => subscribe('pet:config', cb),
    onSettingsChanged: (cb: (settings: PetSettings) => void) => subscribe('pet:settings-changed', cb),
    onOpenSettings: (cb: () => void) => subscribe('pet:open-settings', cb),
    onOpenAli: (cb: () => void) => subscribe('pet:open-ali', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
