const api = window.api
const pdf = 'C:/Users/18116/AppData/Local/Temp/zotagent-notion/test.pdf'
const docs = []
for (const [title, year, status, tag] of [
  ['锂离子电池健康状态估计', '2023', 'reading', '电池'],
  ['深度学习在医学影像中的应用', '2024', 'unread', '医学'],
  ['图神经网络综述', '2022', 'read', '图学习'],
  ['大语言模型推理能力研究', '2025', 'unread', 'LLM'],
  ['科学知识管理方法', '2021', 'read', '知识管理']
]) {
  const doc = await api.library.importPdf(pdf, title)
  await api.library.setText(doc.id, [title + ' 第一页内容'], { title, authors: '测试作者' })
  await api.library.update(doc.id, { year, journal: '测试期刊', readingStatus: status, tags: [tag] })
  docs.push(doc)
}
const collection = await api.collections.add('研究分类')
await api.library.update(docs[0].id, { collections: [collection.id] })
const chat = await api.chats.create([docs[0].id])
await api.chats.update(chat.id, { title: '研究讨论', messages: [{ id: 'a1', role: 'assistant', content: '可以继续提问。', createdAt: Date.now() }] })
await api.inbox.add({ kind: 'text', content: 'Notion 风格 Inbox 内容' })
await api.topics.add({ name: '电池研究主题', docIds: docs.slice(0, 3).map((doc) => doc.id) })
return { docs: docs.map((doc) => doc.id) }
