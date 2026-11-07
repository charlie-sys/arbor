const api = window.api
const item = await api.inbox.add({
  kind: 'text',
  content: '## 带附件的笔记\n\n这是一条用于测试图片附件与 ZIP 导出的内容。\n\n公式 $E=mc^2$'
})
return { inboxId: item.id }
