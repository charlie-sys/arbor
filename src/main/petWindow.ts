import { BrowserWindow, ipcMain, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import type { PetWindowBounds } from '../shared/pet'
import {
  PET_ACTOR_HEIGHT,
  PET_ACTOR_WIDTH,
  type PetStageState
} from '../shared/petPlay'
import { writeJsonAtomic } from './ali/atomic'

interface StoredStage {
  version: 2
  displayId?: number
  xRatio: number
  yRatio: number
}

let win: BrowserWindow | null = null
let stageFile = ''
let legacyBoundsFile = ''
let stored: StoredStage = { version: 2, xRatio: 1, yRatio: 1 }
let displayId = 0
let saveTimer: NodeJS.Timeout | null = null

function currentDisplay(): Electron.Display {
  const saved = screen.getAllDisplays().find((display) => display.id === displayId)
  if (saved) return saved
  const primary = screen.getPrimaryDisplay()
  displayId = primary.id
  return primary
}

function clampRatio(value: unknown): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value as number)) : 1
}

function normalizeStored(value: Partial<StoredStage>): StoredStage {
  const displays = screen.getAllDisplays()
  const savedDisplay =
    typeof value.displayId === 'number'
      ? displays.find((display) => display.id === value.displayId)
      : undefined
  displayId = savedDisplay?.id ?? screen.getPrimaryDisplay().id
  return {
    version: 2,
    displayId,
    xRatio: clampRatio(value.xRatio),
    yRatio: clampRatio(value.yRatio)
  }
}

function migrateLegacyBounds(): StoredStage | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyBoundsFile, 'utf8')) as Partial<PetWindowBounds>
    if (![parsed.x, parsed.y, parsed.width, parsed.height].every((value) => Number.isFinite(value))) return null
    const display = screen.getDisplayNearestPoint({
      x: (parsed.x as number) + (parsed.width as number) / 2,
      y: (parsed.y as number) + (parsed.height as number) / 2
    })
    const area = display.workArea
    const maxX = Math.max(1, area.width - PET_ACTOR_WIDTH)
    const maxY = Math.max(1, area.height - PET_ACTOR_HEIGHT)
    const x = (parsed.x as number) + ((parsed.width as number) - PET_ACTOR_WIDTH) / 2
    const y = (parsed.y as number) + ((parsed.height as number) - PET_ACTOR_HEIGHT) / 2
    return {
      version: 2,
      displayId: display.id,
      xRatio: clampRatio((x - area.x) / maxX),
      yRatio: clampRatio((y - area.y) / maxY)
    }
  } catch {
    return null
  }
}

function loadStoredStage(): void {
  try {
    stored = normalizeStored(JSON.parse(fs.readFileSync(stageFile, 'utf8')) as Partial<StoredStage>)
    return
  } catch {
    /* Migrate from the old fixed-window position when available. */
  }
  stored = normalizeStored(migrateLegacyBounds() ?? { xRatio: 1, yRatio: 1 })
}

function persistStage(): void {
  if (!stageFile) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void writeJsonAtomic(stageFile, stored).catch(() => undefined)
  }, 250)
}

function stageBounds(display = currentDisplay()): PetWindowBounds {
  const area = display.workArea
  return {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height
  }
}

function actorBounds(): PetWindowBounds | null {
  if (!win || win.isDestroyed()) return null
  const bounds = stageBounds()
  const maxX = Math.max(0, bounds.width - PET_ACTOR_WIDTH)
  const maxY = Math.max(0, bounds.height - PET_ACTOR_HEIGHT)
  return {
    x: Math.round(bounds.x + stored.xRatio * maxX),
    y: Math.round(bounds.y + stored.yRatio * maxY),
    width: PET_ACTOR_WIDTH,
    height: PET_ACTOR_HEIGHT
  }
}

export function petStageState(): PetStageState {
  return {
    bounds: stageBounds(),
    xRatio: stored.xRatio,
    yRatio: stored.yRatio,
    actorWidth: PET_ACTOR_WIDTH,
    actorHeight: PET_ACTOR_HEIGHT
  }
}

function applyStageBounds(): void {
  if (!win || win.isDestroyed()) return
  const next = stageBounds()
  win.setBounds(next)
  win.webContents.send('pet:stage-changed', petStageState())
}

export function initPetWindow(userDataDir: string): void {
  stageFile = path.join(userDataDir, 'pet-stage.json')
  legacyBoundsFile = path.join(userDataDir, 'pet-window.json')
  loadStoredStage()

  const onDisplaysChanged = (): void => {
    const available = screen.getAllDisplays().some((display) => display.id === stored.displayId)
    if (!available) stored = { ...stored, displayId: screen.getPrimaryDisplay().id }
    displayId = stored.displayId ?? screen.getPrimaryDisplay().id
    applyStageBounds()
    persistStage()
  }
  screen.on('display-added', onDisplaysChanged)
  screen.on('display-removed', onDisplaysChanged)
  screen.on('display-metrics-changed', onDisplaysChanged)
}

export function resetPetWindowPosition(): PetStageState {
  stored = {
    version: 2,
    displayId: screen.getPrimaryDisplay().id,
    xRatio: 1,
    yRatio: 1
  }
  displayId = stored.displayId ?? screen.getPrimaryDisplay().id
  applyStageBounds()
  persistStage()
  return petStageState()
}

export function petWindowBounds(): PetWindowBounds | null {
  return actorBounds()
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
  displayId = stored.displayId ?? screen.getPrimaryDisplay().id
  const created = new BrowserWindow({
    ...stageBounds(),
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
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  created.setIgnoreMouseEvents(true, { forward: true })
  created.once('ready-to-show', () => {
    created.showInactive()
  })
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
  ipcMain.handle('pet:window-state', () => petStageState())
  ipcMain.on('pet:actor-position', (_event, payload: { xRatio: number; yRatio: number }) => {
    if (!payload || typeof payload !== 'object') return
    stored = {
      ...stored,
      xRatio: clampRatio(payload.xRatio),
      yRatio: clampRatio(payload.yRatio)
    }
    persistStage()
  })
  ipcMain.on('pet:mouse-ignore', (_event, ignore: boolean) => {
    if (!win || win.isDestroyed()) return
    win.setIgnoreMouseEvents(!!ignore, { forward: true })
  })
  ipcMain.handle('pet:window-reset', () => resetPetWindowPosition())
}
