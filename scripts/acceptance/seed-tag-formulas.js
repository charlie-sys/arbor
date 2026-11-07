const api = window.api
const state = await api.library.getState()
const docA = state.documents.find((item) => item.title === 'Issue Doc A')
await api.library.update(docA.id, {
  notes:
    '## 编号公式\n\n行内编号：$h_t=Ah_{t-1}+Bx_t \\tag{4}$\n\n显示编号：\n\n$$\\mathrm{RMSE}=\\sqrt{\\frac{1}{n}\\sum_{t=1}^{n} x_t^2} \\tag{11}$$'
})
const chat = await api.chats.create([docA.id])
const now = Date.now()
await api.chats.update(chat.id, {
  title: '编号公式测试',
  messages: [
    { id: 't1', role: 'user', content: '请展示带编号的公式。', createdAt: now - 2000 },
    {
      id: 't2',
      role: 'assistant',
      content:
        '行内编号：$h_t=Ah_{t-1}+Bx_t \\tag{4}$。\n\n显示编号：\n\n$$\\mathrm{RMSE}=\\sqrt{\\frac{1}{n}\\sum_{t=1}^{n} x_t^2} \\tag{11}$$\n\n再一个：$\\bar{A}=\\exp(\\Delta A) \\tag{6}$。',
      createdAt: now - 1000
    }
  ]
})
return { docA: docA.id, chat: chat.id }
