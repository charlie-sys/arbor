const tableButton = Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')
tableButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const title = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('大纲测试文献'))
title?.click()
await new Promise((resolve) => setTimeout(resolve, 2600))
const pageInput = () => document.querySelector('.page-input')?.value ?? null

const outlineTab = Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.includes('大纲'))
outlineTab?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const outlineText = document.querySelector('.outline-panel')?.innerText.slice(0, 500) ?? ''
const outlineTitles = Array.from(document.querySelectorAll('.outline-title')).map((button) => ({
  text: button.innerText.trim(),
  page: button.parentElement?.querySelector('.outline-page')?.innerText ?? null
}))
const chapterOne = Array.from(document.querySelectorAll('.outline-title')).find((button) => button.innerText.includes('Chapter One'))
const chapterTwo = Array.from(document.querySelectorAll('.outline-title')).find((button) => button.innerText.includes('Chapter Two'))
chapterOne?.click()
await new Promise((resolve) => setTimeout(resolve, 1000))
const pageAfterChapterOne = pageInput()
chapterTwo?.click()
await new Promise((resolve) => setTimeout(resolve, 1200))
const pageAfterChapterTwo = pageInput()

chapterOne?.click()
await new Promise((resolve) => setTimeout(resolve, 1000))
const pageBeforeHighlight = pageInput()
const highlightTab = Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.includes('高亮'))
highlightTab?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const highlightItems = Array.from(document.querySelectorAll('.highlight-item')).map((el) => el.innerText.trim())
document.querySelector('.highlight-item')?.click()
await new Promise((resolve) => setTimeout(resolve, 1200))
const pageAfterHighlightClick = pageInput()

return {
  opened: Boolean(title),
  outlineText,
  outlineTitles,
  pageAfterChapterOne,
  pageAfterChapterTwo,
  pageBeforeHighlight,
  highlightItems,
  pageAfterHighlightClick
}
