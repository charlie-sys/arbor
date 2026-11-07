function parseRgb(value) {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (!match) return null
  const parts = match[1].split(',').map((part) => Number(part.trim()))
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
}
function luminance(color) {
  const channel = (value) => {
    const n = value / 255
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}
function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100
}
function effectiveBg(element) {
  let node = element
  while (node) {
    const parsed = parseRgb(getComputedStyle(node).backgroundColor)
    if (parsed && parsed.a > 0.1) return parsed
    node = node.parentElement
  }
  return parseRgb(getComputedStyle(document.body).backgroundColor)
}
const docTitle = document.querySelector('.doc-title')
const library = docTitle
  ? {
      color: getComputedStyle(docTitle).color,
      bg: getComputedStyle(docTitle.closest('.doc-card') ?? docTitle).backgroundColor,
      ratio: contrast(parseRgb(getComputedStyle(docTitle).color), effectiveBg(docTitle))
    }
  : null

Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('Issue Doc A'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1500))
const readerTitle = document.querySelector('.reader-title')
const reader = readerTitle
  ? {
      color: getComputedStyle(readerTitle).color,
      ratio: contrast(parseRgb(getComputedStyle(readerTitle).color), effectiveBg(readerTitle))
    }
  : null
const tabCount = document.querySelector('.tab-count')
const tab = tabCount
  ? {
      color: getComputedStyle(tabCount).color,
      bg: getComputedStyle(tabCount).backgroundColor,
      ratio: contrast(parseRgb(getComputedStyle(tabCount).color), effectiveBg(tabCount))
    }
  : null

return { theme: document.documentElement.getAttribute('data-theme'), library, reader, tab }
