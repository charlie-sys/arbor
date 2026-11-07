const nav = Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))
nav?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const textarea = document.querySelector('.composer textarea')
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '测试未配置 API Key')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const sendButton = Array.from(document.querySelectorAll('.composer-actions button')).find((button) => button.innerText.includes('发送'))
sendButton?.click()
await new Promise((resolve) => setTimeout(resolve, 3000))
const errors = Array.from(document.querySelectorAll('.assistant-bubble.error')).map((el) => el.innerText.trim())
return {
  textareaFound: Boolean(textarea),
  sendClicked: Boolean(sendButton),
  errors,
  bodyTail: document.body.innerText.slice(-600)
}
