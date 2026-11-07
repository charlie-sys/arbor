Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('Inbox'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
document.querySelector('.inbox-item')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const modal = document.querySelector('.inbox-editor-modal')
const textarea = modal?.querySelector('textarea')
const preview = modal?.querySelector('.inbox-editor-preview')
const initial = {
  modal: Boolean(modal),
  hasPreview: Boolean(preview),
  textareaStart: textarea?.value.slice(0, 40) ?? null
}
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const content = `## 测试标题\n\n公式 $E=mc^2$\n\n![图](${png})\n\n- 项目一`
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, content)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 500))
const live = {
  katex: preview?.querySelectorAll('.katex').length ?? 0,
  error: preview?.querySelectorAll('.katex-error').length ?? 0,
  heading: Boolean(preview?.querySelector('h2')),
  image: Boolean(preview?.querySelector('img'))
}
const formulaButton = Array.from(modal?.querySelectorAll('button') ?? []).find((button) => button.innerText.includes('插入公式'))
formulaButton?.click()
await new Promise((resolve) => setTimeout(resolve, 200))
const insertedFormula = textarea?.value.includes('$$') ?? false
const saveButton = Array.from(modal?.querySelectorAll('button') ?? []).find((button) => button.innerText.trim() === '保存')
saveButton?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const list = document.querySelector('.inbox-content')
const listResult = {
  heading: Boolean(list?.querySelector('h2')),
  katex: list?.querySelectorAll('.katex').length ?? 0,
  image: Boolean(list?.querySelector('img'))
}
const state = await window.api.library.getState()
return {
  initial,
  live,
  insertedFormula,
  saved: state.inbox[0]?.content.includes('测试标题') ?? false,
  listResult
}
