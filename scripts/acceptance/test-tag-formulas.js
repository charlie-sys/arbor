Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('编号公式测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1200))
const bubble = Array.from(document.querySelectorAll('.assistant-bubble')).find((el) => el.innerText.includes('行内编号'))
const chatResult = {
  katex: bubble?.querySelectorAll('.katex').length ?? 0,
  errors: bubble?.querySelectorAll('.katex-error').length ?? 0,
  rawTag: bubble?.innerText.includes('\\tag') ?? false,
  text: bubble?.innerText.slice(0, 300) ?? null
}

Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('文献库'))?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('Issue Doc A'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1600))
Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.trim().startsWith('笔记'))?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const notes = document.querySelector('.notes-preview')
const notesResult = {
  katex: notes?.querySelectorAll('.katex').length ?? 0,
  errors: notes?.querySelectorAll('.katex-error').length ?? 0,
  rawTag: notes?.innerText.includes('\\tag') ?? false,
  text: notes?.innerText.slice(0, 300) ?? null
}

return { chatResult, notesResult }
