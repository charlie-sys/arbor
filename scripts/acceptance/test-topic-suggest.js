const api = window.api
const state = await api.library.getState()
const docs = state.documents.slice(0, 3)
const topic = await api.topics.add({ name: '模型验收主题', docIds: docs.map((doc) => doc.id) })
let questions = []
let error = null
try {
  questions = await api.topics.suggest(topic.id)
} catch (err) {
  error = String(err)
}
const fresh = await api.library.getState()
const stored = fresh.researchTopics.find((item) => item.id === topic.id)
const chat = await api.chats.create(topic.docIds)
await api.topics.update(topic.id, { chatId: chat.id })
return {
  error,
  docs: docs.map((doc) => doc.title),
  questionCount: questions.length,
  questions: questions.slice(0, 8),
  uniqueQuestions: new Set(questions.map((q) => q.replace(/[\s，。！？、；：,.!?;:'"“”‘’()（）]/g, ''))).size,
  storedQuestionCount: stored?.questions?.length ?? 0,
  chatDocIds: chat.docIds.length,
  chatDocTitles: chat.docIds.map((id) => docs.find((doc) => doc.id === id)?.title ?? id)
}
