import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { store } from './store'
import { streamChat, cancelChat, composeDocument, testConnection } from './llm'
import { exportMarkdown } from './docx'
import { startCapture, captureSelection, cancelCapture, resolveRenderResponse } from './capture'
import type { ChatRequest } from '../shared/types'
import type { ChatEvent } from '../shared/api'

export function registerIpc(): void {
  ipcMain.handle('library:get-state', () => store.data)

  ipcMain.handle('library:pick-pdfs', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入 PDF 文献',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF 文献', extensions: ['pdf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths.map((filePath) => {
      const fileName = path.basename(filePath)
      const title = fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim()
      return { filePath, fileName, title: title || fileName }
    })
  })

  ipcMain.handle('library:import', async (_event, payload: { filePath: string; title: string }) => {
    return store.addDocument(payload.filePath, payload.title)
  })

  ipcMain.handle(
    'library:set-text',
    async (_event, payload: { id: string; pages: string[]; title?: string; authors?: string }) => {
      await store.setDocumentText(payload.id, payload.pages, { title: payload.title, authors: payload.authors })
    }
  )

  ipcMain.handle('library:update', async (_event, payload: { id: string; patch: Record<string, unknown> }) => {
    return store.updateDocument(payload.id, payload.patch)
  })

  ipcMain.handle('library:delete', async (_event, id: string) => {
    await store.deleteDocument(id)
  })

  ipcMain.handle('library:get-texts', async (_event, id: string) => {
    return store.getDocumentTexts(id)
  })

  ipcMain.handle('collection:add', async (_event, name: string) => {
    return store.addCollection(name)
  })

  ipcMain.handle('collection:rename', async (_event, payload: { id: string; name: string }) => {
    await store.renameCollection(payload.id, payload.name)
  })

  ipcMain.handle('collection:delete', async (_event, id: string) => {
    await store.deleteCollection(id)
  })

  ipcMain.handle('chat:create', async (_event, docIds: string[]) => {
    return store.createChat(docIds)
  })

  ipcMain.handle(
    'chat:update',
    async (_event, payload: { id: string; patch: Record<string, unknown> }) => {
      return store.updateChat(payload.id, payload.patch)
    }
  )

  ipcMain.handle('chat:delete', async (_event, id: string) => {
    await store.deleteChat(id)
  })

  ipcMain.handle('chat:send', async (event, req: ChatRequest) => {
    const sender = event.sender
    const send = (payload: ChatEvent): void => {
      if (!sender.isDestroyed()) sender.send('chat:event', payload)
    }
    void streamChat(req, {
      onDelta: (delta) => send({ requestId: req.requestId, type: 'delta', delta }),
      onDone: (content) => send({ requestId: req.requestId, type: 'done', content }),
      onError: (error) => send({ requestId: req.requestId, type: 'error', error })
    })
    return { ok: true }
  })

  ipcMain.handle('chat:cancel', async (_event, requestId: string) => {
    cancelChat(requestId)
  })

  ipcMain.handle('agent:compose', async (_event, payload: { chatId: string; title: string; extraInstruction: string }) => {
    return composeDocument(payload.chatId, payload.title, payload.extraInstruction)
  })

  ipcMain.handle(
    'documents:export',
    async (_event, payload: { title: string; markdown: string; format: 'docx' | 'md' }) => {
      return exportMarkdown(payload.markdown, payload.title, payload.format)
    }
  )

  ipcMain.handle('translate:start', () => {
    return startCapture()
  })

  ipcMain.handle('capture:selection', async (_event, rect: { x: number; y: number; width: number; height: number }) => {
    await captureSelection(rect)
  })

  ipcMain.handle('capture:cancel', () => {
    cancelCapture()
  })

  ipcMain.handle('translate:delete', async (_event, id: string) => {
    await store.deleteTranslation(id)
  })

  ipcMain.handle('translate:list', () => {
    return store.data.translations
  })

  ipcMain.handle(
    'translate:render-response',
    (_event, payload: { requestId: string; dataUrl: string | null }) => {
      resolveRenderResponse(payload.requestId, payload.dataUrl)
    }
  )

  ipcMain.handle(
    'translate:export-image',
    async (_event, payload: { id: string; variant: 'original' | 'translated' }) => {
      const record = store.data.translations.find((item) => item.id === payload.id)
      if (!record) throw new Error('翻译记录不存在')
      const file = payload.variant === 'translated' ? record.translatedImageFile : record.imageFile
      if (!file) throw new Error('该记录没有可导出的图片')
      const result = await dialog.showSaveDialog({
        title: '保存翻译截图',
        defaultPath: path.join(app.getPath('pictures'), `截图翻译-${record.id.slice(0, 8)}.png`),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      await fs.copyFile(path.join(store.translationsDir, file), result.filePath)
      return { canceled: false, filePath: result.filePath }
    }
  )

  ipcMain.handle('settings:save', async (_event, patch: Record<string, unknown>) => {
    const clean = { ...patch }
    if (typeof clean.temperature === 'number') {
      clean.temperature = Math.min(2, Math.max(0, clean.temperature))
    }
    if (typeof clean.maxContextChars === 'number') {
      clean.maxContextChars = Math.min(200000, Math.max(4000, Math.round(clean.maxContextChars)))
    }
    return store.updateSettings(clean as never)
  })

  ipcMain.handle('settings:test', async () => {
    return testConnection()
  })

  ipcMain.handle('settings:open-data-dir', async () => {
    await shell.openPath(store.root)
  })

  ipcMain.handle('settings:info', () => {
    return {
      version: app.getVersion(),
      dataDir: store.root,
      shortcut: 'Ctrl + Shift + T'
    }
  })

  ipcMain.handle('app:show-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
