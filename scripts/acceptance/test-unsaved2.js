function activeViewContains(selector) {
  return Boolean(document.querySelector(`.view-slot.active ${selector}`))
}
Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('未保存保护测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1500))
Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.trim().startsWith('笔记'))?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const editButton = Array.from(document.querySelectorAll('.notes-panel button')).find((button) => button.innerText.trim() === '编辑')
editButton?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const editor = document.querySelector('.notes-editor')
if (editor) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(editor, '未保存的笔记内容')
  editor.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 400))
const dirtyLabel = document.querySelector('.notes-panel')?.innerText.includes('有未保存的修改') ?? false
const backButton = Array.from(document.querySelectorAll('.reader-toolbar button')).find((button) => button.title === '返回文献库')
backButton?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
const blocked = {
  stillReader: activeViewContains('.reader-view'),
  toast: document.body.innerText.includes('有未保存的修改')
}
const saveButton = Array.from(document.querySelectorAll('.notes-panel button')).find((button) => button.innerText.includes('保存笔记'))
saveButton?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
backButton?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
const afterSave = {
  stillReader: activeViewContains('.reader-view'),
  isLibrary: activeViewContains('.library-view')
}
return { dirtyLabel, blocked, afterSave }
