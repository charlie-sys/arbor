function drag(element, deltaX) {
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }))
  element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + deltaX, clientY: y, pointerId: 1 }))
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + deltaX, clientY: y, pointerId: 1 }))
}
function panelWidth() {
  return Math.round(document.querySelector('.reader-panel')?.getBoundingClientRect().width ?? 0)
}
const resizer = document.querySelector('.reader-body > .pane-resizer')
const before = panelWidth()
if (resizer) drag(resizer, -100)
await new Promise((resolve) => setTimeout(resolve, 400))
const afterDrag = panelWidth()
const storedRatio = window.localStorage.getItem('zotagent-reader-panel-ratio-v3')
window.resizeTo(1427, 900)
await new Promise((resolve) => setTimeout(resolve, 800))
const afterResizeBack = panelWidth()
return { before, afterDrag, storedRatio, afterResizeBack, viewport: window.innerWidth }
