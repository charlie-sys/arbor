const nav = Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))
nav?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const session = Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('跨文献引用测试'))
session?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const refs = Array.from(document.querySelectorAll('a.page-ref'))
const refTexts = refs.map((anchor) => anchor.innerText.trim())
refs[0]?.click()
await new Promise((resolve) => setTimeout(resolve, 1600))
const title1 = document.querySelector('.reader-title')?.innerText.trim() ?? null
const page1 = document.querySelector('.page-input')?.value ?? null

Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
Array.from(document.querySelectorAll('.session-item')).find((el) => el.innerText.includes('跨文献引用测试'))?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const refs2 = Array.from(document.querySelectorAll('a.page-ref'))
refs2[1]?.click()
await new Promise((resolve) => setTimeout(resolve, 1600))
const title2 = document.querySelector('.reader-title')?.innerText.trim() ?? null
const page2 = document.querySelector('.page-input')?.value ?? null

return { refTexts, title1, page1, title2, page2 }
