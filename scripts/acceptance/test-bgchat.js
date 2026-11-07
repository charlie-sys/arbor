function clickNav(name) {
  Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes(name))?.click()
}
function selectChat(title) {
  Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes(title))?.click()
}
clickNav('AI 对话')
await new Promise((resolve) => setTimeout(resolve, 800))
selectChat('后台测试A')
await new Promise((resolve) => setTimeout(resolve, 600))
const textarea = document.querySelector('.composer textarea')
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '请回答这个问题')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const sendButton = Array.from(document.querySelectorAll('.composer-actions button')).find((button) => button.innerText.includes('发送'))
sendButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
selectChat('后台测试B')
await new Promise((resolve) => setTimeout(resolve, 3800))
selectChat('后台测试A')
await new Promise((resolve) => setTimeout(resolve, 800))
const bubbleTexts = Array.from(document.querySelectorAll('.assistant-bubble')).map((el) => el.innerText.trim())
const state = await window.api.library.getState()
const chatA = state.chats.find((chat) => chat.title === '后台测试A')
const chatB = state.chats.find((chat) => chat.title === '后台测试B')
return {
  sendClicked: Boolean(sendButton),
  bubbleTexts,
  storedA: chatA?.messages.map((message) => ({ role: message.role, content: message.content })),
  storedB: chatB?.messages.length ?? 0
}
