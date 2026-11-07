const palette = document.querySelector('.palette')
const input = palette?.querySelector('input')
if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 1600))
const readerOpen = Boolean(document.querySelector('.pdfViewer'))
const readerTitle = document.body.innerText.split('\n').slice(0, 30).join(' | ')

window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 1200))
const palette2 = document.querySelector('.palette')
const emptyResults = Array.from(document.querySelectorAll('.palette-item')).map((el) => el.innerText.trim().slice(0, 140))
const emptyText = palette2?.innerText.slice(0, 600) ?? ''

return { paletteWasOpen: Boolean(palette), readerOpen, readerTitle, searchReopened: Boolean(palette2), emptyResults, emptyText }
