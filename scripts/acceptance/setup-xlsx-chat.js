const api = window.api
await api.settings.save({
  apiBaseUrl: 'http://127.0.0.1:9878',
  apiKey: 'test',
  chatModel: 'mock',
  visionModel: 'mock'
})
const chat = await api.chats.create([])
await api.chats.update(chat.id, {
  title: '表格解析测试',
  messages: [{ id: 'm1', role: 'assistant', content: '请发送表格。', createdAt: Date.now() }]
})
return { chat: chat.id }
