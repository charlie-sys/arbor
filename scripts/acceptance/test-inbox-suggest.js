const api = window.api
const inbox = await api.inbox.add({
  kind: 'text',
  content: '蛋白质折叠的深度学习方法综述：AlphaFold 与 RoseTTAFold 的对比。'
})
const before = await api.library.getState()
const countsBefore = {
  inbox: before.inbox.length,
  archived: before.inbox.filter((item) => item.archived).length,
  tags: before.tags.length,
  collections: before.collections.length,
  excerpts: before.excerpts.length,
  tasks: before.tasks.length
}
let suggestions = []
let error = null
try {
  suggestions = await api.inbox.suggest()
} catch (err) {
  error = String(err)
}
const afterSuggest = await api.library.getState()
const unchangedAfterSuggest =
  afterSuggest.inbox.find((item) => item.id === inbox.id)?.archived === false &&
  afterSuggest.excerpts.length === countsBefore.excerpts &&
  afterSuggest.tasks.length === countsBefore.tasks

let applied = null
if (suggestions.length) {
  try {
    await api.inbox.apply(inbox.id, suggestions[0])
    applied = suggestions[0]
  } catch (err) {
    error = `${error || ''} apply: ${String(err)}`
  }
}
const afterApply = await api.library.getState()
return {
  error,
  suggestions: suggestions.slice(0, 6),
  suggestionCount: suggestions.length,
  unchangedAfterSuggest,
  applied,
  archivedAfterApply: afterApply.inbox.find((item) => item.id === inbox.id)?.archived ?? null,
  countsAfter: {
    tags: afterApply.tags.length,
    collections: afterApply.collections.length,
    excerpts: afterApply.excerpts.length,
    tasks: afterApply.tasks.length
  }
}
