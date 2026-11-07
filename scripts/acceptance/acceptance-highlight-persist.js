const tableButton = Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')
tableButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const title = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('大纲测试文献'))
title?.click()
await new Promise((resolve) => setTimeout(resolve, 2600))

const state = await window.api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const highlights = state.highlights.filter((item) => item.docId === doc.id)
const marks = Array.from(document.querySelectorAll('.pdf-highlight')).map((el) => el.getBoundingClientRect())
const spans = Array.from(document.querySelectorAll('.textLayer span')).map((el) => ({ text: el.innerText.trim(), rect: el.getBoundingClientRect() }))

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}
const matched = marks.filter((mark) => spans.some((span) => intersects(mark, span.rect))).length
return {
  apiHighlights: highlights.length,
  domHighlights: marks.length,
  highlightsOverlappingText: matched,
  spanTexts: spans.map((span) => span.text)
}
