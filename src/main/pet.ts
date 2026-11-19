import { BrowserWindow, Menu, app, ipcMain, powerMonitor } from 'electron'
import { store } from './store'
import { t } from '../shared/i18n'
import {
  PET_STATE_LABEL,
  type PetSettings,
  type PetSignal,
  type PetSnapshot,
  type PetState,
  type PetView
} from '../shared/pet'
import type { PetSkillId } from '../shared/petPlay'
import {
  closePetWindow,
  getPetWindow,
  initPetWindow,
  openPetWindow,
  petWindowBounds,
  registerPetWindowIpc,
  resetPetWindowPosition,
  sendToPet
} from './petWindow'
import { openAliChatWindow } from './aliChatWindow'
import { openBlindBoxWindow } from './blindBoxWindow'

const MIN_DWELL = 2800
let getMainWindow: () => BrowserWindow | null = () => null
let preloadPath = ''
let enabled = true
let bubbles = true
let quietUntil = 0
let theme = 'light'
let view: PetView = 'library'
let state: PetState = 'active'
let since = Date.now()
let lastInput = Date.now()
let lastFocus = Date.now()
let lastScroll = 0
let keys: number[] = []
let appFocused = true
let locked = false
let accountLocked = true
let happyUntil = 0
const skillCooldowns: Record<PetSkillId, number> = {
  zoomies: 0,
  fetch: 0,
  dash: 0
}
const envState = process.env['ARBOR_PET_FORCE'] as PetState | undefined
let forced: PetState | null = envState && envState in PET_STATE_LABEL ? envState : null
const busyKeys = new Set<string>()
let ticker: NodeJS.Timeout | null = null

function config() {
  return {
    enabled: enabled && !accountLocked,
    bubbles,
    quietUntil,
    language: store.data.settings.language
  }
}

function snapshot(): PetSnapshot {
  return { state, since, label: PET_STATE_LABEL[state], view }
}

function sendConfig(): void {
  sendToPet('pet:config', config())
}

function broadcastState(): void {
  const data = snapshot()
  sendToPet('pet:state', data)
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('pet:state', data)
}

function focusMain(): void {
  const main = getMainWindow()
  if (!main || main.isDestroyed()) return
  if (main.isMinimized()) main.restore()
  main.show()
  main.focus()
}

function openSettings(): void {
  focusMain()
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('pet:open-settings')
}

function openAli(): void {
  if (accountLocked) return
  focusMain()
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('pet:open-ali')
}

function openAliChat(): void {
  if (accountLocked || !preloadPath) return
  openAliChatWindow(preloadPath, petWindowBounds() ?? undefined)
}

function persistEnabled(next: boolean): void {
  enabled = next
  void store.updateSettings({ petEnabled: next })
  if (next) {
    if (preloadPath && !accountLocked) openPetWindow(preloadPath)
    sendConfig()
  } else {
    closePetWindow()
  }
  const main = getMainWindow()
  if (main && !main.isDestroyed()) main.webContents.send('pet:settings-changed', { enabled, bubbles })
}

function resetPosition(): void {
  resetPetWindowPosition()
}

function runSkill(skill: PetSkillId, cooldownMs: number): void {
  const now = Date.now()
  if (skillCooldowns[skill] > now) return
  skillCooldowns[skill] = now + cooldownMs
  sendToPet('pet:skill', skill)
}

function skillMenuItem(skill: PetSkillId, label: string, cooldownMs: number) {
  const remaining = Math.max(0, skillCooldowns[skill] - Date.now())
  return {
    label: remaining > 0 ? `${t(label)} · ${Math.ceil(remaining / 1000)}s` : t(label),
    enabled: remaining === 0,
    click: () => runSkill(skill, cooldownMs)
  }
}

function showMenu(): void {
  if (accountLocked) return
  const win = getPetWindow()
  const menu = Menu.buildFromTemplate([
    {
      label: bubbles ? t('关闭气泡') : t('开启气泡'),
      click: () => {
        bubbles = !bubbles
        void store.updateSettings({ petBubbles: bubbles })
        const main = getMainWindow()
        if (main && !main.isDestroyed()) {
          main.webContents.send('pet:settings-changed', { enabled, bubbles })
        }
        sendConfig()
      }
    },
    {
      label: t('安静 30 分钟'),
      click: () => {
        quietUntil = Date.now() + 30 * 60 * 1000
        sendConfig()
      }
    },
    { type: 'separator' },
    { label: t('摸一会儿鱼'), click: () => openBlindBoxWindow(preloadPath, petWindowBounds() ?? undefined) },
    {
      label: t('陪阿栗玩'),
      submenu: [
        skillMenuItem('zoomies', '撒欢跑', 120000),
        skillMenuItem('fetch', '叼球', 0),
        skillMenuItem('dash', '冲刺', 15000)
      ]
    },
    { label: t('重置位置'), click: resetPosition },
    { label: t('打开 Arbor'), click: focusMain },
    { label: t('和阿栗聊天'), click: openAliChat },
    { label: t('宠物设置'), click: openSettings },
    { type: 'separator' },
    { label: t('隐藏阿栗'), click: () => persistEnabled(false) }
  ])
  menu.popup({ window: win ?? undefined })
}

function applySettings(next: Partial<PetSettings>): void {
  if (typeof next.enabled === 'boolean' && next.enabled !== enabled) {
    enabled = next.enabled
    if (enabled) {
      if (preloadPath && !accountLocked) openPetWindow(preloadPath)
      sendConfig()
    } else {
      closePetWindow()
    }
  }
  if (typeof next.bubbles === 'boolean') bubbles = next.bubbles
  sendConfig()
}

function pushSignal(signal: PetSignal): void {
  const now = Date.now()
  if (!signal || typeof signal !== 'object') return
  switch (signal.type) {
    case 'keys':
      lastInput = now
      keys.push(now)
      if (signal.keys > 1) keys.push(now)
      break
    case 'pointer':
      if (signal.moved > 30) lastInput = now
      break
    case 'scroll':
      lastInput = now
      lastScroll = now
      break
    case 'context':
      view = signal.view
      if (signal.view === 'reader') lastScroll = now
      break
    case 'celebrate':
      happyUntil = now + 4000
      break
  }
}

export function setPetBusy(key: string, busy: boolean): void {
  if (busy) busyKeys.add(key)
  else busyKeys.delete(key)
}

export function celebratePet(): void {
  happyUntil = Date.now() + 4000
}

export function setPetTheme(next: string): void {
  theme = next
  sendToPet('pet:theme', theme)
}

export function setPetAccountLocked(value: boolean): void {
  if (accountLocked === value) return
  accountLocked = value
  if (value) {
    closePetWindow()
  } else if (enabled && preloadPath) {
    openPetWindow(preloadPath)
  }
  sendConfig()
  const main = getMainWindow()
  if (main && !main.isDestroyed()) {
    main.webContents.send('pet:settings-changed', {
      enabled: enabled && !accountLocked,
      bubbles
    })
  }
}

function evaluate(): void {
  const now = Date.now()
  keys = keys.filter((time) => now - time < 5000)
  appFocused = BrowserWindow.getAllWindows().some((win) => {
    const pet = getPetWindow()
    return win !== pet && !win.isDestroyed() && win.isFocused()
  })
  if (appFocused) lastFocus = now
  let idleSeconds = 0
  try {
    idleSeconds = powerMonitor.getSystemIdleTime()
  } catch {
    idleSeconds = 0
  }
  const typing = keys.filter((time) => now - time < 2000).length >= 3
  const reading = view === 'reader' && now - lastScroll < 120000
  const busy = busyKeys.size > 0
  const idle = now - lastInput
  let next: PetState
  if (busy) next = 'busy'
  else if (now < happyUntil) next = 'happy'
  else if (locked || idleSeconds >= 600 || (!appFocused && now - lastFocus > 600000)) next = 'away'
  else if (typing) next = 'typing'
  else if (reading && appFocused) next = 'reading'
  else if (idle < 4500) next = 'active'
  else if (!appFocused) next = now - lastFocus > 120000 ? 'idle' : 'active'
  else if (idle < 180000) next = 'thinking'
  else next = 'idle'
  if (forced) next = forced
  if (next !== state) {
    const instant = next === 'typing' || next === 'busy' || next === 'away' || next === 'happy'
    if (instant || now - since >= MIN_DWELL) {
      state = next
      since = now
      broadcastState()
    }
  }
}

export function initPet(preload: string, getter: () => BrowserWindow | null): void {
  preloadPath = preload
  getMainWindow = getter
  initPetWindow(app.getPath('userData'))
  registerPetWindowIpc()
  enabled = store.data.settings.petEnabled !== false
  bubbles = store.data.settings.petBubbles !== false

  ipcMain.on('pet:signal', (_event, signal: PetSignal) => pushSignal(signal))
  ipcMain.handle('pet:get-state', () => snapshot())
  ipcMain.handle('pet:get-config', () => config())
  ipcMain.handle('pet:set-enabled', (_event, value: boolean) => {
    if (accountLocked && value) return config()
    persistEnabled(!!value)
    return config()
  })
  ipcMain.on('pet:theme', (_event, value: string) => setPetTheme(String(value || 'light')))
  ipcMain.on('pet:celebrate', () => celebratePet())
  ipcMain.on('pet:menu', () => showMenu())
  ipcMain.on('pet:open-main', () => focusMain())
  ipcMain.on('pet:open-settings', () => openSettings())
  ipcMain.on('pet:open-ali', () => openAli())
  ipcMain.on('pet:open-ali-chat', () => openAliChat())
  ipcMain.on('pet:apply-settings', (_event, value: Partial<PetSettings>) => applySettings(value))
  if (process.env['ARBOR_PET_DEBUG'] === '1') {
    ipcMain.on('pet:debug-force', (_event, value: PetState | null) => {
      forced = value === null || (typeof value === 'string' && value in PET_STATE_LABEL) ? value : forced
    })
  }

  powerMonitor.on('lock-screen', () => {
    locked = true
  })
  powerMonitor.on('unlock-screen', () => {
    locked = false
    lastInput = Date.now()
    lastFocus = Date.now()
  })
  powerMonitor.on('suspend', () => {
    locked = true
  })
  powerMonitor.on('resume', () => {
    locked = false
    lastInput = Date.now()
  })

  if (enabled && !accountLocked) openPetWindow(preload)
  broadcastState()
  ticker = setInterval(evaluate, 1000)
  app.on('will-quit', () => {
    if (ticker) clearInterval(ticker)
    ticker = null
  })
}

export function applyPetSettings(patch: Partial<PetSettings>): void {
  applySettings(patch)
}
