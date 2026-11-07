Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('Inbox'))?.click()
await new Promise((resolve) => setTimeout(resolve, 700))
const inboxItem = document.querySelector('.inbox-item')
const inboxContent = inboxItem?.querySelector('.inbox-content')
const inboxTag = inboxItem?.querySelector('.inbox-tag')
const inboxData = {
  itemCount: document.querySelectorAll('.inbox-item').length,
  tag: inboxTag?.innerText ?? null,
  contentHeight: inboxContent ? Math.round(inboxContent.getBoundingClientRect().height) : null,
  lineClamp: inboxContent ? getComputedStyle(inboxContent).webkitLineClamp : null,
  overflow: inboxContent ? getComputedStyle(inboxContent).overflow : null
}

Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('公式回归测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 1200))
const bubble = Array.from(document.querySelectorAll('.assistant-bubble')).find((el) => el.innerText.includes('行内公式'))
const chatData = {
  katexCount: bubble?.querySelectorAll('.katex').length ?? 0,
  rawParen: bubble?.innerText.includes('\\(') ?? false,
  rawBracket: bubble?.innerText.includes('\\[') ?? false,
  rawEnvironment: bubble?.innerText.includes('\\begin') ?? false,
  text: bubble?.innerText.slice(0, 400) ?? null
}

return { inboxData, chatData }
