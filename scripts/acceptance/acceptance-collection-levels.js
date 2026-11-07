const api = window.api
const a = await api.collections.add('三级A')
const b = await api.collections.add('三级B', a.id)
const c = await api.collections.add('三级C', b.id)
let state = await api.library.getState()
const createdParent = state.collections.find((item) => item.id === c.id)?.parentId ?? null
await api.collections.remove(b.id)
state = await api.library.getState()
const afterB = state.collections.find((item) => item.id === c.id)?.parentId ?? null
await api.collections.remove(a.id)
state = await api.library.getState()
const afterA = state.collections.find((item) => item.id === c.id)?.parentId ?? null
await api.collections.remove(c.id)
return { createdParent, expectedAfterB: a.id, afterB, afterA }
