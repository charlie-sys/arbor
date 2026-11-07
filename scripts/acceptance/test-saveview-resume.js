const saveButton = Array.from(document.querySelectorAll('button')).find((button) => button.innerText.trim() === '保存视图')
saveButton?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const modal = document.querySelector('.save-view-modal')
const input = modal?.querySelector('input')
if (input) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '回归视图')
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const confirmButton = Array.from(modal?.querySelectorAll('button') ?? []).find((button) => button.innerText.trim() === '保存')
confirmButton?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
const state = await window.api.library.getState()

const tableButton = Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')
tableButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const docButton = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('Issue Doc A'))
docButton?.click()
await new Promise((resolve) => setTimeout(resolve, 1400))
const resumeModal = document.querySelector('.resume-modal')
const resumeText = resumeModal?.innerText ?? null
const continueButton = Array.from(resumeModal?.querySelectorAll('button') ?? []).find((button) => button.innerText.includes('继续阅读'))
continueButton?.click()
await new Promise((resolve) => setTimeout(resolve, 600))

return {
  saveModalShown: Boolean(modal),
  savedViews: state.savedViews.map((item) => item.name),
  sidebarHasView: document.body.innerText.includes('回归视图'),
  resumePromptShown: Boolean(resumeModal),
  resumeText,
  continuedPage: document.querySelector('.page-input')?.value ?? null
}
