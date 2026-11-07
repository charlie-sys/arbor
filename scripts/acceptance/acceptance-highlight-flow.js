const findSpan = () => Array.from(document.querySelectorAll('.textLayer span')).find((span) => span.innerText.trim() === 'Page One')
const scroll = document.querySelector('.pdf-scroll')
function selectText() {
  const span = findSpan()
  const range = document.createRange()
  range.selectNodeContents(span)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  const rect = span.getBoundingClientRect()
  scroll.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }))
}
selectText()
await new Promise((resolve) => setTimeout(resolve, 600))
const toolbarShown = Boolean(document.querySelector('.selection-toolbar'))
const swatchCount = document.querySelectorAll('.hl-swatch').length
document.querySelector('.hl-swatch.hl-yellow')?.click()
await new Promise((resolve) => setTimeout(resolve, 900))

selectText()
await new Promise((resolve) => setTimeout(resolve, 600))
const toolbarShownAgain = Boolean(document.querySelector('.selection-toolbar'))
document.querySelector('.hl-swatch.hl-green')?.click()
await new Promise((resolve) => setTimeout(resolve, 900))

const state = await window.api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const highlights = state.highlights
  .filter((item) => item.docId === doc.id)
  .map((item) => ({ page: item.page, color: item.color, text: item.text }))
const domHighlights = document.querySelectorAll('.pdf-highlight').length
return { toolbarShown, swatchCount, toolbarShownAgain, highlights, domHighlights }
