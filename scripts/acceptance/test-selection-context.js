const api = window.api
const state = await api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const chat = await api.chats.create([doc.id])
const requestId = `selection-${Date.now()}`
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
  messages: [{ role: 'user', content: '请引用我选中的原文，并标注它来自哪一页。' }],
  context: { contextMode: 'selection', selection: 'Page Two', page: 2 }
})
await done
return {
  error,
  length: content.length,
  mentionsSelection: content.includes('Page Two'),
  mentionsPage2: /第\s*2\s*页|p\.\s*2|page\s*2/i.test(content),
  excerpt: content.slice(0, 800)
}
