import { app, BrowserWindow, globalShortcut, net, protocol, screen, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { store } from './store'
import { flushAnnotations } from './annotationStore'
import { usage } from './usage'
import { registerIpc } from './ipc'
import { closeReaderPanel, initReaderPanel, registerReaderPanelIpc } from './readerPanel'
import { initCapture, startCapture } from './capture'
import { startMcpServer } from './mcp'
import { startBackupScheduler } from './backup'
import { initPet } from './pet'
import { aliStore } from './ali/store'
import { aliMemory } from './ali/memory'
import { setLocale, t } from '../shared/i18n'

const APP_NAME = 'Arbor'
app.setName(APP_NAME)

if (process.env.ARBOR_REMOTE_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
}

const userDataOverride = process.env.ARBOR_USER_DATA_DIR?.trim()
if (userDataOverride) {
  app.setPath('userData', path.resolve(userDataOverride))
} else {
  const appDataDir = app.getPath('appData')
  const legacyUserData = path.join(appDataDir, 'ZotAgent')
  const targetUserData = path.join(appDataDir, APP_NAME)
  if (!fs.existsSync(targetUserData) && fs.existsSync(legacyUserData)) {
    try {
      fs.renameSync(legacyUserData, targetUserData)
    } catch {
      /* fall back to the legacy folder when another instance holds a file lock */
    }
  }
  app.setPath(
    'userData',
    fs.existsSync(targetUserData) || !fs.existsSync(legacyUserData) ? targetUserData : legacyUserData
  )
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'zotfile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  },
  {
    scheme: 'zotapp',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.bcmap': 'application/octet-stream'
}

let mainWindow: BrowserWindow | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createMainWindow(): void {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1440, workArea.width, Math.max(720, Math.round(workArea.width * 0.92)))
  const height = Math.min(920, workArea.height, Math.max(520, Math.round(workArea.height * 0.92)))

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1080, width),
    minHeight: Math.min(680, height),
    title: t('Arbor — 文献阅读与 AI 研究工坊'),
    backgroundColor: '#f3f5f9',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.center()
  mainWindow.maximize()

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    closeReaderPanel(true)
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadURL('zotapp://bundle/index.html')
  }
}

async function serveFile(filePath: string): Promise<Response> {
  const res = await net.fetch(pathToFileURL(filePath).toString())
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()]
  if (!type) return res
  const headers = new Headers(res.headers)
  headers.set('content-type', type)
  return new Response(res.body, { status: res.status, headers })
}

function registerProtocols(): void {
  const rendererRoot = path.join(__dirname, '../renderer')
  protocol.handle('zotapp', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'bundle') return new Response('Not found', { status: 404 })
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (!rel || rel.includes('..')) return new Response('Forbidden', { status: 403 })
      const filePath = path.normalize(path.join(rendererRoot, rel))
      if (!filePath.startsWith(rendererRoot + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      return await serveFile(filePath)
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })

  protocol.handle('zotfile', async (request) => {
    try {
      const url = new URL(request.url)
      const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (url.host === 'attachments') {
        const parts = name.split('/')
        const inboxId = parts.shift() ?? ''
        if (!/^[0-9a-f-]{36}$/i.test(inboxId) || !parts.length) {
          return new Response('Forbidden', { status: 403 })
        }
        const base = path.join(store.attachmentsDir, inboxId)
        const filePath = path.normalize(path.join(base, ...parts))
        if (!filePath.startsWith(base + path.sep)) {
          return new Response('Forbidden', { status: 403 })
        }
        return await serveFile(filePath)
      }
      if (!/^[0-9a-f-]{36}(?:-translated)?\.(?:pdf|png|docx|doc|txt|md|markdown)$/i.test(name)) {
        return new Response('Forbidden', { status: 403 })
      }
      let base = ''
      if (url.host === 'files') base = store.filesDir
      else if (url.host === 'translations') base = store.translationsDir
      else return new Response('Not found', { status: 404 })
      return await serveFile(path.join(base, name))
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

if (gotLock) {
  app.on('second-instance', () => focusMainWindow())

  app.whenReady().then(async () => {
    await store.init()
    await aliStore.init().catch((error) => console.warn('[ali] init failed', error))
    await aliMemory.init().catch((error) => console.warn('[ali] memory init failed', error))
    setLocale(store.data.settings.language)
    await usage.init(store.root)
    startBackupScheduler()
    void startMcpServer()
    registerProtocols()
    initCapture(() => mainWindow)
    initReaderPanel(() => mainWindow)
    registerIpc()
    registerReaderPanelIpc()
    createMainWindow()
    initPet(path.join(__dirname, '../preload/index.js'), () => mainWindow)

    const registered = globalShortcut.register('CommandOrControl+Shift+T', () => {
      startCapture()
    })
    if (!registered) {
      console.warn('Global shortcut Ctrl+Shift+T registration failed')
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('will-quit', () => {
    closeReaderPanel(true)
    globalShortcut.unregisterAll()
  })

  let annotationsFlushed = false
  app.on('before-quit', (event) => {
    if (annotationsFlushed) return
    event.preventDefault()
    void flushAnnotations()
      .catch(() => undefined)
      .finally(() => {
        annotationsFlushed = true
        app.quit()
      })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
