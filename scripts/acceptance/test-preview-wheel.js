const preview = document.querySelector('.inbox-editor-preview')
const inner = preview?.querySelector(':scope > div')
function zoomValue() {
  return inner?.style.zoom ?? null
}
for (let i = 0; i < 5; i += 1) {
  preview?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }))
  await new Promise((resolve) => setTimeout(resolve, 120))
}
const afterZoom = {
  zoom: zoomValue(),
  scrollWidth: preview?.scrollWidth ?? null,
  clientWidth: preview?.clientWidth ?? null,
  scrollHeight: preview?.scrollHeight ?? null,
  clientHeight: preview?.clientHeight ?? null
}
preview.scrollLeft = 0
preview.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, shiftKey: true, bubbles: true, cancelable: true }))
await new Promise((resolve) => setTimeout(resolve, 200))
const afterShift = { scrollLeft: preview.scrollLeft }
preview.scrollTop = 0
preview.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }))
await new Promise((resolve) => setTimeout(resolve, 200))
const afterWheel = { scrollTop: preview.scrollTop }

const textarea = document.querySelector('.inbox-editor-grid textarea')
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, textarea.value + '\n\n未保存测试')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const closeButton = Array.from(document.querySelectorAll('.inbox-editor-modal .icon-btn')).find((button) => button.title === '关闭')
closeButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const toastStack = document.querySelector('.toast-stack')
const backdrop = document.querySelector('.modal-backdrop')
return {
  afterZoom,
  afterShift,
  afterWheel,
  modalStillOpen: Boolean(document.querySelector('.inbox-editor-modal')),
  toastText: toastStack?.innerText ?? null,
  toastZ: toastStack ? getComputedStyle(toastStack).zIndex : null,
  backdropZ: backdrop ? getComputedStyle(backdrop).zIndex : null
}
