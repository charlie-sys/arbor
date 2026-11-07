
const api = window.api
const c = await api.chats.create([])
await api.chats.update(c.id, { title: '后台测试C' })
const d = await api.chats.create([])
await api.chats.update(d.id, { title: '后台测试D' })
return { c: c.id, d: d.id }
