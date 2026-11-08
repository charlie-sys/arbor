
const api = window.api
const doc = await api.library.importDocument('C:/Users/18116/AppData/Local/Temp/zotagent-layout/test.pdf', '布局测试文献')
await api.library.setText(doc.id, ['Hello'], { title: '布局测试文献', authors: '作者' })
return { doc: doc.id }
