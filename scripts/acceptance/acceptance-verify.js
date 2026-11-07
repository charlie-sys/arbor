const api = window.api
const state = await api.library.getState()
const doc = state.documents[0]
const highlights = await api.highlights.list(doc.id)
const excerpts = await api.excerpts.list()
const inbox = await api.inbox.list()
const tasks = await api.tasks.list()
const topics = await api.topics.list()
const backups = await api.backup.list()
const search = await api.search.global('研究方法')
const bodyText = document.body.innerText
const buttons = Array.from(document.querySelectorAll('button'))
  .map((button) => button.innerText.trim())
  .filter(Boolean)
  .slice(0, 50)

return {
  docTitle: doc?.title ?? null,
  readingStatus: doc?.readingStatus ?? null,
  highlights: highlights.length,
  highlightColors: highlights.map((item) => item.color),
  excerpts: excerpts.length,
  excerptDocMissing: excerpts[0]?.docMissing ?? null,
  inbox: inbox.length,
  tasks: tasks.length,
  taskDone: tasks[0]?.done ?? null,
  topics: topics.length,
  chats: state.chats.length,
  properties: state.properties.length,
  savedViews: state.savedViews.length,
  collections: state.collections.length,
  backups: Array.isArray(backups) ? backups.length : backups,
  searchCount: search.length,
  domHasTitle: bodyText.includes('验收测试文献'),
  domHasReading: bodyText.includes('阅读中'),
  buttons,
  bodyText: bodyText.slice(0, 1200)
}
