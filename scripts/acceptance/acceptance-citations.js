const nav = Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))
nav?.click()
await new Promise((resolve) => setTimeout(resolve, 900))

const toggles = Array.from(document.querySelectorAll('.citation-toggle'))
const toggleTexts = toggles.map((button) => button.innerText.trim())
toggles[0]?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const citationItems = Array.from(document.querySelectorAll('.citation-item')).map((button) => ({
  text: button.innerText.trim(),
  title: button.title
}))
const inlineLinks = Array.from(document.querySelectorAll('a'))
  .filter((anchor) => (anchor.getAttribute('href') || '').includes('zotagent:page'))
  .map((anchor) => ({ text: anchor.innerText.trim(), href: anchor.getAttribute('href') }))

const firstItem = document.querySelector('.citation-item')
firstItem?.click()
await new Promise((resolve) => setTimeout(resolve, 1400))
const pageInput = document.querySelector('.page-input')?.value ?? null

return {
  toggleCount: toggles.length,
  toggleTexts,
  citationItems,
  inlineLinks,
  pageAfterCitationClick: pageInput,
  body: document.body.innerText.slice(0, 1200)
}
