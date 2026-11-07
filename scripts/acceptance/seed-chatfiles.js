const api = window.api
const doc = await api.library.importPdf('C:/Users/18116/AppData/Local/Temp/zotagent-chatfiles/test.pdf', '附件功能测试文献')
await api.library.setText(doc.id, ['Hello'], { title: '附件功能测试文献', authors: '作者' })
const excerpt = await api.excerpts.add({
  docId: doc.id,
  page: 1,
  source: '摘录原文',
  question: '摘录问题',
  answer: '摘录回答 Markdown $E=mc^2$'
})
const chat = await api.chats.create([doc.id])
const now = Date.now()
await api.chats.update(chat.id, {
  title: '附件聊天测试',
  messages: [{ id: 'm1', role: 'assistant', content: '可以发送文件了。', createdAt: now }]
})
return { doc: doc.id, excerpt: excerpt.id, chat: chat.id }
