const nav = Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))
nav?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const pageRefs = Array.from(document.querySelectorAll('a.page-ref')).map((anchor) => ({
  text: anchor.innerText.trim(),
  href: anchor.getAttribute('href'),
  cls: anchor.className
}))
pageRefs.length && document.querySelector('a.page-ref').click()
await new Promise((resolve) => setTimeout(resolve, 1400))
const pageAfterInlineClick = document.querySelector('.page-input')?.value ?? null
const tabs = Array.from(document.querySelectorAll('.panel-tab')).map((el) => el.innerText.trim())
return {
  pageRefs,
  pageAfterInlineClick,
  readerOpen: Boolean(document.querySelector('.pdfViewer')),
  tabs,
  body: document.body.innerText.slice(0, 700)
}
