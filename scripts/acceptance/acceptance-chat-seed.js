const api = window.api
const state = await api.library.getState()
const chat = state.chats[0]
const now = Date.now()
await api.chats.update(chat.id, {
  title: '引用测试对话',
  messages: [
    { id: 'm1', role: 'user', content: '这篇文献的研究方法是什么？', createdAt: now - 2000 },
    { id: 'm2', role: 'assistant', content: '研究方法是样本分析 [第1页]。结论见 [第2页]。', createdAt: now - 1000 },
    { id: 'm3', role: 'assistant', content: '这段回答没有页码。', createdAt: now - 500 }
  ]
})
return { chatId: chat.id, messages: 3 }
