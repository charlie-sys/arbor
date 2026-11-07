function press(key) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }))
}
press('k')
await new Promise((resolve) => setTimeout(resolve, 600))
const paletteK = document.querySelector('.palette')
const inputK = paletteK?.querySelector('input')
const kText = paletteK?.innerText.slice(0, 800) ?? ''
const kPlaceholder = inputK?.placeholder ?? null
paletteK?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 400))
if (document.querySelector('.palette')) {
  document.querySelector('.palette-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 300))
}

press('o')
await new Promise((resolve) => setTimeout(resolve, 800))
const paletteO = document.querySelector('.palette')
const inputO = paletteO?.querySelector('input')
const oPlaceholder = inputO?.placeholder ?? null
if (inputO) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(inputO, '研究方法')
  inputO.dispatchEvent(new Event('input', { bubbles: true }))
}
await new Promise((resolve) => setTimeout(resolve, 1200))
const oResults = Array.from(document.querySelectorAll('.palette-item')).map((el) => el.innerText.trim().slice(0, 120))

return {
  paletteKOpen: Boolean(paletteK),
  kPlaceholder,
  kText,
  paletteOOpen: Boolean(paletteO),
  oPlaceholder,
  oResults
}
