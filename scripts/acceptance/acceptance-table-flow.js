const table = document.querySelector('table')
function readRows() {
  return Array.from(table.querySelectorAll('tbody tr')).map((tr) => {
    const cells = tr.querySelectorAll('td')
    const statusSelect = tr.querySelector('td select')
    return { title: cells[0]?.innerText.trim() ?? '', status: statusSelect?.value ?? null }
  })
}
const before = readRows()
const titleHeader = Array.from(table.querySelectorAll('thead th')).find((th) => th.innerText.trim().startsWith('标题'))
titleHeader.click()
await new Promise((resolve) => setTimeout(resolve, 350))
const ascending = readRows().map((row) => row.title)
titleHeader.click()
await new Promise((resolve) => setTimeout(resolve, 350))
const descending = readRows().map((row) => row.title)

const selects = Array.from(document.querySelectorAll('select'))
const statusFilter = selects.find((select) => select.options[0]?.text === '全部阅读状态')
statusFilter.value = 'read'
statusFilter.dispatchEvent(new Event('change', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 300))
const readOnly = readRows().map((row) => row.title)

statusFilter.value = 'reading'
statusFilter.dispatchEvent(new Event('change', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 300))
const readingOnly = readRows().map((row) => row.title)

statusFilter.value = 'all'
statusFilter.dispatchEvent(new Event('change', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 200))

const input = document.querySelector('input[placeholder^="搜索标题"]')
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
setter.call(input, 'zzzz')
input.dispatchEvent(new Event('input', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 300))
const emptyText = document.body.innerText.includes('当前筛选条件下没有结果')
const clearButton = Array.from(document.querySelectorAll('button')).find((button) => button.innerText.trim() === '清除筛选')
if (clearButton) clearButton.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const afterClear = readRows().map((row) => row.title)

return { before, ascending, descending, readOnly, readingOnly, emptyText, hadClearButton: Boolean(clearButton), afterClear }
