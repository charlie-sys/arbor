const STORAGE_KEY = 'zotagent-chat-font-scale'
export const CHAT_SCALE_MIN = 0.8
export const CHAT_SCALE_MAX = 2

function clampScale(value: number): number {
  return Math.min(CHAT_SCALE_MAX, Math.max(CHAT_SCALE_MIN, Math.round(value * 10) / 10))
}

function readStoredScale(): number {
  const raw = Number(window.localStorage.getItem(STORAGE_KEY))
  return Number.isFinite(raw) && raw > 0 ? clampScale(raw) : 1
}

let currentScale = readStoredScale()

export function getChatScale(): number {
  return currentScale
}

export function applyChatScale(scale: number): number {
  currentScale = clampScale(scale)
  document.documentElement.style.setProperty('--chat-font-scale', String(currentScale))
  window.localStorage.setItem(STORAGE_KEY, String(currentScale))
  return currentScale
}

document.documentElement.style.setProperty('--chat-font-scale', String(currentScale))
