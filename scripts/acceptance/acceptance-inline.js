const nav = Array.from(document.querySelectorAll('.nav-item')).find((button) => button.innerText.includes('AI 对话'))
nav?.click()
await new Promise((resolve) => setTimeout(resolve, 800))
const bubble = Array.from(document.querySelectorAll('.assistant-bubble')).find((el) => el.innerText.includes('研究方法是样本分析'))
return { html: bubble ? bubble.innerHTML.slice(0, 2000) : null, text: bubble?.innerText ?? null }
