async function openDrawer() {
  const edge = document.querySelector('.sidebar-edge')
  edge?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  edge?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 450))
}
await openDrawer()
Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('研究主题'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
Array.from(document.querySelectorAll('.doc-card')).find((el) => el.innerText.includes('摘录编辑测试主题'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
const item = document.querySelector('.excerpt-item.clickable')
item?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
const modal = document.querySelector('.inbox-editor-modal')
const titleInput = modal?.querySelector('.inbox-editor-title')
const textarea = modal?.querySelector('.inbox-editor-grid textarea')
const preview = modal?.querySelector('.inbox-editor-preview')
const opened = {
  modal: Boolean(modal),
  title: titleInput?.value ?? null,
  contentPreview: preview?.innerText.slice(0, 120) ?? null,
  katex: preview?.querySelectorAll('.katex').length ?? 0,
  hasSource: Boolean(modal?.querySelector('.topic-excerpt-source'))
}
const fullscreenButton = Array.from(modal?.querySelectorAll('button') ?? []).find((button) => button.title === '全屏编辑')
fullscreenButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const fullscreen = document.querySelector('.inbox-editor-modal')?.classList.contains('fullscreen') ?? false
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, textarea.value + '\n\n新增的主题摘录内容')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const saveButton = Array.from(document.querySelectorAll('.inbox-editor-modal .modal-actions button')).find((button) => button.innerText.trim() === '保存')
saveButton?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const state = await window.api.library.getState()
const excerpt = state.excerpts.find((entry) => entry.id === 'ac5aaad3-4115-47ed-989c-c902a3eac0c8')
return {
  opened,
  fullscreen,
  modalClosed: !document.querySelector('.inbox-editor-modal'),
  savedContent: excerpt?.answer.includes('新增的主题摘录内容') ?? false
}
