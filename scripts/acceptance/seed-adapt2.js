
const api = window.api
const doc = await api.library.importDocument('C:/Users/18116/AppData/Local/Temp/zotagent-adapt2/test.pdf', '自适应测试')
await api.library.setText(doc.id, ['Hello'], { title: '自适应测试', authors: '作者' })
return { doc: doc.id }
