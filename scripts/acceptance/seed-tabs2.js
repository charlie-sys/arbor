
const api = window.api
const doc = await api.library.importDocument('C:/Users/18116/AppData/Local/Temp/zotagent-tabs2/test.pdf', '紧凑页签测试')
await api.library.setText(doc.id, ['Hello'], { title: '紧凑页签测试', authors: '作者' })
return { doc: doc.id }
