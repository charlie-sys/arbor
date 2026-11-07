async function openDrawer() {
  const edge = document.querySelector('.sidebar-edge')
  edge?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  edge?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 450))
}
await openDrawer()
Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('Inbox'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
document.querySelector('.inbox-item')?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const textarea = document.querySelector('.inbox-editor-grid textarea')
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '未保存的 Inbox 内容')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const closeButton = Array.from(document.querySelectorAll('.inbox-editor-modal .icon-btn')).find((button) => button.title === '关闭')
closeButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
return {
  modalStillOpen: Boolean(document.querySelector('.inbox-editor-modal')),
  toast: document.body.innerText.includes('有未保存的修改')
}
