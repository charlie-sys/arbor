const nav = Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('文献库'))
nav?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
const tableButton = Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')
tableButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const rows = Array.from(document.querySelectorAll('tbody tr')).map((tr) => ({
  title: tr.querySelector('.cell-title-text')?.innerText.trim() ?? '',
  status: tr.querySelector('select')?.value ?? null
}))
return { rows }
