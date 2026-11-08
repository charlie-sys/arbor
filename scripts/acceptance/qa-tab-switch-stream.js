const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clickTab = (label) => {
  const button = Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.includes(label))
  button?.click()
  return Boolean(button)
}
const setTextarea = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

await window.api.settings.save({
  apiBaseUrl: 'http://127.0.0.1:9878',
  apiKey: 'test',
  chatModel: 'mock',
  visionModel: 'mock'
})

const state = await window.api.library.getState()
const pdfDoc = state.documents.find((doc) => String(doc.fileName || '').toLowerCase().endsWith('.pdf'))
if (!pdfDoc) return { error: '没有可用于测试的 PDF 文献' }
const needle = pdfDoc.title.slice(0, 10)

Array.from(document.querySelectorAll('.nav-item')).find((b) => b.innerText.includes('文献库'))?.click()
await sleep(600)
Array.from(document.querySelectorAll('button')).find((b) => b.title === '表格视图')?.click()
await sleep(500)
const row = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes(needle))
row?.click()
await sleep(2600)

if (!document.querySelector('.reader-panel')) return { error: '未打开阅读器', needle }
clickTab('AI 助手')
await sleep(500)

const plus = document.querySelector('.chat-switcher .chat-pills button[title="新建对话"]')
plus?.click()
await sleep(900)
const textarea = document.querySelector('.agent-panel .composer textarea')
if (!textarea) return { error: '未找到输入框', body: document.body.innerText.slice(0, 600) }
setTextarea(textarea, '请用一句话总结这篇文献。')
await sleep(120)
const sendButton = Array.from(document.querySelectorAll('.agent-panel .composer-actions button')).find((b) =>
  b.innerText.includes('发送')
)
const sendEnabled = sendButton ? !sendButton.disabled : false
sendButton?.click()
await sleep(120)

// 提问后立刻切换到大纲，模拟用户报告的场景
await sleep(120)
const switchedAt = Date.now()
const switched = clickTab('大纲')
await sleep(250)
const duringOutline = {
  outlineVisible: Boolean(document.querySelector('.outline-panel')),
  agentMounted: Boolean(document.querySelector('.agent-panel')),
  agentHidden: document.querySelector('.agent-panel')?.classList.contains('is-hidden') ?? null,
  assistantText: document.querySelector('.agent-panel .msg-row.assistant .msg-bubble')?.innerText ?? null
}
await sleep(1100)
clickTab('AI 助手')
await sleep(120)
const onReturn = {
  agentVisible: !document.querySelector('.agent-panel')?.classList.contains('is-hidden'),
  bubbles: Array.from(document.querySelectorAll('.agent-panel .msg-bubble')).map((el) => el.innerText.trim()),
  streamingHint: document.querySelector('.agent-panel .composer-hint')?.innerText ?? null,
  elapsedSinceSwitch: Date.now() - switchedAt
}
await sleep(2600)
const finalBubbles = Array.from(document.querySelectorAll('.agent-panel .msg-row.assistant .msg-bubble')).map((el) =>
  el.innerText.trim()
)

const fresh = await window.api.library.getState()
const chat = fresh.chats.find((item) => item.messages.some((message) => message.content.includes('请用一句话总结这篇文献。')))
const lastAssistant = chat?.messages[chat.messages.length - 1]
const emptyAssistant = Array.from(document.querySelectorAll('.agent-panel .msg-row.assistant .msg-bubble')).filter(
  (el) => !el.innerText.trim()
).length

// 场景 B：生成过程中真正离开阅读器（组件卸载），应中止并落库中断提示
const textareaB = document.querySelector('.agent-panel .composer textarea')
setTextarea(textareaB, '请再总结一次核心贡献。')
await sleep(120)
const sendB = Array.from(document.querySelectorAll('.agent-panel .composer-actions button')).find((b) =>
  b.innerText.includes('发送')
)
const sendBEnabled = sendB ? !sendB.disabled : false
sendB?.click()
await sleep(500)
const streamingBeforeLeave = document.querySelector('.agent-panel .composer-hint')?.innerText ?? null
// 脱离为独立窗口会真正卸载内嵌面板，触发中断兜底
document.querySelector('.panel-detach')?.click()
await sleep(1400)
const detachedState = await window.api.readerPanel.state()
await window.api.readerPanel.close()
await sleep(1400)
const reopenedBubbles = Array.from(document.querySelectorAll('.agent-panel .msg-row.assistant .msg-bubble')).map((el) =>
  el.innerText.trim()
)
const reopened = await window.api.library.getState()
const interruptedChat = reopened.chats.find((item) =>
  item.messages.some((message) => message.content.includes('请再总结一次核心贡献。'))
)
const interruptedLast = interruptedChat?.messages[interruptedChat.messages.length - 1]

return {
  doc: pdfDoc.title,
  sendEnabled,
  switched,
  duringOutline,
  onReturn,
  finalBubbles,
  emptyAssistant,
  persisted: {
    chatFound: Boolean(chat),
    lastRole: lastAssistant?.role ?? null,
    lastContent: lastAssistant?.content ?? null,
    messageCount: chat?.messages.length ?? 0,
    error: lastAssistant?.error ?? null
  },
  unmountInterrupt: {
    sendBEnabled,
    streamingBeforeLeave,
    detachedOpen: detachedState.open,
    reopenedBubbles,
    lastContent: interruptedLast?.content ?? null,
    error: interruptedLast?.error ?? null,
    emptyBubbles: reopenedBubbles.filter((text) => !text).length
  }
}
