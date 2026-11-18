const FONT_KEY = 'arbor-ui-font-size'

export function applyUiFontSize(value: number): void {
  const size = Number.isInteger(value) && value >= 12 && value <= 20 ? value : 14
  document.documentElement.style.setProperty('--ui-font-scale', String(size / 14))
  document.documentElement.dataset.uiFontSize = String(size)
  try { localStorage.setItem(FONT_KEY, String(size)) } catch { /* Optional startup cache. */ }
}

export function installUiFontSize(): void {
  try { applyUiFontSize(Number(localStorage.getItem(FONT_KEY)) || 14) } catch { applyUiFontSize(14) }
  void window.api.library.getState().then(data => applyUiFontSize(data.settings.uiFontSize)).catch(() => undefined)
  window.api.events.onSettingsChanged(settings => applyUiFontSize(settings.uiFontSize))
}
