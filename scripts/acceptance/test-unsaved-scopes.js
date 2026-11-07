async function openDrawer() {
  const edge = document.querySelector('.sidebar-edge')
  edge?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  edge?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 450))
}
async function clickNav(name) {
  await openDrawer()
  Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes(name))?.click()
  await new Promise((resolve) => setTimeout(resolve, 700))
}
await clickNav('AI 对话')
const session = Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('输入框测试'))
session?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
const textarea = document.querySelector('.chat-thread-slot.active textarea')
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '未发送的聊天草稿')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
await clickNav('文献库')
const chatNavResult = {
  isLibrary: Boolean(document.querySelector('.view-slot.active .library-view')),
  toast: document.body.innerText.includes('有未保存的修改')
}

await clickNav('设置')
const settingsInput = document.querySelector('.settings-view input')
if (settingsInput) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(settingsInput, 'https://changed.example.com/v1')
  settingsInput.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
await clickNav('文献库')
const settingsNavResult = {
  isSettings: Boolean(document.querySelector('.view-slot.active .settings-view')),
  toast: document.body.innerText.includes('有未保存的修改')
}
return { chatNavResult, settingsNavResult }
