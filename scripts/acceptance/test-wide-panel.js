const beforeWidth = window.innerWidth
window.resizeTo(1700, 1000)
await new Promise((resolve) => setTimeout(resolve, 800))
const resizedWidth = window.innerWidth
Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('宽屏测试文献'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1500))
const panel = document.querySelector('.reader-panel')
const panelRect = panel?.getBoundingClientRect()
const buttons = Array.from(document.querySelectorAll('.panel-tab'))
const maxRight = Math.max(...buttons.map((button) => button.getBoundingClientRect().right))
const rows = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size
return {
  beforeWidth,
  resizedWidth,
  panelWidth: panelRect ? Math.round(panelRect.width) : null,
  rows,
  overflowed: panelRect ? maxRight > panelRect.right + 1 : null,
  tabCount: buttons.length,
  storedV2: window.localStorage.getItem('zotagent-reader-panel-width-v2')
}
