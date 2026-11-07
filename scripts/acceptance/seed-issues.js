const api = window.api
const a = await api.library.importPdf('C:/Users/18116/AppData/Local/Temp/zotagent-issue-test/test2.pdf', 'Issue Doc A')
await api.library.setText(a.id, ['Page One', 'Page Two'], { title: 'Issue Doc A', authors: '作者 A' })
await api.library.update(a.id, {
  lastPage: 2,
  readingStatus: 'reading',
  notes: '## 阅读笔记\n\n质能方程：$E=mc^2$\n\n**加粗文本**与行内代码 `x^2`。'
})
const excerptA = await api.excerpts.add({
  docId: a.id,
  page: 1,
  source: 'selection A',
  question: 'A 的问题：$a^2+b^2=c^2$',
  answer: 'A 的答案：**勾股定理** $a^2+b^2=c^2$'
})

const b = await api.library.importPdf('C:/Users/18116/AppData/Local/Temp/zotagent-issue-test/test.pdf', 'Issue Doc B')
await api.library.setText(b.id, ['Hello ZotAgent'], { title: 'Issue Doc B', authors: '作者 B' })
await api.library.update(b.id, { notes: 'Issue Doc B 的独立笔记' })
const excerptB = await api.excerpts.add({
  docId: b.id,
  page: 1,
  source: 'selection B',
  question: 'B 的问题',
  answer: 'B 的答案'
})

const inbox = await api.inbox.add({ kind: 'text', content: '这是一条用于测试 Inbox 标签与高度限制的内容。'.repeat(20) })
await api.inbox.apply(inbox.id, { inboxId: inbox.id, type: 'tag', value: 'Inbox标签' })
await api.inbox.update(inbox.id, { archived: false })

const chat = await api.chats.create([a.id])
const now = Date.now()
await api.chats.update(chat.id, {
  title: '公式回归测试',
  messages: [
    { id: 'm1', role: 'user', content: '请展示多种公式写法。', createdAt: now - 2000 },
    {
      id: 'm2',
      role: 'assistant',
      content:
        '行内公式 \\(x^2+y^2=z^2\\)。\n\n方括号公式：\n\\[\\int_0^1 x^2 dx = \\frac{1}{3}\\]\n\n双美元公式：\n$$E=mc^2$$\n\n环境写法：\n\\begin{align}a+b&=c\\\\n d+e&=f\\end{align}',
      createdAt: now - 1000
    }
  ]
})

return { docA: a.id, docB: b.id, excerptA: excerptA.id, excerptB: excerptB.id, inbox: inbox.id, chat: chat.id }
