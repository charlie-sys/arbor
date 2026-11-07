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
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
function effectiveBg(element) {
  let node = element
  while (node) {
    const bg = getComputedStyle(node).backgroundColor
    const parsed = parseRgb(bg)
    if (parsed && parsed.a > 0.1) return parsed
    node = node.parentElement
  }
  return parseRgb(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 }
}
function scan() {
  return Array.from(document.querySelectorAll('*'))
    .filter((element) => {
      const hasText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      )
      return hasText && element.getBoundingClientRect().width > 0
    })
    .map((element) => {
      const fg = parseRgb(getComputedStyle(element).color)
      const bg = effectiveBg(element)
      if (!fg) return null
      const ratio = contrast(fg, bg)
      return { cls: typeof element.className === 'string' ? element.className : element.tagName, ratio: Math.round(ratio * 10) / 10 }
    })
    .filter((item) => item && item.ratio < 2)
    .slice(0, 15)
}
const results = {}
results.reader = scan()
for (const name of ['文献库', 'AI 对话', 'Inbox', '设置']) {
  Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes(name))?.click()
  await new Promise((resolve) => setTimeout(resolve, 600))
  results[name] = scan()
}
return results
