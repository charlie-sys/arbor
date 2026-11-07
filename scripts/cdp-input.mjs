const port = process.env.CDP_PORT || '9333'
const x = Number(process.argv[2] ?? 5)
const y = Number(process.argv[3] ?? 500)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target) process.exit(1)
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
function send(method, params) {
  id += 1
  ws.send(JSON.stringify({ id, method, params }))
  return id
}
ws.onopen = () => {
  send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  setTimeout(() => process.exit(0), 800)
}
setTimeout(() => process.exit(0), 5000)
