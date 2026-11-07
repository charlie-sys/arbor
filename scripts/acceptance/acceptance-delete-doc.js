const api = window.api
const docId = '843530a8-b766-4e40-85c6-835d7d3f7a68'
const before = await api.library.getState()
await api.library.remove(docId)
await new Promise((resolve) => setTimeout(resolve, 900))
const after = await api.library.getState()
let textsError = null
try {
  await api.library.getTexts(docId)
} catch (error) {
  textsError = String(error).slice(0, 160)
}
const excerpt = after.excerpts[0]
return {
  beforeDocumentCount: before.documents.length,
  afterDocumentCount: after.documents.length,
  beforeHighlights: before.highlights.filter((item) => item.docId === docId).length,
  afterHighlights: after.highlights.filter((item) => item.docId === docId).length,
  excerptCount: after.excerpts.length,
  excerptDocId: excerpt?.docId ?? null,
  excerptDocMissing: excerpt?.docMissing ?? null,
  textsError
}
