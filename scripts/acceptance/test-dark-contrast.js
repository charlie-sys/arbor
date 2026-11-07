function parseRgb(value) {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (!match) return null
  const parts = match[1].split(',').map((part) => Number(part.trim()))
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
}
function luminance(color) {
  const channel = (value) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}
function contrast(foreground, background) {
  const fg = luminance(foreground)
  const bg = luminance(background)
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('Inbox'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
const inboxItem = document.querySelector('.inbox-item')
const inboxContent = inboxItem?.querySelector('.inbox-content')
const inboxResult = inboxItem
  ? {
      bg: getComputedStyle(inboxItem).backgroundColor,
      fg: getComputedStyle(inboxContent).color,
      ratio: contrast(parseRgb(getComputedStyle(inboxContent).color), parseRgb(getComputedStyle(inboxItem).backgroundColor))
    }
  : null

Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('公式回归测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const bubble = Array.from(document.querySelectorAll('.assistant-bubble')).find((el) => el.innerText.includes('行内公式'))
const bubbleResult = bubble
  ? {
      bg: getComputedStyle(bubble).backgroundColor,
      fg: getComputedStyle(bubble).color,
      ratio: contrast(parseRgb(getComputedStyle(bubble).color), parseRgb(getComputedStyle(bubble).backgroundColor))
    }
  : null

return { theme: document.documentElement.getAttribute('data-theme'), inboxResult, bubbleResult }
