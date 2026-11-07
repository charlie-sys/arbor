const agentTab = Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.includes('AI 助手'))
agentTab?.click()
await new Promise((resolve) => setTimeout(resolve, 500))
const newChat = Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('新建对话'))
newChat?.click()
await new Promise((resolve) => setTimeout(resolve, 1200))

const chips = Array.from(document.querySelectorAll('.ctx-chip')).map((button) => ({
  text: button.innerText.trim(),
  active: button.className.includes('active'),
  disabled: button.disabled,
  title: button.title
}))
const noneChip = Array.from(document.querySelectorAll('.ctx-chip')).find((button) => button.innerText.includes('不引用'))
noneChip?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const hintNone = document.querySelector('.composer-hint')?.innerText ?? null
const pageChip = Array.from(document.querySelectorAll('.ctx-chip')).find((button) => button.innerText.includes('当前页'))
pageChip?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const hintPage = document.querySelector('.composer-hint')?.innerText ?? null
const selectionChip = Array.from(document.querySelectorAll('.ctx-chip')).find((button) => button.innerText.includes('选中段落'))
selectionChip?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const hintSelection = document.querySelector('.composer-hint')?.innerText ?? null

return {
  clickedNewChat: Boolean(newChat),
  chips,
  hintNone,
  hintPage,
  hintSelection,
  body: document.body.innerText.slice(0, 900)
}
