const api = window.api
const state = await api.library.getState()
const alpha = state.documents.find((item) => item.title === 'Alpha 文献')
const outline = state.documents.find((item) => item.title === '大纲测试文献')
const chat = await api.chats.create([alpha.id, outline.id])
const now = Date.now()
await api.chats.update(chat.id, {
  title: '跨文献引用测试',
  messages: [
    { id: 'u1', role: 'user', content: '请对比两篇文献的对应内容。', createdAt: now - 3000 },
    {
      id: 'a1',
      role: 'assistant',
      content: '《Alpha 文献》第 1 页给出占位内容 [第1页]。《大纲测试文献》第 2 页给出另一段内容 [第2页]。',
      createdAt: now - 2000
    }
  ]
})
return { chatId: chat.id, alphaId: alpha.id, outlineId: outline.id }
