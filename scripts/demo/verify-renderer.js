const state = await window.api.library.getState()
const backups = await window.api.backup.list()
const nav = Array.from(document.querySelectorAll('.nav-item')).map((item) => item.innerText.replace(/\s+/g, ' ').trim())
const rows = Array.from(document.querySelectorAll('.doc-row')).map((row) => row.innerText.replace(/\s+/g, ' ').trim())
const doc = state.documents[0]
return {
  counts: {
    documents: state.documents.length,
    chats: state.chats.length,
    topics: state.researchTopics.length,
    canvases: state.canvases.length,
    inbox: state.inbox.length,
    translations: state.translations.length,
    excerpts: state.excerpts.length,
    highlights: state.highlights.length,
    tasks: state.tasks.length,
    collections: state.collections.length,
    properties: state.properties.length,
    savedViews: state.savedViews.length
  },
  doc: doc ? { title: doc.title, pages: doc.pageCount, status: doc.readingStatus } : null,
  topicQuestions: state.researchTopics.map((topic) => ({ name: topic.name, questions: topic.questions.length })),
  canvasNodes: state.canvases[0]?.nodes.length ?? 0,
  canvasEdges: state.canvases[0]?.edges.length ?? 0,
  translationModels: state.translations.map((item) => item.model),
  backups: backups.map((item) => ({ name: item.name, size: item.size })),
  apiKeyPresent: !!state.settings.apiKey,
  nav,
  rows
}
