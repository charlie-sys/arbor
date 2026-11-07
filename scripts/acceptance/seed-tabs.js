
const api = window.api
const doc = await api.library.importPdf('C:/Users/18116/AppData/Local/Temp/zotagent-tabs/test.pdf', '页签测试文献')
await api.library.setText(doc.id, ['Hello'], { title: '页签测试文献', authors: '作者' })
return { doc: doc.id }
