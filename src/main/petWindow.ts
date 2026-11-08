import { BrowserWindow, ipcMain, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import type { PetWindowBounds } from '../shared/pet'

const WIDTH = 250
const HEIGHT = 310
let win: BrowserWindow | null = null
let boundsFile = ''
let saveTimer: NodeJS.Timeout | null = null

export function initPetWindow(userDataDir: string): void {
  boundsFile = path.join(userDataDir, 'pet-window.json')
}

function defaultBounds(): PetWindowBounds {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - WIDTH - 18,
    y: area.y + area.height - HEIGHT - 28,
    width: WIDTH,
    height: HEIGHT
  }
}

function loadBounds(): PetWindowBounds {
  try {
    const parsed = JSON.parse(fs.readFileSync(boundsFile, 'utf8')) as Partial<PetWindowBounds>
    if ([parsed.x, parsed.y, parsed.width, parsed.height].every((value) => Number.isFinite(value))) {
      return clampBounds({
        x: Math.round(parsed.x as number),
        y: Math.round(parsed.y as number),
        width: WIDTH,
        height: HEIGHT
      })
    }
  } catch {
    /* first run */
  }
  return defaultBounds()
}

function clampBounds(input: PetWindowBounds): PetWindowBounds {
  const display = screen.getDisplayNearestPoint({ x: input.x + 40, y: input.y + 40 })
  const area = display.workArea
  const minVisible = 90
  return {
    x: Math.round(
      Math.min(Math.max(input.x, area.x - WIDTH + minVisible), area.x + area.width - minVisible)
    ),
    y: Math.round(Math.min(Math.max(input.y, area.y), area.y + area.height - minVisible)),
    width: WIDTH,
    height: HEIGHT
  }
}

function persistBounds(): void {
  if (!win || win.isDestroyed() || !boundsFile) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!win || win.isDestroyed()) return
    const bounds = win.getBounds()
    try {
      fs.writeFileSync(boundsFile, JSON.stringify(bounds))
    } catch {
      /* ignore persistence failure */
    }
  }, 350)
}

export function resetPetWindowPosition(): PetWindowBounds {
  const bounds = defaultBounds()
  if (win && !win.isDestroyed()) win.setBounds(bounds)
  persistBounds()
  return bounds
}

export function petWindowBounds(): PetWindowBounds | null {
  if (!win || win.isDestroyed()) return null
  return win.getBounds()
}

function petUrl(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return devUrl ? `${devUrl.replace(/\/$/, '')}/pet.html` : 'zotapp://bundle/pet.html'
}

export function getPetWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function openPetWindow(preload: string): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  const bounds = loadBounds()
  const created = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win = created
  created.setAlwaysOnTop(true, 'floating')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  created.setIgnoreMouseEvents(true, { forward: true })
  created.once('ready-to-show', () => {
    created.showInactive()
    persistBounds()
  })
  created.on('moved', persistBounds)
  created.on('closed', () => {
    if (win === created) win = null
  })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void created.loadURL(petUrl())
  return created
}

export function closePetWindow(): void {
  if (!win || win.isDestroyed()) return
  win.destroy()
  win = null
}

export function sendToPet(channel: string, payload: unknown): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export function registerPetWindowIpc(): void {
  ipcMain.handle('pet:window-bounds', () => petWindowBounds())
  ipcMain.on('pet:window-move', (_event, payload: { x: number; y: number }) => {
    if (!win || win.isDestroyed()) return
    if (!Number.isFinite(payload?.x) || !Number.isFinite(payload?.y)) return
    const next = clampBounds({
      x: Math.round(payload.x),
      y: Math.round(payload.y),
      width: WIDTH,
      height: HEIGHT
    })
    win.setBounds(next)
  })
  ipcMain.on('pet:mouse-ignore', (_event, ignore: boolean) => {
    if (!win || win.isDestroyed()) return
    win.setIgnoreMouseEvents(!!ignore, { forward: true })
  })
  ipcMain.handle('pet:window-reset', () => resetPetWindowPosition())
}
