
const api = window.api
await api.settings.save({ apiBaseUrl: 'http://127.0.0.1:9876', apiKey: 'test', chatModel: 'mock' })
const a = await api.chats.create([])
await api.chats.update(a.id, { title: '后台测试A' })
const b = await api.chats.create([])
await api.chats.update(b.id, { title: '后台测试B' })
return { a: a.id, b: b.id }
