const nav = Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))
nav?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const bubble = Array.from(document.querySelectorAll('.assistant-bubble')).find((el) => el.innerText.includes('研究方法是样本分析'))
const button = bubble?.querySelector('button[title*="存为笔记"]')
button?.click()
await new Promise((resolve) => setTimeout(resolve, 1000))
const state = await window.api.library.getState()
const doc = state.documents.find((item) => item.title === '验收测试文献')
return {
  clicked: Boolean(button),
  notes: doc?.notes ?? null,
  savedToast: document.body.innerText.includes('已保存') || document.body.innerText.includes('已存为')
}
