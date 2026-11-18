import { BrowserWindow, ipcMain, screen } from 'electron'
import { t } from '../shared/i18n'
import type { PetWindowBounds } from '../shared/pet'

const WIDTH = 420
const HEIGHT = 560
let win: BrowserWindow | null = null
let preloadPath = ''

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max))
}

function boundsFor(anchor?: PetWindowBounds): Electron.Rectangle {
  const display = anchor
    ? screen.getDisplayNearestPoint({ x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 })
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const preferredX = anchor ? anchor.x - WIDTH - 14 : area.x + area.width - WIDTH - 24
  const preferredY = anchor ? anchor.y + anchor.height - HEIGHT : area.y + area.height - HEIGHT - 24

  return {
    x: clamp(preferredX, area.x + 8, Math.max(area.x + 8, area.x + area.width - WIDTH - 8)),
    y: clamp(preferredY, area.y + 8, Math.max(area.y + 8, area.y + area.height - HEIGHT - 8)),
    width: WIDTH,
    height: HEIGHT
  }
}

function blindBoxUrl(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return devUrl ? `${devUrl.replace(/\/$/, '')}/blind-box.html` : 'zotapp://bundle/blind-box.html'
}

export function openBlindBoxWindow(inputPreload = preloadPath, anchor?: PetWindowBounds): BrowserWindow | null {
  preloadPath = inputPreload || preloadPath
  if (!preloadPath) return null
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }

  const created = new BrowserWindow({
    ...boundsFor(anchor),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    show: false,
    title: t('摸鱼盲盒'),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win = created
  created.setAlwaysOnTop(true, 'floating')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  created.once('ready-to-show', () => {
    created.show()
    created.focus()
  })
  created.on('closed', () => {
    if (win === created) win = null
  })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void created.loadURL(blindBoxUrl())
  return created
}

export function registerBlindBoxWindowIpc(inputPreload: string): void {
  preloadPath = inputPreload
  ipcMain.handle('blind-box:open', () => {
    openBlindBoxWindow()
  })
}
