Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('页签测试文献'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1500))
const panel = document.querySelector('.reader-panel')
const tabs = document.querySelector('.panel-tabs')
const buttons = Array.from(document.querySelectorAll('.panel-tab'))
const panelRect = panel?.getBoundingClientRect()
const maxRight = Math.max(...buttons.map((button) => button.getBoundingClientRect().right))
const rows = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size
return {
  panelWidth: panelRect ? Math.round(panelRect.width) : null,
  tabsClientWidth: tabs?.clientWidth ?? null,
  tabsScrollWidth: tabs?.scrollWidth ?? null,
  tabCount: buttons.length,
  maxTabRight: Math.round(maxRight),
  panelRight: panelRect ? Math.round(panelRect.right) : null,
  overflowed: panelRect ? maxRight > panelRect.right + 1 : null,
  rows,
  labels: buttons.map((button) => button.innerText.trim())
}
