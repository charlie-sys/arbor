window.getSelection()?.removeAllRanges()
const scroll = document.querySelector('.pdf-scroll')
scroll.scrollTop = 0
await new Promise((resolve) => setTimeout(resolve, 600))
const mark = document.querySelector('.pdf-highlight.hl-yellow')
const rect = mark?.getBoundingClientRect()
scroll.dispatchEvent(new MouseEvent('mouseup', {
  bubbles: true,
  clientX: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
  clientY: (rect?.top ?? 0) + (rect?.height ?? 0) / 2
}))
await new Promise((resolve) => setTimeout(resolve, 700))
const editor = document.querySelector('.highlight-editor')
const deleteButton = Array.from(editor?.querySelectorAll('button') ?? []).find((button) => button.innerText.includes('删除'))
deleteButton?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const state = await window.api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
return {
  editorShown: Boolean(editor),
  deleteClicked: Boolean(deleteButton),
  remaining: state.highlights.filter((item) => item.docId === doc.id).map((item) => item.color),
  domHighlights: document.querySelectorAll('.pdf-highlight').length
}
