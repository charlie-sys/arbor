Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('自适应测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1500))
const panel = document.querySelector('.reader-panel')
const panelRect = panel?.getBoundingClientRect()
const buttons = Array.from(document.querySelectorAll('.panel-tab'))
const labels = Array.from(document.querySelectorAll('.tab-label'))
const maxRight = Math.max(...buttons.map((button) => button.getBoundingClientRect().right))
return {
  panelWidth: panelRect ? Math.round(panelRect.width) : null,
  rows: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
  overflowed: panelRect ? maxRight > panelRect.right + 1 : null,
  labelsVisible: labels.filter((label) => getComputedStyle(label).display !== 'none').length,
  labelCount: labels.length
}
