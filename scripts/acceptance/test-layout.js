function drag(element, deltaX) {
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }))
  element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + deltaX, clientY: y, pointerId: 1 }))
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + deltaX, clientY: y, pointerId: 1 }))
}

const initialSidebar = Math.round(document.querySelector('.sidebar-host')?.getBoundingClientRect().width ?? 0)
const sidebarResizer = document.querySelector('.sidebar-host + .pane-resizer')
if (sidebarResizer) drag(sidebarResizer, 50)
await new Promise((resolve) => setTimeout(resolve, 400))
const resizedSidebar = Math.round(document.querySelector('.sidebar-host')?.getBoundingClientRect().width ?? 0)

document.querySelector('.sidebar-hide')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const hidden = {
  sidebar: Boolean(document.querySelector('.sidebar-host')),
  reveal: Boolean(document.querySelector('.sidebar-reveal'))
}
document.querySelector('.sidebar-reveal')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const revealedWidth = Math.round(document.querySelector('.sidebar-host')?.getBoundingClientRect().width ?? 0)

Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('布局测试文献'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1600))
const readerResizer = document.querySelector('.reader-body > .pane-resizer')
const panelBefore = Math.round(document.querySelector('.reader-panel')?.getBoundingClientRect().width ?? 0)
if (readerResizer) drag(readerResizer, -60)
await new Promise((resolve) => setTimeout(resolve, 400))
const panelAfter = Math.round(document.querySelector('.reader-panel')?.getBoundingClientRect().width ?? 0)

return {
  initialSidebar,
  resizedSidebar,
  hidden,
  revealedWidth,
  panelBefore,
  panelAfter,
  storage: {
    sidebar: window.localStorage.getItem('zotagent-sidebar-width'),
    visible: window.localStorage.getItem('zotagent-sidebar-visible'),
    panel: window.localStorage.getItem('zotagent-reader-panel-width')
  }
}
