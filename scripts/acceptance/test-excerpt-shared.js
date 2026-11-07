Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('附件功能测试文献'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1500))
Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.trim().startsWith('摘录'))?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
document.querySelector('.excerpt-item')?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const editButton = Array.from(document.querySelectorAll('.excerpt-detail-modal .modal-actions button')).find((button) => button.innerText.includes('编辑'))
editButton?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const modal = document.querySelector('.inbox-editor-modal')
const heading = modal?.querySelector('.modal-head h3')?.innerText ?? null
const toolbar = Array.from(modal?.querySelectorAll('.inbox-editor-toolbar button') ?? []).map((button) => button.innerText.trim())
const textarea = modal?.querySelector('.inbox-editor-grid textarea')
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, textarea.value + '\n\n新增摘录内容')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const fullscreenButton = Array.from(modal?.querySelectorAll('button') ?? []).find((button) => button.title === '全屏编辑')
fullscreenButton?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const fullscreen = document.querySelector('.inbox-editor-modal')?.classList.contains('fullscreen') ?? false
const saveButton = Array.from(document.querySelectorAll('.inbox-editor-modal .modal-actions button')).find((button) => button.innerText.trim() === '保存')
saveButton?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const state = await window.api.library.getState()
const excerpt = state.excerpts.find((entry) => entry.id === 'd79d8c8a-df38-4151-b3c7-2ffa78b193f9')
return {
  heading,
  toolbar,
  fullscreen,
  saved: excerpt?.answer.includes('新增摘录内容') ?? false,
  modalClosed: !document.querySelector('.inbox-editor-modal')
}
