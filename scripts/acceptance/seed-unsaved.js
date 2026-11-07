const api = window.api
const doc = await api.library.importPdf('C:/Users/18116/AppData/Local/Temp/zotagent-unsaved/test.pdf', '未保存保护测试')
await api.library.setText(doc.id, ['Hello'], { title: '未保存保护测试', authors: '作者' })
const inbox = await api.inbox.add({ kind: 'text', content: '测试未保存保护' })
const chat = await api.chats.create([doc.id])
const now = Date.now()
await api.chats.update(chat.id, {
  title: '输入框测试',
  messages: [{ id: 'm1', role: 'assistant', content: '可以继续提问。', createdAt: now }]
})
return { doc: doc.id, inbox: inbox.id, chat: chat.id }
