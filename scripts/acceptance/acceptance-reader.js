const title = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('Alpha 文献'))
title?.click()
await new Promise((resolve) => setTimeout(resolve, 2000))
const tabs = Array.from(document.querySelectorAll('.panel-tab')).map((el) => el.innerText.trim())
const selects = Array.from(document.querySelectorAll('select')).map((select) => ({
  cls: select.className,
  value: select.value,
  options: Array.from(select.options).map((option) => option.text)
}))
return {
  clicked: Boolean(title),
  tabs,
  selects,
  body: document.body.innerText.slice(0, 2000),
  canvasCount: document.querySelectorAll('.pdfViewer canvas').length,
  panelClassButtons: Array.from(document.querySelectorAll('.panel-tabs button')).map((el) => el.innerText.trim())
}
