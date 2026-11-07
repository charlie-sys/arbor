
const api = window.api
const pdf = 'C:/Users/18116/AppData/Local/Temp/zotagent-keepalive/test.pdf'
async function add(title, year, status) {
  const doc = await api.library.importPdf(pdf, title)
  await api.library.setText(doc.id, [title + ' 第一页'], { title, authors: '作者' })
  await api.library.update(doc.id, { year, journal: '测试期刊', readingStatus: status })
  return doc.id
}
const alpha = await add('Alpha 文献', '2024', 'unread')
const beta = await add('Beta 文献', '2025', 'read')
const gamma = await add('Gamma 文献', '2026', 'reading')
const chat = await api.chats.create([alpha])
await api.chats.update(chat.id, { title: '草稿测试', messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: Date.now() }] })
return { alpha, beta, gamma, chat: chat.id }
