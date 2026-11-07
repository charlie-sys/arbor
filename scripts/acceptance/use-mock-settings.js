
await window.api.settings.save({ apiBaseUrl: 'http://127.0.0.1:9877', apiKey: 'test', chatModel: 'mock', visionModel: 'mock' })
const button=Array.from(document.querySelectorAll('.chat-thread-slot.active .composer-actions button')).find(b=>b.innerText.includes('发送'))
button?.click()
await new Promise(r=>setTimeout(r,1200))
return {sent:Boolean(button)}
