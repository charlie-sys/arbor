function clickNav(name) {
  Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes(name))?.click()
}
function selectChat(title) {
  Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes(title))?.click()
}
function activeThread() {
  return document.querySelector('.chat-thread-slot.active')
}
clickNav('AI 对话')
await new Promise((resolve) => setTimeout(resolve, 800))
selectChat('后台测试C')
await new Promise((resolve) => setTimeout(resolve, 700))
let thread = activeThread()
const textarea = thread?.querySelector('.composer textarea')
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '请回答这个问题')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const sendButton = Array.from(thread?.querySelectorAll('.composer-actions button') ?? []).find((button) => button.innerText.includes('发送'))
sendButton?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
selectChat('后台测试D')
await new Promise((resolve) => setTimeout(resolve, 4000))
selectChat('后台测试C')
await new Promise((resolve) => setTimeout(resolve, 900))
thread = activeThread()
const bubbleTexts = Array.from(thread?.querySelectorAll('.assistant-bubble') ?? []).map((el) => el.innerText.trim())
const state = await window.api.library.getState()
const chatC = state.chats.find((chat) => chat.title === '后台测试C')
const chatD = state.chats.find((chat) => chat.title === '后台测试D')
return {
  sendClicked: Boolean(sendButton),
  bubbleTexts,
  storedC: chatC?.messages.map((message) => ({ role: message.role, content: message.content })),
  storedD: chatD?.messages.length ?? 0
}
