const close = Array.from(document.querySelectorAll('.inbox-editor-modal .icon-btn')).find((button) => button.title === '关闭')
close?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
document.querySelector('.inbox-item')?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
function measure() {
  const grid = document.querySelector('.inbox-editor-grid')
  const rect = grid?.getBoundingClientRect()
  return {
    gridWidth: rect ? Math.round(rect.width) : null,
    split: grid?.style.getPropertyValue('--editor-split') ?? null,
    fullscreen: document.querySelector('.inbox-editor-modal')?.classList.contains('fullscreen') ?? null
  }
}
const normal = measure()
const fullscreenButton = Array.from(document.querySelectorAll('.inbox-editor-modal button')).find((button) => button.title === '全屏编辑')
fullscreenButton?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const fullscreen = measure()
return { normal, fullscreen }
