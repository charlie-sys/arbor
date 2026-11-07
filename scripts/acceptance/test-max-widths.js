function drag(element, deltaX) {
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }))
  element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + deltaX, clientY: y, pointerId: 1 }))
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + deltaX, clientY: y, pointerId: 1 }))
}
const sidebarResizer = document.querySelector('.sidebar-host + .pane-resizer')
if (sidebarResizer) drag(sidebarResizer, 300)
await new Promise((resolve) => setTimeout(resolve, 400))
const panelResizer = document.querySelector('.reader-body > .pane-resizer')
if (panelResizer) drag(panelResizer, -500)
await new Promise((resolve) => setTimeout(resolve, 500))
const panel = document.querySelector('.reader-panel')
const pdf = document.querySelector('.reader-pdf')
const sidebar = document.querySelector('.sidebar-host')
const buttons = Array.from(document.querySelectorAll('.panel-tab'))
const rect = panel?.getBoundingClientRect()
return {
  viewport: window.innerWidth,
  sidebar: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
  panel: rect ? Math.round(rect.width) : null,
  pdf: pdf ? Math.round(pdf.getBoundingClientRect().width) : null,
  rows: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
  overflowed: rect ? Math.max(...buttons.map((button) => button.getBoundingClientRect().right)) > rect.right + 1 : null,
  scrollWidth: document.documentElement.scrollWidth
}
