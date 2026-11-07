const api = window.api
const doc = await api.library.importPdf('C:/Users/18116/AppData/Local/Temp/zotagent-excerpt/test.pdf', '摘录详情测试')
await api.library.setText(doc.id, ['Hello'], { title: '摘录详情测试', authors: '作者' })
await api.excerpts.add({
  docId: doc.id,
  page: 1,
  source: '这是被引用的原文段落，用于验证详情弹层中的完整引用展示。',
  question: '这个问题包含公式：$a^2+b^2=c^2$',
  answer:
    '## 完整回答\n\n**这是一个较长的回答**，用于验证详情弹层会完整展示内容而不是截断。\n\n公式：$E=mc^2$\n\n- 要点一\n- 要点二\n- 要点三'
})
return { doc: doc.id }
