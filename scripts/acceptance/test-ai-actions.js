const api = window.api
const state = await api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const target = state.documents.find((item) => item.title === 'Alpha 文献')

async function run(action, text, extra = {}) {
  try {
    const result = await api.actions.run({ action, text, page: 1, docId: doc.id, ...extra })
    return { ok: true, action, model: result.model, length: result.content.length, content: result.content.slice(0, 400) }
  } catch (error) {
    return { ok: false, action, error: String(error) }
  }
}

const summarize = await run('summarize', 'Page Two')
const translate = await run('translate', 'Page Two is the second page of this document.')
const formula = await run('explain-formula', 'E = mc^2')
const compare = await run('compare', 'Page One', { targetDocId: target.id })

return {
  summarize,
  translate,
  formula,
  compare,
  formulaKeepsLatex: formula.ok && /E\s*=\s*mc\^?2|\\\(|\$/.test(formula.content),
  compareMentionsTarget: compare.ok && compare.content.includes('Alpha')
}
