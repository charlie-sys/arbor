const api = window.api
const longLine = '超长行内容'.repeat(120)
const content = `# 滚动测试\n\n${longLine}\n\n` + Array.from({ length: 80 }, (_, i) => `- 第 ${i + 1} 行内容`).join('\n')
const item = await api.inbox.add({ kind: 'text', content })
return { inboxId: item.id }
