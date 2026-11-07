Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('跨文献引用测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const before = await window.api.library.getState()
const bubble = Array.from(document.querySelectorAll('.assistant-bubble')).find((el) => el.innerText.includes('《Alpha 文献》'))
const button = bubble?.querySelector('button[title*="存为摘录"]')
button?.click()
await new Promise((resolve) => setTimeout(resolve, 1000))
const after = await window.api.library.getState()
const latest = after.excerpts[after.excerpts.length - 1]
return {
  clicked: Boolean(button),
  beforeCount: before.excerpts.length,
  afterCount: after.excerpts.length,
  latest: latest ? { docTitle: latest.docTitle, page: latest.page, question: latest.question, answer: latest.answer.slice(0, 120) } : null
}
