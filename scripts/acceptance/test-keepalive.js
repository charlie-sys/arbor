function clickNav(name) {
  Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes(name))?.click()
}
function rows() {
  return Array.from(document.querySelectorAll('tbody tr')).map(
    (tr) => tr.querySelector('.cell-title-text')?.innerText.trim() ?? ''
  )
}

Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const statusFilter = Array.from(document.querySelectorAll('select')).find(
  (select) => select.options[0]?.text === '全部阅读状态'
)
statusFilter.value = 'read'
statusFilter.dispatchEvent(new Event('change', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 400))
const before = { table: Boolean(document.querySelector('table')), status: statusFilter.value, rows: rows() }

clickNav('Inbox')
await new Promise((resolve) => setTimeout(resolve, 500))
clickNav('文献库')
await new Promise((resolve) => setTimeout(resolve, 600))
const statusAfter = Array.from(document.querySelectorAll('select')).find(
  (select) => select.options[0]?.text === '全部阅读状态'
)
const libraryAfter = { table: Boolean(document.querySelector('table')), status: statusAfter?.value ?? null, rows: rows() }

Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('Beta 文献'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1400))
Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.trim().startsWith('高亮'))?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const panelBefore = document.querySelector('.panel-tab.active')?.innerText.trim() ?? null

clickNav('Inbox')
await new Promise((resolve) => setTimeout(resolve, 500))
clickNav('文献库')
await new Promise((resolve) => setTimeout(resolve, 500))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('Beta 文献'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1200))
const panelAfter = document.querySelector('.panel-tab.active')?.innerText.trim() ?? null

clickNav('AI 对话')
await new Promise((resolve) => setTimeout(resolve, 700))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('草稿测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
const textarea = document.querySelector('.composer textarea')
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '这是一段未发送的草稿')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
clickNav('Inbox')
await new Promise((resolve) => setTimeout(resolve, 500))
clickNav('AI 对话')
await new Promise((resolve) => setTimeout(resolve, 700))
const draftAfter = document.querySelector('.composer textarea')?.value ?? null

return {
  libraryBefore: before,
  libraryAfter,
  readerPanel: { before: panelBefore, after: panelAfter },
  chatDraftAfterSwitch: draftAfter
}
