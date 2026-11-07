const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rows = () => Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('.cell-title-text')?.innerText.trim() ?? '')
const clickButton = (text, titlePart) =>
  Array.from(document.querySelectorAll('button')).find(
    (button) => (text && button.innerText.trim() === text) || (titlePart && (button.title || '').includes(titlePart))
  )

const before = await window.api.library.getState()
const savedView = before.savedViews.find((view) => view.name === 'P1-2 属性视图')
const prop = before.properties.find((item) => item.name === '研究方法')
const rct = prop?.options?.find((option) => option.name === 'RCT')

// 1. 重启后点击左侧保存视图
const viewItem = Array.from(document.querySelectorAll('.collection-item')).find((el) => el.innerText.includes('P1-2 属性视图'))
viewItem?.click()
await sleep(800)
const tableApplied = Boolean(document.querySelector('table'))
const appliedRows = rows()
const filterBar = document.querySelector('.property-filter-bar')
const filterSelect = filterBar?.querySelector('select')
const appliedFilterValue = filterSelect?.value ?? null
const propHeaders = Array.from(document.querySelectorAll('thead th')).map((th) => th.innerText.replace(/[↑↓↕]/g, '').trim())

// 2. 删除属性不破坏文献数据
const temp = await window.api.properties.add({ name: '临时属性', type: 'text' })
const alpha = before.documents.find((doc) => doc.title === 'Alpha 文献')
await window.api.library.update(alpha.id, {
  propertyValues: { ...(alpha.propertyValues ?? {}), [temp.id]: '待删除' }
})
await sleep(300)

window.confirm = () => true
clickButton('', '文献属性')?.click()
await sleep(400)
const manager = document.querySelector('.property-manager')
const tempItem = Array.from(manager?.querySelectorAll('.property-item') ?? []).find((el) => el.innerText.includes('临时属性'))
Array.from(tempItem?.querySelectorAll('button') ?? []).find((button) => button.innerText.includes('删除'))?.click()
await sleep(800)
clickButton('完成')?.click()
await sleep(300)

const after = await window.api.library.getState()
const alphaAfter = after.documents.find((doc) => doc.id === alpha.id)

return {
  savedViewPersisted: Boolean(savedView),
  savedViewConfig: savedView ? { propertyFilters: savedView.config.propertyFilters, sorts: savedView.config.sorts } : null,
  viewItemFound: Boolean(viewItem),
  tableApplied,
  appliedRows,
  appliedFilterValue,
  rctOptionId: rct?.id ?? null,
  filterRestored: Boolean(rct && appliedFilterValue === rct.id),
  propHeaders,
  deletion: {
    tempPropertyRemoved: !after.properties.some((item) => item.name === '临时属性'),
    docCountBefore: before.documents.length,
    docCountAfter: after.documents.length,
    titlesAfter: after.documents.map((doc) => doc.title),
    tempValueRemoved: !alphaAfter?.propertyValues?.[temp.id],
    otherValuesKept:
      alphaAfter?.propertyValues?.[prop.id] === alpha.propertyValues?.[prop.id] &&
      alphaAfter?.propertyValues?.['93195748-999c-4e6b-bf3e-907bd1604c43'] === 10
  }
}
