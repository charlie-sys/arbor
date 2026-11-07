import { writeFileSync } from 'node:fs'

const out = process.argv[2] || 'screenshot.png'
const port = process.env.CDP_PORT || '9333'
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target) {
  console.error('未找到页面目标')
  process.exit(1)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
let done = false
ws.onopen = () => {
  ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }))
  ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } }))
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== 2) return
  if (message.error) {
    console.error(JSON.stringify(message.error))
    done = true
    process.exit(2)
  }
  writeFileSync(out, Buffer.from(message.result.data, 'base64'))
  console.log(out)
  done = true
  process.exit(0)
}
setTimeout(() => {
  if (!done) {
    console.error('截图超时')
    process.exit(3)
  }
}, 20000)
