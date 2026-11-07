const api = window.api
const pdf = 'C:/Users/18116/AppData/Local/Temp/zotagent-acceptance/test.pdf'

async function addDoc(title, year, readingStatus) {
  const doc = await api.library.importPdf(pdf, title)
  await api.library.setText(doc.id, [`${title} 第一页`, `${title} 第二页`], { title, authors: '测试作者' })
  await api.library.update(doc.id, { year, journal: '测试期刊', readingStatus })
  return doc.id
}

const alpha = await addDoc('Alpha 文献', '2024', 'unread')
const beta = await addDoc('Beta 文献', '2025', 'read')
const state = await api.library.getState()
return {
  alpha,
  beta,
  documents: state.documents.map((item) => ({ id: item.id, title: item.title, year: item.year, status: item.readingStatus }))
}
