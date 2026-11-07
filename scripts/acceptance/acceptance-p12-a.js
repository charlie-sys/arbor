const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rows = () => Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('.cell-title-text')?.innerText.trim() ?? '')
const setNative = (el, value) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const clickButton = (text, titlePart) =>
  Array.from(document.querySelectorAll('button')).find(
    (button) => (text && button.innerText.trim() === text) || (titlePart && (button.title || '').includes(titlePart))
  )

// 1. 切到表格视图
clickButton('', '表格视图')?.click()
await sleep(400)
const table = document.querySelector('table')
const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.innerText.replace(/[↑↓↕]/g, '').trim())
const propNameIndex = headers.indexOf('研究方法')
const findRow = (title) => Array.from(table.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('.cell-title-text')?.innerText.trim() === title)

const setPropertySelect = (title, optionName) => {
  const row = findRow(title)
  const select = row?.querySelectorAll('td')[propNameIndex]?.querySelector('select')
  const option = Array.from(select?.options ?? []).find((item) => item.text === optionName)
  if (!select || !option) return false
  setNative(select, option.value)
  return true
}
const sets = [
  setPropertySelect('Alpha 文献', 'RCT'),
  setPropertySelect('Beta 文献', '观察'),
  setPropertySelect('大纲测试文献', 'RCT')
]
await sleep(700)

// 2. 属性筛选 RCT
const filterBar = document.querySelector('.property-filter-bar')
const propFilter = filterBar?.querySelector('select')
const rctOption = Array.from(propFilter?.options ?? []).find((option) => option.text === 'RCT')
setNative(propFilter, rctOption?.value ?? '')
await sleep(400)
const filteredRows = rows()

// 3. 组合排序：属性筛选 + 标题升序
const titleHeader = Array.from(table.querySelectorAll('thead th')).find((th) => th.innerText.trim().startsWith('标题'))
titleHeader.click()
await sleep(350)
const filteredSortedRows = rows()
const expectedSorted = [...filteredRows].sort((a, b) => a.localeCompare(b, 'zh-CN'))

// 4. 清除属性筛选
setNative(propFilter, '')
await sleep(300)

// 5. 通过属性管理入口创建数字属性
clickButton('', '文献属性')?.click()
await sleep(300)
const modal = document.querySelector('.property-manager')
const nameInput = modal?.querySelector('input[placeholder="例如：研究方法"]')
setNative(nameInput, '引用数')
const typeSelect = modal?.querySelector('.property-form select')
setNative(typeSelect, 'number')
await sleep(100)
Array.from(modal.querySelectorAll('button')).find((button) => button.innerText.includes('新建属性'))?.click()
await sleep(600)
Array.from(modal.querySelectorAll('button')).find((button) => button.innerText.trim() === '完成')?.click()
await sleep(400)
const headersAfter = Array.from(document.querySelectorAll('thead th')).map((th) => th.innerText.replace(/[↑↓↕]/g, '').trim())
const numIndex = headersAfter.indexOf('引用数')

const setNumber = (title, value) => {
  const row = findRow(title)
  const input = row?.querySelectorAll('td')[numIndex]?.querySelector('input')
  if (!input) return false
  input.focus()
  input.value = value
  input.blur()
  return true
}
const numSets = [setNumber('Alpha 文献', '10'), setNumber('Beta 文献', '2'), setNumber('大纲测试文献', '5')]
await sleep(900)

// 6. 数字属性升序排序
Array.from(document.querySelectorAll('thead th'))
  .find((th) => th.innerText.trim().startsWith('引用数'))
  ?.click()
await sleep(400)
const numericAscRows = rows()

// 7. 复选 RCT + 数字排序后保存视图
const filterBar2 = document.querySelector('.property-filter-bar')
const propFilter2 = filterBar2?.querySelector('select')
const rctOption2 = Array.from(propFilter2?.options ?? []).find((option) => option.text === 'RCT')
setNative(propFilter2, rctOption2?.value ?? '')
await sleep(400)
const comboRows = rows()

window.prompt = () => 'P1-2 属性视图'
clickButton('保存视图')?.click()
await sleep(700)
const state = await window.api.library.getState()
const saved = state.savedViews.find((view) => view.name === 'P1-2 属性视图')
const prop = state.properties.find((item) => item.name === '研究方法')
const viewInSidebar = Array.from(document.querySelectorAll('.collection-item')).some((el) => el.innerText.includes('P1-2 属性视图'))

return {
  seeds: sets,
  numberSeeds: numSets,
  propertyColumns: headers,
  filterBarVisible: Boolean(filterBar),
  filteredRows,
  filteredSortedRows,
  expectedSorted,
  numericAscRows,
  comboRows,
  viewInSidebar,
  savedView: saved
    ? { name: saved.name, propertyFilters: saved.config.propertyFilters, sorts: saved.config.sorts, viewMode: saved.config.viewMode }
    : null,
  propertyFilterKeyMatches: Boolean(prop && saved?.config.propertyFilters?.[prop.id]),
  modalCreatedProperty: state.properties.some((item) => item.name === '引用数')
}
