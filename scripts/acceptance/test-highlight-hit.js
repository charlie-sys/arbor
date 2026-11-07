const scroll = document.querySelector('.pdf-scroll')
scroll.scrollTop = 0
await new Promise((resolve) => setTimeout(resolve, 800))
const mark = document.querySelector('.pdf-highlight.hl-yellow') || document.querySelector('.pdf-highlight')
const rect = mark?.getBoundingClientRect()
const x = (rect?.left ?? 0) + (rect?.width ?? 0) / 2
const y = (rect?.top ?? 0) + (rect?.height ?? 0) / 2
const target = document.elementFromPoint(x, y)
let hit = null
const state = await window.api.library.getState()
const doc = state.documents.find((item) => item.title === '大纲测试文献')
const highlight = state.highlights.find((item) => item.docId === doc.id && item.color === 'yellow')
if (highlight) {
  const page = target?.closest('.page')
  const textLayer = page?.querySelector('.textLayer')
  const pageRect = (textLayer ?? page)?.getBoundingClientRect()
  if (pageRect) {
    const nx = (x - pageRect.left) / pageRect.width
    const ny = (y - pageRect.top) / pageRect.height
    hit = highlight.rects.map((r) => ({ nx, ny, rect: r, inside: nx >= r.x && nx <= r.x + r.width && ny >= r.y && ny <= r.y + r.height }))
  }
}
return {
  markRect: rect ? { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
  targetClass: target?.className ?? null,
  targetTag: target?.tagName ?? null,
  closestPage: target?.closest('.page')?.dataset?.pageNumber ?? null,
  hit,
  editorOpen: Boolean(document.querySelector('.highlight-editor'))
}
