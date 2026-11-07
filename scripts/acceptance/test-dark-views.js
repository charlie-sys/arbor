function scanWhite() {
  return Array.from(document.querySelectorAll('*'))
    .filter((element) => {
      const style = getComputedStyle(element)
      return (
        style.backgroundColor === 'rgb(255, 255, 255)' &&
        element.getBoundingClientRect().width > 0 &&
        !['IMG', 'CANVAS', 'SVG', 'PATH'].includes(element.tagName)
      )
    })
    .map((element) => element.className || element.tagName)
    .slice(0, 12)
}
const results = {}
const navs = ['文献库', 'AI 对话', '研究主题', 'Inbox', '截图翻译', '设置']
for (const name of navs) {
  const nav = Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes(name))
  nav?.click()
  await new Promise((resolve) => setTimeout(resolve, 600))
  results[name] = scanWhite()
}

Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('文献库'))?.click()
await new Promise((resolve) => setTimeout(resolve, 600))
Array.from(document.querySelectorAll('button')).find((button) => button.title === '表格视图')?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('Issue Doc A'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1600))
results.reader = scanWhite()
return results
