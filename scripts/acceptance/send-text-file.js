const composer = document.querySelector('.chat-thread-slot.active .composer')
const transfer = new DataTransfer()
transfer.items.add(new File(['# 附件标题\n正文内容'], '说明.md', { type: 'text/markdown' }))
composer?.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
await new Promise((resolve) => setTimeout(resolve, 900))
const button = Array.from(document.querySelectorAll('.chat-thread-slot.active .composer-actions button')).find((item) => item.innerText.includes('发送'))
button?.click()
await new Promise((resolve) => setTimeout(resolve, 1300))
return { clicked: Boolean(button) }
