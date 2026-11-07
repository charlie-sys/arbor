const target = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('验收测试文献'))
target?.click()
await new Promise((resolve) => setTimeout(resolve, 2000))

const tabOrder = Array.from(document.querySelectorAll('.panel-tab')).map((el) => el.innerText.trim())
function clickTab(name) {
  const tab = Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.trim().startsWith(name))
  tab?.click()
}
const pageInput = () => document.querySelector('.page-input')?.value ?? null

clickTab('高亮')
await new Promise((resolve) => setTimeout(resolve, 500))
const highlightItems = Array.from(document.querySelectorAll('.highlight-item'))
const highlightPages = Array.from(document.querySelectorAll('.highlight-page')).map((el) => el.innerText.trim())
const highlightPanel = document.querySelector('.highlights-panel')?.innerText.slice(0, 600) ?? ''
const page2Item = highlightItems.find((item) => item.innerText.includes('p.2'))
page2Item?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const pageAfterHighlightClick = pageInput()

clickTab('摘录')
await new Promise((resolve) => setTimeout(resolve, 500))
const excerptItems = Array.from(document.querySelectorAll('.excerpt-item'))
const excerptPanel = document.querySelector('.excerpts-panel')?.innerText.slice(0, 600) ?? ''
const jumpButton = Array.from(document.querySelectorAll('.excerpt-item button')).find((button) => button.innerText.includes('跳回原文'))
jumpButton?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const pageAfterExcerptJump = pageInput()

clickTab('大纲')
await new Promise((resolve) => setTimeout(resolve, 800))
const outlinePanel = document.querySelector('.outline-panel')?.innerText.slice(0, 600) ?? ''

return {
  tabOrder,
  highlightCount: highlightItems.length,
  highlightPages,
  highlightPanel,
  pageAfterHighlightClick,
  excerptCount: excerptItems.length,
  excerptPanel,
  pageAfterExcerptJump,
  outlinePanel
}
