async function openDrawer() {
  const edge = document.querySelector('.sidebar-edge')
  edge?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  edge?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 450))
}
await openDrawer()
Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('附件聊天测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
const composer = document.querySelector('.chat-thread-slot.active .composer')
const transfer = new DataTransfer()
transfer.items.add(new File(['这是附件内容'], '测试附件.txt', { type: 'text/plain' }))
composer?.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
await new Promise((resolve) => setTimeout(resolve, 900))
const pending = Array.from(document.querySelectorAll('.chat-thread-slot.active .chat-attachment')).map((el) => el.innerText.trim())
const sendButton = Array.from(document.querySelectorAll('.chat-thread-slot.active .composer-actions button')).find((button) => button.innerText.includes('发送'))
const sendDisabled = sendButton?.disabled ?? null
sendButton?.click()
await new Promise((resolve) => setTimeout(resolve, 1400))
const messageAttachments = Array.from(document.querySelectorAll('.chat-thread-slot.active .msg-attachments > *')).map((el) => el.innerText.trim())
const state = await window.api.library.getState()
const chat = state.chats.find((entry) => entry.title === '附件聊天测试')
const userMessage = [...(chat?.messages ?? [])].reverse().find((message) => message.role === 'user')
return {
  pending,
  sendDisabled,
  messageAttachments,
  storedUserAttachments: userMessage?.attachments?.map((attachment) => attachment.name) ?? [],
  storedUserContent: userMessage?.content ?? null
}
