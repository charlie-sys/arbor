const api = window.api
const state = await api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const chat = state.chats[0]
const excerpt = await api.excerpts.add({
  docId: doc.id,
  page: 2,
  source: 'answer',
  question: '质能方程是什么？',
  answer: '质能方程为 $E=mc^2$，描述质量与能量的等价关系，其中 $c$ 为光速。'
})
let markdown = ''
let error = null
try {
  markdown = await api.agent.compose(
    chat.id,
    '仅摘录生成测试',
    '仅使用提供的摘录生成结构完整的中文文档，保留 LaTeX 公式。',
    { includeChat: false, includeNotes: false, includeExcerpts: true, excerptIds: [excerpt.id] },
    '## 一、摘录概览\n## 二、公式与含义\n## 三、结论'
  )
} catch (err) {
  error = String(err)
}
return {
  error,
  length: markdown.length,
  headingCount: (markdown.match(/^##\s/gm) || []).length,
  hasQuestion: markdown.includes('质能方程'),
  hasFormula: /E\s*=\s*mc\^2/.test(markdown),
  excerpt: markdown.slice(0, 900)
}
