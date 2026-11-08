const api = window.api
const doc = await api.library.importDocument('C:/Users/18116/AppData/Local/Temp/zotagent-acceptance/test.pdf', '验收测试文献')
await api.library.setText(doc.id, ['第一页：研究方法与样本。ZotAgent acceptance.', '第二页：结论与讨论。'], {
  title: '验收测试文献',
  authors: '测试作者'
})
await api.library.update(doc.id, {
  readingStatus: 'reading',
  tags: ['验收'],
  year: '2026',
  journal: '测试期刊'
})

const highlight1 = await api.highlights.add({
  docId: doc.id,
  page: 1,
  color: 'yellow',
  text: '研究方法',
  note: '测试批注',
  rects: [{ x: 10, y: 20, width: 100, height: 16 }]
})
await api.highlights.update(highlight1.id, { color: 'green', note: '已改色' })
const highlight2 = await api.highlights.add({
  docId: doc.id,
  page: 2,
  color: 'blue',
  text: '结论',
  note: '',
  rects: [{ x: 10, y: 40, width: 80, height: 16 }]
})

const excerpt = await api.excerpts.add({
  docId: doc.id,
  page: 1,
  source: 'answer',
  question: '研究方法是什么？',
  answer: '测试回答'
})

const parent = await api.collections.add('验收父分类')
const child = await api.collections.add('验收子分类', parent.id)
await api.collections.remove(parent.id)
const afterCollectionDelete = await api.library.getState()
const childAfter = afterCollectionDelete.collections.find((item) => item.id === child.id)

const property = await api.properties.add({ name: '研究方法', type: 'select', options: ['RCT', '观察'] })
const view = await api.views.add('未读表格视图', {
  status: 'unread',
  viewMode: 'table',
  sorts: [{ key: 'title', dir: 'asc' }]
})
const inbox = await api.inbox.add({ kind: 'text', content: '验收收件箱内容' })
const task = await api.tasks.add({ title: '验收任务', due: '2026-11-08' })
await api.tasks.update(task.id, { done: true })
const topic = await api.topics.add({ name: '验收主题', docIds: [doc.id] })
const chat = await api.chats.create([doc.id])
const search = await api.search.global('研究方法')
const backupRun = await api.backup.run()
const backupList = await api.backup.list()
const state = await api.library.getState()

return {
  docId: doc.id,
  highlightIds: [highlight1.id, highlight2.id],
  highlightColors: state.highlights.map((item) => item.color),
  excerptId: excerpt.id,
  parentId: parent.id,
  childId: child.id,
  childParentIdAfterDelete: childAfter?.parentId ?? null,
  propertyId: property.id,
  viewId: view.id,
  inboxId: inbox.id,
  taskId: task.id,
  topicId: topic.id,
  chatId: chat.id,
  searchCount: search.length,
  searchTypes: search.map((item) => item.type),
  backupRun,
  backupCount: Array.isArray(backupList) ? backupList.length : backupList,
  counts: {
    documents: state.documents.length,
    highlights: state.highlights.length,
    excerpts: state.excerpts.length,
    collections: state.collections.length,
    properties: state.properties.length,
    savedViews: state.savedViews.length,
    inbox: state.inbox.length,
    tasks: state.tasks.length,
    topics: state.researchTopics.length,
    chats: state.chats.length
  },
  readingStatus: state.documents[0]?.readingStatus ?? null
}
