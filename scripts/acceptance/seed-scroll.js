
const api = window.api
function make(id, role, content) { return { id, role, content, createdAt: Date.now() } }
const messages = []
for (let i = 0; i < 18; i++) {
  messages.push(make('u'+i, 'user', '问题 ' + (i+1) + '：请解释这段内容。'.repeat(4)))
  messages.push(make('a'+i, 'assistant', '回答 ' + (i+1) + '：'.repeat(1) + '这是一段较长的历史消息内容，用于撑高会话区域。'.repeat(8)))
}
const a = await api.chats.create([])
await api.chats.update(a.id, { title: '长会话A', messages })
const b = await api.chats.create([])
await api.chats.update(b.id, { title: '长会话B', messages: [{ id: 'b1', role: 'assistant', content: '短会话', createdAt: Date.now() }] })
return { a: a.id, b: b.id, count: messages.length }
