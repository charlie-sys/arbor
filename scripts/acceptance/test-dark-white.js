Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('Inbox'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
document.querySelector('.inbox-item')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const modal = document.querySelector('.inbox-editor-modal')
const textarea = modal?.querySelector('textarea')
const preview = modal?.querySelector('.inbox-editor-preview')
const colors = {
  modalBg: modal ? getComputedStyle(modal).backgroundColor : null,
  modalColor: modal ? getComputedStyle(modal).color : null,
  textareaBg: textarea ? getComputedStyle(textarea).backgroundColor : null,
  textareaColor: textarea ? getComputedStyle(textarea).color : null,
  previewBg: preview ? getComputedStyle(preview).backgroundColor : null,
  previewColor: preview ? getComputedStyle(preview).color : null
}
const whiteElements = Array.from(document.querySelectorAll('*'))
  .filter((element) => {
    const style = getComputedStyle(element)
    return (
      style.backgroundColor === 'rgb(255, 255, 255)' &&
      element.getBoundingClientRect().width > 0 &&
      !['IMG', 'CANVAS', 'SVG', 'PATH'].includes(element.tagName)
    )
  })
  .map((element) => element.className || element.tagName)
  .slice(0, 25)
return { theme: document.documentElement.getAttribute('data-theme'), colors, whiteCount: whiteElements.length, whiteElements }
