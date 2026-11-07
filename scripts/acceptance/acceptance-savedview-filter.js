const savedView = Array.from(document.querySelectorAll('.collection-item')).find((el) => el.innerText.includes('未读表格视图'))
savedView?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const table = document.querySelector('table')
const statusSelect = Array.from(document.querySelectorAll('select')).find((select) => select.options[0]?.text === '全部阅读状态')
const yearSelect = Array.from(document.querySelectorAll('select')).find((select) => select.options[0]?.text === '全部年份')
const rows = () => Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('.cell-title-text')?.innerText.trim() ?? '')
const savedViewResult = {
  clicked: Boolean(savedView),
  tableApplied: Boolean(table),
  statusValue: statusSelect?.value ?? null,
  rows: rows()
}

function setSelect(select, value) {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}
setSelect(yearSelect, '2025')
setSelect(statusSelect, 'read')
await new Promise((resolve) => setTimeout(resolve, 500))
const combo2025Read = rows()
setSelect(yearSelect, '2024')
setSelect(statusSelect, 'read')
await new Promise((resolve) => setTimeout(resolve, 500))
const combo2024Read = rows()
const emptyText = document.body.innerText.includes('当前筛选条件下没有结果')
const clearButton = Array.from(document.querySelectorAll('button')).find((button) => button.innerText.trim() === '清除筛选')
clearButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const afterClear = rows()

return { savedViewResult, combo2025Read, combo2024Read, emptyText, hadClearButton: Boolean(clearButton), afterClear }
