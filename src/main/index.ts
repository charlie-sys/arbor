import { app, BrowserWindow, globalShortcut, net, protocol, shell } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { store } from './store'
import { registerIpc } from './ipc'
import { initCapture, startCapture } from './capture'

app.setName('ZotAgent')

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
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    title: 'ZotAgent — 文献阅读与 AI 研究助手',
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

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
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
      if (!/^[0-9a-f-]{36}(?:-translated)?\.(?:pdf|png)$/i.test(name)) {
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
    registerProtocols()
    initCapture(() => mainWindow)
    registerIpc()
    createMainWindow()

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
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
