
Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('公式渲染测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const bubble = Array.from(document.querySelectorAll('.assistant-bubble')).find((el) => el.innerText.includes('质能方程'))
return {
  bubbleFound: Boolean(bubble),
  katexCount: bubble ? bubble.querySelectorAll('.katex').length : 0,
  hasDisplayMath: bubble ? Boolean(bubble.querySelector('.katex-display')) : false,
  text: bubble?.innerText.slice(0, 300) ?? null
}
