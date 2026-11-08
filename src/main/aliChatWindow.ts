import { app, BrowserWindow, screen } from 'electron'
import fs from 'fs'
import path from 'path'

const MIN_WIDTH = 360
const MIN_HEIGHT = 460
let win: BrowserWindow | null = null
let preloadPath = ''
let saveTimer: NodeJS.Timeout | null = null

interface ChatSize {
  width: number
  height: number
}

type Anchor = { x: number; y: number; width: number; height: number }

function sizeFile(): string {
  return path.join(app.getPath('userData'), 'ali-chat-window.json')
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max))
}

function displayFor(anchor?: Anchor) {
  return anchor
    ? screen.getDisplayNearestPoint({ x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 })
    : screen.getPrimaryDisplay()
}

function defaultSize(area: Electron.Rectangle): ChatSize {
  const width = Math.min(area.width - 24, clamp(area.width * 0.34, 400, 560))
  const height = Math.min(area.height - 24, clamp(area.height * 0.86, 500, 820))
  return {
    width: Math.max(MIN_WIDTH, width),
    height: Math.max(MIN_HEIGHT, height)
  }
}

function loadSize(area: Electron.Rectangle): ChatSize {
  try {
    const parsed = JSON.parse(fs.readFileSync(sizeFile(), 'utf8')) as Partial<ChatSize>
    if (Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) {
      return {
        width: clamp(parsed.width as number, MIN_WIDTH, Math.max(MIN_WIDTH, area.width - 24)),
        height: clamp(parsed.height as number, MIN_HEIGHT, Math.max(MIN_HEIGHT, area.height - 24))
      }
    }
  } catch {
    /* first run */
  }
  return defaultSize(area)
}

function positionFor(anchor: Anchor | undefined, size: ChatSize, area: Electron.Rectangle) {
  const x = anchor ? anchor.x - size.width - 14 : area.x + area.width - size.width - 24
  const y = anchor ? anchor.y + anchor.height - size.height : area.y + area.height - size.height - 24
  return {
    x: clamp(x, area.x + 8, Math.max(area.x + 8, area.x + area.width - size.width - 8)),
    y: clamp(y, area.y + 8, Math.max(area.y + 8, area.y + area.height - size.height - 8))
  }
}

function persistSize(window: BrowserWindow): void {
  if (!window || window.isDestroyed()) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!window || window.isDestroyed()) return
    const bounds = window.getBounds()
    try {
      fs.writeFileSync(sizeFile(), JSON.stringify({ width: bounds.width, height: bounds.height }))
    } catch {
      /* ignore persistence failure */
    }
  }, 350)
}

function chatUrl(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return devUrl ? `${devUrl.replace(/\/$/, '')}/ali-chat.html` : 'zotapp://bundle/ali-chat.html'
}

export function openAliChatWindow(inputPreload: string, anchor?: Anchor): BrowserWindow {
  preloadPath = inputPreload
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }
  const display = displayFor(anchor)
  const area = display.workArea
  const size = loadSize(area)
  const position = positionFor(anchor, size, area)
  const created = new BrowserWindow({
    ...size,
    ...position,
    minWidth: Math.min(MIN_WIDTH, size.width),
    minHeight: Math.min(MIN_HEIGHT, size.height),
    title: '阿栗 — Arbor',
    backgroundColor: '#f3f5f9',
    autoHideMenuBar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win = created
  created.setAlwaysOnTop(true, 'floating')
  created.once('ready-to-show', () => created.show())
  created.on('resize', () => persistSize(created))
  created.on('close', () => persistSize(created))
  created.on('closed', () => {
    if (win === created) win = null
  })
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void import('electron').then(({ shell }) => shell.openExternal(url))
    return { action: 'deny' }
  })
  void created.loadURL(chatUrl())
  return created
}

export function closeAliChatWindow(): void {
  if (!win || win.isDestroyed()) return
  win.close()
  win = null
}
