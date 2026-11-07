import { contextBridge, ipcRenderer } from 'electron'
import type { ZotAgentApi, ChatEvent, TranslateEvent } from '../shared/api'
import type { AppSettings, ChatSession, DocumentMeta, RenderRequest } from '../shared/types'

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
    add: (name: string) => ipcRenderer.invoke('collection:add', name),
    rename: (id: string, name: string) => ipcRenderer.invoke('collection:rename', { id, name }),
    remove: (id: string) => ipcRenderer.invoke('collection:delete', id)
  },
  chats: {
    create: (docIds: string[]) => ipcRenderer.invoke('chat:create', docIds),
    update: (id: string, patch: Partial<Pick<ChatSession, 'title' | 'docIds' | 'messages'>>) =>
      ipcRenderer.invoke('chat:update', { id, patch }),
    remove: (id: string) => ipcRenderer.invoke('chat:delete', id)
  },
  agent: {
    send: (req) => ipcRenderer.invoke('chat:send', req),
    cancel: (requestId: string) => ipcRenderer.invoke('chat:cancel', requestId),
    compose: (chatId: string, title: string, extraInstruction: string) =>
      ipcRenderer.invoke('agent:compose', { chatId, title, extraInstruction })
  },
  documents: {
    exportMarkdown: (title: string, markdown: string, format: 'docx' | 'md') =>
      ipcRenderer.invoke('documents:export', { title, markdown, format })
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
  app: {
    showInFolder: (filePath: string) => ipcRenderer.invoke('app:show-in-folder', filePath)
  },
  events: {
    onChat: (cb) => subscribe<ChatEvent>('chat:event', cb),
    onTranslate: (cb) => subscribe<TranslateEvent>('translate:event', cb),
    onRenderRequest: (cb) => subscribe<RenderRequest>('translate:render-request', cb)
  },
  overlay: {
    select: (rect) => ipcRenderer.invoke('capture:selection', rect),
    cancel: () => ipcRenderer.invoke('capture:cancel')
  }
}

contextBridge.exposeInMainWorld('api', api)
