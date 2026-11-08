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
const profileDir = path.join(here, '.generated', 'qa-stream-perf-profile')
const rendererScript = path.join(here, 'qa-stream-perf.js')
const port = Number(process.env.CDP_PORT || 9362)
const mockPort = 9879
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const chunks = []
for (let i = 0; i < 120; i += 1) {
  const page = 1 + (i % 9)
  chunks.push(`片段${i}，公式 $x_{${i}} = \\sum_{k=0}^{${i}} a_k$，详见第${page}页。`)
}
chunks.push('压力测试完成。')

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
    }, 12)
  })
})
await new Promise((resolve) => mock.listen(mockPort, '127.0.0.1', resolve))

await fs.rm(profileDir, { recursive: true, force: true })
await fs.mkdir(profileDir, { recursive: true })
await fs.cp(path.join(sourceProfile, 'data'), path.join(profileDir, 'data'), { recursive: true })

const libraryPath = path.join(profileDir, 'data', 'library.json')
const library = JSON.parse(await fs.readFile(libraryPath, 'utf8'))
const pdfDoc = library.documents.find((doc) => String(doc.fileName || '').toLowerCase().endsWith('.pdf'))
if (!pdfDoc) throw new Error('测试数据中没有 PDF 文献')

const paragraph = (index) =>
  [
    `### 分析段落 ${index}`,
    `在本节中，我们讨论第${1 + (index % 9)}页中的方法细节。模型需要比较多个变体：$y_{${index}} = \\sum_{i=0}^{${index}} w_i x_i + b$，并评估计算开销。`,
    `此外，参考第${2 + (index % 7)}页的实验结果，$\\mathcal{L}_{${index}} = -\\sum_{j} \\log p(y_j \\mid x_j)$ 的变化趋势与训练轮次相关。权重更新可以写作 $\\theta_{t+1} = \\theta_t - \\eta \\nabla \\mathcal{L}$。`,
    `综合来看，该结论与第${3 + (index % 5)}页的消融实验一致，也与第${4 + (index % 4)}页的可视化结果相互印证。需要强调的是，长文本渲染会让界面承担较大压力，因此我们在这里刻意堆叠了较多段落与公式。`
  ].join('\n\n')

const now = Date.now()
const messages = []
for (let i = 0; i < 10; i += 1) {
  messages.push({ id: `perf-u-${i}`, role: 'user', content: `问题 ${i + 1}：请解释第${i + 2}页的方法。`, createdAt: now - (20 - i * 2) * 1000 })
  messages.push({ id: `perf-a-${i}`, role: 'assistant', content: paragraph(i), createdAt: now - (19 - i * 2) * 1000 })
}
const seeded = {
  id: 'qa-perf-chat',
  title: '性能测试长对话',
  docIds: [pdfDoc.id],
  messages,
  createdAt: now - 60000,
  updatedAt: now
}
library.chats = [seeded, ...library.chats.filter((chat) => chat.id !== seeded.id)]
await fs.writeFile(libraryPath, JSON.stringify(library, null, 2), 'utf-8')

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
  if (response.result?.exceptionDetails) return { __error: JSON.stringify(response.result.exceptionDetails).slice(0, 3000) }
  return response.result?.result?.value
}
async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const timer = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
  return (await Promise.race([exited, timer])) !== 'timeout'
}

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
  const result = await evaluate(main, `(async () => {\n${await fs.readFile(rendererScript, 'utf8')}\n})()`, true)
  console.log('PERF', JSON.stringify(result, null, 2))
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
