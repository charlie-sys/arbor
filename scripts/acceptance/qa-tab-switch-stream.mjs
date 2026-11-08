import { promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(here, '../..')
const sourceProfile = path.join(process.env.APPDATA, 'Arbor')
const profileDir = path.join(here, '.generated', 'qa-tab-switch-profile')
const rendererScript = path.join(here, 'qa-tab-switch-stream.js')
const port = Number(process.env.CDP_PORT || 9361)
const mockPort = 9878
const chunks = ['流式回答片段一，', '模型仍在后台生成，', '完整回答已全部送达。']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const mock = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    if (!body.includes('"stream":true')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: chunks.join('') } }] }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    let index = 0
    const timer = setInterval(() => {
      if (index < chunks.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[index] } }] })}\n\n`)
        index += 1
        return
      }
      clearInterval(timer)
      res.write('data: [DONE]\n\n')
      res.end()
    }, 700)
  })
})
await new Promise((resolve) => mock.listen(mockPort, '127.0.0.1', resolve))

async function listPages() {
  return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page')
}
async function waitForPages(min, timeoutMs = 90000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pages = await listPages().catch(() => [])
    if (pages.length >= min) return pages
    await sleep(400)
  }
  throw new Error(`等待页面目标超时（需要 ${min} 个）`)
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 0
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const resolver = pending.get(message.id)
    if (!resolver) return
    pending.delete(message.id)
    resolver(message)
  }
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('CDP 连接失败'))
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, ready, send }
}
async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, timeout: 180000 })
  if (response.result?.exceptionDetails) return { __error: JSON.stringify(response.result.exceptionDetails).slice(0, 2000) }
  return response.result?.result?.value
}
async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const timer = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
  return (await Promise.race([exited, timer])) !== 'timeout'
}

await fs.rm(profileDir, { recursive: true, force: true })
await fs.mkdir(profileDir, { recursive: true })
await fs.cp(path.join(sourceProfile, 'data'), path.join(profileDir, 'data'), { recursive: true })

const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
  cwd: rootDir,
  env: { ...process.env, ARBOR_USER_DATA_DIR: profileDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false
})
child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
child.stderr.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`))

try {
  const pages = await waitForPages(1)
  const main = connect(pages[0].webSocketDebuggerUrl)
  await main.ready
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(main, "document.readyState === 'complete' && !!document.querySelector('.sidebar-edge') && !!window.api")) break
    await sleep(300)
  }
  const result = await evaluate(
    main,
    `(async () => {\n${await fs.readFile(rendererScript, 'utf8')}\n})()`,
    true
  )
  console.log('RESULT', JSON.stringify(result, null, 2))
  const shot = await main.send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) {
    const shotPath = path.join(here, '.generated', 'qa-tab-switch-stream.png')
    await fs.writeFile(shotPath, Buffer.from(shot.result.data, 'base64'))
    console.log('SHOT', shotPath)
  }
  await evaluate(main, 'window.close()')
  await waitForExit(child, 8000)
  main.ws.close()
} finally {
  if (!(await waitForExit(child, 3000))) {
    child.kill()
    await waitForExit(child, 4000)
  }
  mock.close()
}
