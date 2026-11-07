const api = window.api
const state = await api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const target = state.highlights.find((item) => item.docId === doc.id && item.color === 'pink')
if (target) await api.highlights.remove(target.id)
await new Promise((resolve) => setTimeout(resolve, 600))
const after = await api.library.getState()
return {
  removed: Boolean(target),
  remaining: after.highlights.filter((item) => item.docId === doc.id).map((item) => item.color)
}
