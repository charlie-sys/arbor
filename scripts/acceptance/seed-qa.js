const api = window.api
const pdf = 'C:/Users/18116/AppData/Local/Temp/zotagent-qa/test.pdf'
const docs = []
const entries = [
  ['锂离子电池健康状态估计', '2023', 'reading', '电池'],
  ['深度学习在医学影像中的应用', '2024', 'unread', '医学'],
  ['图神经网络综述', '2022', 'read', '图学习'],
  ['大语言模型推理能力研究', '2025', 'unread', 'LLM'],
  ['科学知识管理方法', '2021', 'read', '知识管理']
]
for (const [title, year, status, tag] of entries) {
  const doc = await api.library.importPdf(pdf, title)
  await api.library.setText(doc.id, [title + ' 第一页内容', title + ' 第二页内容'], {
    title,
    authors: '测试作者'
  })
  await api.library.update(doc.id, {
    year,
    journal: '测试期刊',
    readingStatus: status,
    tags: [tag],
    notes: '## 笔记\n公式 $E=mc^2$'
  })
  docs.push(doc)
}
const collection = await api.collections.add('测试分类')
await api.library.update(docs[0].id, { collections: [collection.id] })
const now = Date.now()
const chat1 = await api.chats.create([docs[0].id, docs[1].id])
await api.chats.update(chat1.id, {
  title: '电池与医学影像讨论',
  messages: [
    { id: 'u1', role: 'user', content: '这两篇文献的方法有什么差异？', createdAt: now - 3000 },
    { id: 'a1', role: 'assistant', content: '第一篇使用 SOH 估计，第二篇使用卷积网络。公式 $E=mc^2$。', createdAt: now - 2000 }
  ]
})
const chat2 = await api.chats.create([])
await api.chats.update(chat2.id, {
  title: '一般讨论',
  messages: [{ id: 'g1', role: 'assistant', content: '可以继续提问。', createdAt: now - 1000 }]
})
const topic = await api.topics.add({ name: '电池健康研究', docIds: docs.slice(0, 3).map((doc) => doc.id) })
const inbox = await api.inbox.add({
  kind: 'text',
  content: '这是一条很长的 Inbox 内容，用于观察列表高度与布局。'.repeat(30)
})
await api.inbox.apply(inbox.id, { inboxId: inbox.id, type: 'tag', value: '待读' })
await api.inbox.update(inbox.id, { archived: false })
await api.views.add('我的未读视图', { status: 'unread', viewMode: 'table', sorts: [{ key: 'title', dir: 'asc' }] })
return { docs: docs.map((doc) => doc.id), chat1: chat1.id, chat2: chat2.id, topic: topic.id }
