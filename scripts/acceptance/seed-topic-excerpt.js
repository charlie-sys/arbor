const api = window.api
const doc = await api.library.importDocument('C:/Users/18116/AppData/Local/Temp/zotagent-topic-excerpt/test.pdf', '主题摘录测试文献')
await api.library.setText(doc.id, ['Hello'], { title: '主题摘录测试文献', authors: '作者' })
const excerpt = await api.excerpts.add({
  docId: doc.id,
  page: 1,
  source: '这是主题摘录的原文引用。',
  question: '主题摘录问题：$a^2+b^2=c^2$',
  answer: '## 主题摘录回答\n\n**支持 Markdown 编辑**，公式 $E=mc^2$。'
})
const topic = await api.topics.add({ name: '摘录编辑测试主题', docIds: [doc.id] })
return { doc: doc.id, excerpt: excerpt.id, topic: topic.id }
