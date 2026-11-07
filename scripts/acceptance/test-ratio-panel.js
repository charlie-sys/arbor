Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('比例测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1500))
function measure() {
  const panel = document.querySelector('.reader-panel')
  const rect = panel?.getBoundingClientRect()
  const buttons = Array.from(document.querySelectorAll('.panel-tab'))
  return {
    viewport: window.innerWidth,
    panel: rect ? Math.round(rect.width) : null,
    ratio: rect ? Math.round((rect.width / window.innerWidth) * 1000) / 1000 : null,
    rows: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
    labelsVisible: Array.from(document.querySelectorAll('.tab-label')).filter((el) => getComputedStyle(el).display !== 'none').length,
    overflowed: rect ? Math.max(...buttons.map((button) => button.getBoundingClientRect().right)) > rect.right + 1 : null
  }
}
const before = measure()
window.resizeTo(1686, 1000)
await new Promise((resolve) => setTimeout(resolve, 900))
const afterResize = measure()
return { before, afterResize, storedRatio: window.localStorage.getItem('zotagent-reader-panel-ratio-v3') }
