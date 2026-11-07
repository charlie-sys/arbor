Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('Inbox'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
document.querySelector('.inbox-item')?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
const modal = document.querySelector('.inbox-editor-modal')
const attachments = Array.from(document.querySelectorAll('.inbox-attachment')).map((el) => ({
  text: el.innerText.trim(),
  src: el.querySelector('img')?.getAttribute('src') ?? null
}))
const insertImageButton = Array.from(document.querySelectorAll('.inbox-editor-toolbar button')).find((button) =>
  button.innerText.includes('插入图片')
)
insertImageButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const picker = document.querySelector('.attachment-picker-modal')
const pickItems = Array.from(document.querySelectorAll('.attachment-pick-item'))
pickItems[0]?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const textarea = document.querySelector('.inbox-editor-grid textarea')
const contentHasPath = textarea?.value.includes('zotfile://attachments/') ?? false
const pickerClosed = !document.querySelector('.attachment-picker-modal')
const previewImage = document.querySelector('.inbox-editor-preview img')

const fullscreenButton = Array.from(modal?.querySelectorAll('button') ?? []).find((button) => button.title === '全屏编辑')
fullscreenButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const fullscreen = document.querySelector('.inbox-editor-modal')?.classList.contains('fullscreen')

const zoomInButton = Array.from(modal?.querySelectorAll('button') ?? []).find((button) => button.title === '放大预览')
zoomInButton?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const zoom = document.querySelector('.inbox-editor-preview > div')?.style.zoom ?? null

const divider = document.querySelector('.inbox-editor-divider')
const grid = document.querySelector('.inbox-editor-grid')
if (divider && grid) {
  const rect = grid.getBoundingClientRect()
  const x = rect.left + rect.width * 0.5
  const y = rect.top + 20
  divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }))
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * 0.65, clientY: y, pointerId: 1 }))
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + rect.width * 0.65, clientY: y, pointerId: 1 }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const split = grid?.style.getPropertyValue('--editor-split') ?? null

return {
  modal: Boolean(modal),
  attachmentCount: attachments.length,
  attachments,
  pickerShown: Boolean(picker),
  pickItems: pickItems.length,
  contentHasPath,
  pickerClosed,
  previewImageLoaded: Boolean(previewImage && previewImage.complete && previewImage.naturalWidth > 0),
  fullscreen,
  zoom,
  split
}
