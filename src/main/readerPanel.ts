import { BrowserWindow, ipcMain, screen, shell } from 'electron'
import path from 'path'
import type {
  ReaderPanelOutlineState,
  ReaderPanelQuote,
  ReaderPanelState,
  ReaderPanelTab
} from '../shared/api'

let panelWindow: BrowserWindow | null = null
let panelDocId: string | null = null
let panelTab: ReaderPanelTab = 'agent'
let panelChatId: string | null = null
let panelPinned = false
let panelDirty = false
let forceClose = false
let getMainWindow: () => BrowserWindow | null = () => null

export function initReaderPanel(getter: () => BrowserWindow | null): void {
  getMainWindow = getter
}

function panelState(): ReaderPanelState {
  return {
    open: !!panelWindow && !panelWindow.isDestroyed(),
    docId: panelDocId,
    tab: panelTab,
    activeChatId: panelChatId,
    pinned: panelPinned
  }
}

function panelUrl(docId: string, tab: ReaderPanelTab): string {
  const query = `panel=1&docId=${encodeURIComponent(docId)}&tab=${tab}`
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return `${devUrl.replace(/\/$/, '')}/index.html?${query}`
  return `zotapp://bundle/index.html?${query}`
}

function focusPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return
  if (panelWindow.isMinimized()) panelWindow.restore()
  panelWindow.show()
  panelWindow.focus()
}

function sendToPanel(channel: string, payload: unknown): void {
  if (!panelWindow || panelWindow.isDestroyed()) return
  panelWindow.webContents.send(channel, payload)
}

function sendToMain(channel: string, payload: unknown): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export function openReaderPanel(
  docId: string,
  tab: ReaderPanelTab,
  activeChatId: string | null
): ReaderPanelState {
  if (panelWindow && !panelWindow.isDestroyed()) {
    if (panelDocId === docId) {
      panelTab = tab
      panelChatId = activeChatId
      focusPanel()
      sendToPanel('reader-panel:refresh', null)
      return panelState()
    }
    const stale = panelWindow
    stale.removeAllListeners('close')
    stale.removeAllListeners('closed')
    panelWindow = null
    panelDocId = null
    panelDirty = false
    stale.destroy()
  }

  const main = getMainWindow()
  const anchor = main && !main.isDestroyed() ? main.getBounds() : screen.getPrimaryDisplay().workArea
  const workArea = screen.getDisplayMatching(anchor).workArea
  const width = Math.max(420, Math.min(720, Math.round(anchor.width * 0.35)))
  const height = Math.max(480, Math.min(880, Math.round(anchor.height * 0.82)))
  const x = Math.max(
    workArea.x + 16,
    Math.min(workArea.x + workArea.width - width - 16, anchor.x + anchor.width - width - 32)
  )
  const y = Math.max(
    workArea.y + 16,
    Math.min(workArea.y + workArea.height - height - 16, anchor.y + 64)
  )

  panelDocId = docId
  panelTab = tab
  panelChatId = activeChatId
  panelDirty = false

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 320,
    minHeight: 360,
    title: '阅读面板 — Arbor',
    backgroundColor: '#faf6f1',
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: panelPinned,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  panelWindow = win

  win.once('ready-to-show', () => {
    win.show()
    if (panelPinned) win.setAlwaysOnTop(true, 'floating')
  })
  win.on('close', (event) => {
    if (!forceClose && panelDirty) {
      event.preventDefault()
      win.webContents.send('reader-panel:block-close')
    }
  })
  win.on('closed', () => {
    const closedDocId = panelDocId
    const closedTab = panelTab
    const closedChatId = panelChatId
    panelWindow = null
    panelDocId = null
    panelDirty = false
    forceClose = false
    if (closedDocId) {
      sendToMain('reader-panel:closed', { docId: closedDocId, tab: closedTab, activeChatId: closedChatId })
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  void win.loadURL(panelUrl(docId, tab))
  return panelState()
}

export function closeReaderPanel(force = false): { ok: boolean } {
  if (!panelWindow || panelWindow.isDestroyed()) return { ok: true }
  if (!force && panelDirty) {
    sendToPanel('reader-panel:block-close', null)
    return { ok: false }
  }
  forceClose = true
  panelWindow.close()
  return { ok: true }
}

export function registerReaderPanelIpc(): void {
  ipcMain.handle('reader-panel:open', (_event, payload: { docId: string; tab: ReaderPanelTab; activeChatId: string | null }) => {
    return openReaderPanel(payload.docId, payload.tab, payload.activeChatId)
  })

  ipcMain.handle('reader-panel:close', () => closeReaderPanel())

  ipcMain.handle('reader-panel:state', () => panelState())

  ipcMain.handle('reader-panel:set-pinned', (_event, pinned: boolean) => {
    panelPinned = pinned
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.setAlwaysOnTop(pinned, pinned ? 'floating' : 'normal')
      panelWindow.webContents.send('reader-panel:pinned', pinned)
    }
  })

  ipcMain.on('reader-panel:set-dirty', (_event, dirty: boolean) => {
    panelDirty = !!dirty
  })

  ipcMain.on('reader-panel:set-tab', (_event, payload: { tab: ReaderPanelTab; activeChatId: string | null }) => {
    panelTab = payload.tab
    panelChatId = payload.activeChatId
  })

  ipcMain.on('reader-panel:notify-changed', () => {
    sendToMain('reader-panel:data-changed', null)
  })

  ipcMain.on('reader-panel:refresh', () => {
    sendToPanel('reader-panel:refresh', null)
  })

  ipcMain.handle('reader-panel:quote', (_event, payload: { docId: string; text: string; page?: number }) => {
    if (!panelWindow || panelWindow.isDestroyed() || panelDocId !== payload.docId) return
    const quote: ReaderPanelQuote = { text: payload.text, page: payload.page, nonce: Date.now() }
    focusPanel()
    sendToPanel('reader-panel:quote-event', quote)
  })

  ipcMain.on('reader-panel:open-doc', (_event, payload: { docId: string; page?: number }) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    sendToMain('reader-panel:open-doc-event', payload)
  })

  ipcMain.on('reader-panel:ready', (_event, docId: string) => {
    if (panelDocId !== docId) return
    sendToMain('reader-panel:ready-event', { docId })
  })

  ipcMain.on('reader-panel:send-page', (_event, payload: { docId: string; page: number }) => {
    if (panelDocId !== payload.docId) return
    sendToPanel('reader-panel:page', payload)
  })

  ipcMain.on('reader-panel:send-outline', (_event, payload: { docId: string } & ReaderPanelOutlineState) => {
    if (panelDocId !== payload.docId) return
    sendToPanel('reader-panel:outline', payload)
  })
}
