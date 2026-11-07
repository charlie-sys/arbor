
function mainWidth(){ return Math.round(document.querySelector('.main-area')?.getBoundingClientRect().width ?? 0) }
const visibleWidth = mainWidth()
document.querySelector('.sidebar-hide')?.click()
await new Promise((r)=>setTimeout(r,400))
const hidden = {
  host: Boolean(document.querySelector('.sidebar-host')),
  reveal: Boolean(document.querySelector('.sidebar-reveal')),
  edge: Boolean(document.querySelector('.sidebar-edge')),
  main: mainWidth()
}
const edge = document.querySelector('.sidebar-edge')
edge?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
edge?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
await new Promise((r)=>setTimeout(r,500))
const drawer = document.querySelector('.sidebar-host.drawer')
const opened = {
  drawer: Boolean(drawer),
  width: drawer ? Math.round(drawer.getBoundingClientRect().width) : null,
  main: mainWidth(),
  position: drawer ? getComputedStyle(drawer).position : null
}
drawer?.querySelector('.sidebar-hide')?.click()
await new Promise((r)=>setTimeout(r,400))
const closed = {
  drawer: Boolean(document.querySelector('.sidebar-host.drawer')),
  edge: Boolean(document.querySelector('.sidebar-edge')),
  main: mainWidth()
}
return { visibleWidth, hidden, opened, closed }
