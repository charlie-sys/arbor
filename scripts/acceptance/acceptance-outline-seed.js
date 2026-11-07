const api = window.api
const doc = await api.library.importPdf('C:/Users/18116/AppData/Local/Temp/zotagent-acceptance/test2.pdf', '大纲测试文献')
await api.library.setText(doc.id, ['Page One', 'Page Two'], { title: '大纲测试文献', authors: '测试作者' })
await api.library.update(doc.id, { year: '2023', journal: '测试期刊', readingStatus: 'unread' })
const highlight = await api.highlights.add({
  docId: doc.id,
  page: 2,
  color: 'pink',
  text: 'Page Two',
  note: '第二页高亮',
  rects: [{ x: 10, y: 20, width: 100, height: 16 }]
})
return { docId: doc.id, highlightId: highlight.id }
