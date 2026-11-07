const mark = document.querySelector('.pdf-highlight.hl-pink')
mark?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const editor = document.querySelector('.highlight-editor')
const deleteButton = Array.from(editor?.querySelectorAll('button') ?? []).find((button) => button.innerText.includes('删除'))
deleteButton?.click()
await new Promise((resolve) => setTimeout(resolve, 900))

const state = await window.api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const remaining = state.highlights.filter((item) => item.docId === doc.id)
return {
  editorShown: Boolean(editor),
  deleteClicked: Boolean(deleteButton),
  remaining: remaining.map((item) => ({ color: item.color, page: item.page, text: item.text })),
  domHighlights: document.querySelectorAll('.pdf-highlight').length
}
