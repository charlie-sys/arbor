const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clickButton = (text, titlePart) =>
  Array.from(document.querySelectorAll('button')).find(
    (button) => (text && button.innerText.trim() === text) || (titlePart && (button.title || '').includes(titlePart))
  )
const setNative = (el, value) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

const before = await window.api.library.getState()
const alphaBefore = before.documents.find((doc) => doc.title === 'Alpha 文献')

// 1. 通过属性管理入口新建文本属性
clickButton('', '文献属性')?.click()
await sleep(400)
let manager = document.querySelector('.property-manager')
setNative(manager?.querySelector('input[placeholder="例如：研究方法"]'), '临时属性')
setNative(manager?.querySelector('.property-form select'), 'text')
await sleep(100)
Array.from(manager.querySelectorAll('button')).find((button) => button.innerText.includes('新建属性'))?.click()
await sleep(700)
Array.from(manager.querySelectorAll('button')).find((button) => button.innerText.trim() === '完成')?.click()
await sleep(500)

// 2. 在表格中为 Alpha 填写该属性值
const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.innerText.replace(/[↑↓↕]/g, '').trim())
const tempIndex = headers.indexOf('临时属性')
const findRow = (title) =>
  Array.from(document.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('.cell-title-text')?.innerText.trim() === title)
const input = findRow('Alpha 文献')?.querySelectorAll('td')[tempIndex]?.querySelector('input')
input?.focus()
input.value = '待删除'
input.blur()
await sleep(800)

const afterValue = await window.api.library.getState()
const tempProp = afterValue.properties.find((item) => item.name === '临时属性')
const valueSaved = Boolean(tempProp && afterValue.documents.find((doc) => doc.id === alphaBefore.id)?.propertyValues?.[tempProp.id])

// 3. 通过属性管理入口删除该属性
window.confirm = () => true
clickButton('', '文献属性')?.click()
await sleep(400)
manager = document.querySelector('.property-manager')
const tempItem = Array.from(manager?.querySelectorAll('.property-item') ?? []).find((el) => el.innerText.includes('临时属性'))
const deleteButton = Array.from(tempItem?.querySelectorAll('button') ?? []).find((button) => button.innerText.includes('删除'))
deleteButton?.click()
await sleep(800)
Array.from(manager.querySelectorAll('button')).find((button) => button.innerText.trim() === '完成')?.click()
await sleep(300)

const after = await window.api.library.getState()
const alphaAfter = after.documents.find((doc) => doc.id === alphaBefore.id)

return {
  createdViaManager: Boolean(tempProp),
  valueSavedBeforeDelete: valueSaved,
  deleteButtonFound: Boolean(deleteButton),
  tempPropertyRemoved: !after.properties.some((item) => item.name === '临时属性'),
  docCountBefore: before.documents.length,
  docCountAfter: after.documents.length,
  titlesAfter: after.documents.map((doc) => doc.title),
  tempValueRemoved: Boolean(tempProp) && !alphaAfter?.propertyValues?.[tempProp.id],
  otherValuesKept: alphaAfter?.propertyValues?.['468cb1ee-e88a-4929-bd7c-e15e3fc0de92'] === '41bfc975-3b0c-4f24-8c3c-6d81a8efba38',
  numberValueKept: alphaAfter?.propertyValues?.['93195748-999c-4e6b-bf3e-907bd1604c43'] === 10
}
