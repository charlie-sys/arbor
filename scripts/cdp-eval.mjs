import { readFileSync } from 'node:fs'

const file = process.argv[2]
const port = process.env.CDP_PORT || '9333'
if (!file) {
  console.error('用法：node scripts/cdp-eval.mjs <js文件>')
  process.exit(1)
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target) {
  console.error('未找到页面目标')
  process.exit(1)
}

const source = readFileSync(file, 'utf8')
const expression = `window.__TEST_API_KEY = ${JSON.stringify(process.env.ZOT_TEST_API_KEY || '')};\n(async () => {\n${source}\n})()`
const ws = new WebSocket(target.webSocketDebuggerUrl)
let settled = false

function finish(code) {
  if (settled) return
  settled = true
  try { ws.close() } catch { /* ignore */ }
  process.exit(code)
}

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true, timeout: 120000 }
  }))
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== 1) return
  if (message.result?.exceptionDetails) {
    console.error(JSON.stringify(message.result.exceptionDetails, null, 2))
    finish(2)
    return
  }
  console.log(JSON.stringify(message.result?.result?.value ?? null, null, 2))
  finish(0)
}

ws.onerror = (error) => {
  console.error(String(error.message || error))
  finish(3)
}

setTimeout(() => {
  console.error('CDP 执行超时')
  finish(4)
}, 130000)
