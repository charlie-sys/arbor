function clickNav(name) {
  Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes(name))?.click()
}
function selectChat(title) {
  Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes(title))?.click()
}
function metrics() {
  const el = document.querySelector('.chat-thread-slot.active .chat-messages')
  if (!el) return null
  return {
    gap: Math.round(el.scrollHeight - el.clientHeight - el.scrollTop),
    scrollTop: Math.round(el.scrollTop),
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight
  }
}
clickNav('AI 对话')
await new Promise((resolve) => setTimeout(resolve, 800))
selectChat('长会话A')
await new Promise((resolve) => setTimeout(resolve, 1000))
const first = metrics()
selectChat('长会话B')
await new Promise((resolve) => setTimeout(resolve, 600))
selectChat('长会话A')
await new Promise((resolve) => setTimeout(resolve, 1000))
const afterSwitch = metrics()
clickNav('Inbox')
await new Promise((resolve) => setTimeout(resolve, 600))
clickNav('AI 对话')
await new Promise((resolve) => setTimeout(resolve, 1000))
const afterView = metrics()
return { first, afterSwitch, afterView }
