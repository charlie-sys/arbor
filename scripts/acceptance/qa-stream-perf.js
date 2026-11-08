const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const setTextarea = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const clickTab = (label) => {
  const button = Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.includes(label))
  button?.click()
  return Boolean(button)
}

await window.api.settings.save({
  apiBaseUrl: 'http://127.0.0.1:9879',
  apiKey: 'test',
  chatModel: 'mock',
  visionModel: 'mock'
})

const state = await window.api.library.getState()
const pdfDoc = state.documents.find((doc) => String(doc.fileName || '').toLowerCase().endsWith('.pdf'))
if (!pdfDoc) return { error: '没有 PDF 文献' }
const needle = pdfDoc.title.slice(0, 10)

Array.from(document.querySelectorAll('.nav-item')).find((b) => b.innerText.includes('文献库'))?.click()
await sleep(600)
Array.from(document.querySelectorAll('button')).find((b) => b.title === '表格视图')?.click()
await sleep(500)
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes(needle))?.click()
await sleep(2600)
clickTab('AI 助手')
await sleep(500)

const perfPill = Array.from(document.querySelectorAll('.chat-pill')).find((el) => el.innerText.includes('性能测试'))
perfPill?.click()
await sleep(700)

const textarea = document.querySelector('.agent-panel .composer textarea')
setTextarea(textarea, '快速流式压力测试')
await sleep(100)
Array.from(document.querySelectorAll('.agent-panel .composer-actions button'))
  .find((b) => b.innerText.includes('发送'))
  ?.click()
await sleep(120)

const longTasks = []
try {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration))
  })
  observer.observe({ entryTypes: ['longtask'] })
  window.__perfObserver = observer
} catch {
  // longtask unsupported
}

let maxDrift = 0
let totalDrift = 0
let samples = 0
const driftSamples = []
const startedAt = performance.now()
const sampler = setInterval(() => {
  const now = performance.now()
  const expected = samples * 20
  const drift = now - startedAt - expected
  if (drift > 0) {
    maxDrift = Math.max(maxDrift, drift)
    totalDrift += drift
    driftSamples.push(Math.round(drift))
  }
  samples += 1
}, 20)

let typed = 0
const typing = setInterval(() => {
  const box = document.querySelector('.agent-panel .composer textarea')
  if (!box) return
  setTextarea(box, `快速流式压力测试${'字'.repeat(typed % 30)}`)
  typed += 1
}, 200)

const streamingStarted = Boolean(document.querySelector('.agent-panel .composer-hint')?.innerText.includes('正在生成'))
const deadline = performance.now() + 12000
while (performance.now() < deadline) {
  await sleep(150)
  const hint = document.querySelector('.agent-panel .composer-hint')?.innerText ?? ''
  if (streamingStarted && !hint.includes('正在生成') && hint.trim()) break
}
clearInterval(sampler)
clearInterval(typing)
window.__perfObserver?.disconnect()
await sleep(400)

const assistantBubbles = Array.from(document.querySelectorAll('.agent-panel .msg-row.assistant .msg-bubble')).map((el) =>
  el.innerText
)
const lastBubble = assistantBubbles[assistantBubbles.length - 1] ?? ''
driftSamples.sort((a, b) => a - b)
const p95 = driftSamples.length ? driftSamples[Math.floor(driftSamples.length * 0.95)] : 0
const fresh = await window.api.library.getState()
const chat = fresh.chats.find((item) => item.title.includes('性能测试'))
const lastAssistant = chat?.messages[chat.messages.length - 1]

let idleMaxDrift = 0
let idleSamples = 0
const idleStart = performance.now()
const idleSampler = setInterval(() => {
  idleSamples += 1
  const drift = performance.now() - idleStart - idleSamples * 20
  if (drift > idleMaxDrift) idleMaxDrift = drift
}, 20)
for (let i = 0; i < 20; i += 1) {
  const box = document.querySelector('.agent-panel .composer textarea')
  if (box) setTextarea(box, `空闲输入测试${i}`)
  await sleep(50)
}
clearInterval(idleSampler)

return {
  streamingStarted,
  assistantBubbleCount: assistantBubbles.length,
  lastBubbleLength: lastBubble.length,
  finalAnswerLength: lastAssistant?.content?.length ?? 0,
  persistedOk: (lastAssistant?.content ?? '').includes('压力测试完成'),
  timers: {
    samples,
    maxDrift: Math.round(maxDrift),
    p95Drift: Math.round(p95),
    avgDrift: Math.round(totalDrift / Math.max(1, samples))
  },
  longTasks: {
    count: longTasks.length,
    max: longTasks.length ? Math.max(...longTasks) : 0,
    total: longTasks.reduce((sum, value) => sum + value, 0)
  },
  idleTyping: {
    maxDrift: Math.round(idleMaxDrift),
    samples: idleSamples
  },
  typingDispatches: typed
}
