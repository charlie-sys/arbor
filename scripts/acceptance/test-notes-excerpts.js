function clickTab(name) {
  const tab = Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.trim().startsWith(name))
  tab?.click()
}
clickTab('笔记')
await new Promise((resolve) => setTimeout(resolve, 500))
const notesPanel = document.querySelector('.notes-panel')
const notesData = {
  hasPreview: Boolean(notesPanel?.querySelector('.notes-preview')),
  katexCount: notesPanel?.querySelectorAll('.notes-preview .katex').length ?? 0,
  hasStrong: Boolean(notesPanel?.querySelector('.notes-preview strong')),
  text: notesPanel?.querySelector('.notes-preview')?.innerText.slice(0, 200) ?? null
}

clickTab('摘录')
await new Promise((resolve) => setTimeout(resolve, 500))
const excerptPanelA = document.querySelector('.excerpts-panel')
const excerptA = {
  count: excerptPanelA?.querySelectorAll('.excerpt-item').length ?? 0,
  text: excerptPanelA?.innerText.slice(0, 300) ?? '',
  katexCount: excerptPanelA?.querySelectorAll('.katex').length ?? 0
}

Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('文献库'))?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('Issue Doc B'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1800))
clickTab('摘录')
await new Promise((resolve) => setTimeout(resolve, 500))
const excerptPanelB = document.querySelector('.excerpts-panel')
const excerptB = {
  count: excerptPanelB?.querySelectorAll('.excerpt-item').length ?? 0,
  text: excerptPanelB?.innerText.slice(0, 300) ?? '',
  containsA: excerptPanelB?.innerText.includes('A 的答案') ?? false
}
clickTab('笔记')
await new Promise((resolve) => setTimeout(resolve, 500))
const notesB = {
  text: document.querySelector('.notes-preview')?.innerText.slice(0, 200) ?? null,
  containsA: document.querySelector('.notes-preview')?.innerText.includes('质能方程') ?? false
}

return { notesData, excerptA, excerptB, notesB }
