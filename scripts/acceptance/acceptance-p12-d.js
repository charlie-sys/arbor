const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clickButton = (text, titlePart) =>
  Array.from(document.querySelectorAll('button')).find(
    (button) => (text && button.innerText.trim() === text) || (titlePart && (button.title || '').includes(titlePart))
  )
window.confirm = () => true
clickButton('', '文献属性')?.click()
await sleep(500)
const manager = document.querySelector('.property-manager')
const item = Array.from(manager?.querySelectorAll('.property-item') ?? []).find((el) => el.innerText.includes('临时属性'))
Array.from(item?.querySelectorAll('button') ?? []).find((button) => button.innerText.includes('删除'))?.click()
await sleep(800)
Array.from(manager.querySelectorAll('button')).find((button) => button.innerText.trim() === '完成')?.click()
await sleep(300)
const state = await window.api.library.getState()
return {
  itemFound: Boolean(item),
  properties: state.properties.map((property) => property.name),
  tempRemoved: !state.properties.some((property) => property.name === '临时属性'),
  documents: state.documents.map((doc) => doc.title),
  docCount: state.documents.length,
  alphaKept: state.documents.find((doc) => doc.title === 'Alpha 文献')?.propertyValues ?? null,
  filterBarLabels: Array.from(document.querySelectorAll('.property-filter > span')).map((el) => el.innerText)
}
