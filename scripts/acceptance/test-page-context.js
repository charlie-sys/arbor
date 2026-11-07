const api = window.api
const state = await api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const chat = await api.chats.create([doc.id])
const requestId = `page-${Date.now()}`
let content = ''
let error = null
const done = new Promise((resolve) => {
  const off = api.events.onChat((event) => {
    if (event.requestId !== requestId) return
    if (event.type === 'done') {
      content = event.content || ''
      off()
      resolve()
    } else if (event.type === 'error') {
      error = event.error || 'unknown'
      off()
      resolve()
    }
  })
  setTimeout(() => {
    off()
    resolve()
  }, 90000)
})
await api.agent.send({
  requestId,
  chatId: chat.id,
  docIds: [doc.id],
  messages: [{ role: 'user', content: '本页出现了哪些术语？' }],
  context: { contextMode: 'page', page: 2 }
})
await done
return {
  error,
  length: content.length,
  hasPageTwo: content.includes('Page Two'),
  hasPageOne: content.includes('Page One'),
  excerpt: content.slice(0, 800)
}
