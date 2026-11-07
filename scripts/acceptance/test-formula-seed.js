const api = window.api
const chat = await api.chats.create([])
const now = Date.now()
await api.chats.update(chat.id, {
  title: '公式渲染测试',
  messages: [
    { id: 'f1', role: 'user', content: '请展示质能方程。', createdAt: now - 1000 },
    { id: 'f2', role: 'assistant', content: '质能方程为 $E=mc^2$。\n\n$$E = mc^2$$', createdAt: now }
  ]
})
return { chatId: chat.id }
