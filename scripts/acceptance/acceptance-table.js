const tableButton = Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')
tableButton?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const table = document.querySelector('table')
const headers = table ? Array.from(table.querySelectorAll('thead th')).map((th) => th.innerText.trim()) : null
const rows = table
  ? Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim())
    )
  : null
const selects = Array.from(document.querySelectorAll('select')).map((select) => ({
  value: select.value,
  options: Array.from(select.options).map((option) => option.text)
}))
return {
  clicked: Boolean(tableButton),
  headers,
  rows,
  selects,
  body: document.body.innerText.slice(0, 1000)
}
