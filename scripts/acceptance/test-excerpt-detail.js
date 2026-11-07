Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('摘录详情测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1500))
Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.trim().startsWith('摘录'))?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const item = document.querySelector('.excerpt-item')
item?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const modal = document.querySelector('.excerpt-detail-modal')
return {
  itemFound: Boolean(item),
  modalShown: Boolean(modal),
  katex: modal?.querySelectorAll('.katex').length ?? 0,
  heading: modal?.querySelector('h3')?.innerText ?? null,
  hasQuote: Boolean(modal?.querySelector('.excerpt-detail-quote')),
  hasFullAnswer: modal?.innerText.includes('完整回答') ?? false,
  hasList: Boolean(modal?.querySelector('ul li')),
  buttons: Array.from(modal?.querySelectorAll('.modal-actions button') ?? []).map((button) => button.innerText.trim())
}
