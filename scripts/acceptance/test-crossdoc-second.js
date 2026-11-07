Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('跨文献引用测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const refs = Array.from(document.querySelectorAll('a.page-ref'))
refs[2]?.click()
await new Promise((resolve) => setTimeout(resolve, 1600))
return {
  refTexts: refs.map((anchor) => anchor.innerText.trim()),
  title: document.querySelector('.reader-title')?.innerText.trim() ?? null,
  page: document.querySelector('.page-input')?.value ?? null
}
