import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workDir = path.join(rootDir, 'scripts', 'acceptance', '.generated')
const profileDir = path.join(workDir, 'canvas-profile')
const rendererScript = path.join(rootDir, 'scripts', 'acceptance', 'canvas-renderer.js')
const port = Number(process.env.CDP_PORT || 9337)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const now = Date.now()
const seed = {
  version: 1,
  documents: [
    {
      id: 'doc-canvas-1',
      title: '画布验收文献',
      authors: '张三',
      year: '2026',
      journal: '验收期刊',
      abstract: '',
      doi: '',
      url: '',
      tags: [],
      collections: [],
      addedAt: now,
      updatedAt: now,
      fileName: '',
      pageCount: 2,
      starred: false,
      readingStatus: 'unread',
      lastPage: 1,
      notes: ''
    }
  ],
  collections: [],
  chats: [
    {
      id: 'chat-1',
      title: '画布验收对话',
      docIds: ['doc-canvas-1'],
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          content: '这是一条用于画布卡片的问答回答。',
          createdAt: now
        }
      ],
      createdAt: now,
      updatedAt: now
    }
  ],
  translations: [],
  highlights: [],
  excerpts: [
    {
      id: 'ex-1',
      docId: 'doc-canvas-1',
      docTitle: '画布验收文献',
      page: 1,
      source: 'pdf',
      question: '这篇文章的核心贡献？',
      answer: '核心贡献：验证主题画布的卡片、连线与导出。',
      attachments: [],
      createdAt: now,
      updatedAt: now
    }
  ],
  inbox: [],
  tasks: [],
  researchTopics: [],
  canvases: [],
  tags: [],
  properties: [],
  savedViews: [],
  settings: {}
}

async function waitForPage(timeoutMs = 90000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((target) => target.type === 'page')
      if (page) return page
    } catch {
      // app is still starting
    }
    await sleep(400)
  }
  throw new Error('等待 Electron 调试端口超时')
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

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const timer = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
  return (await Promise.race([exited, timer])) !== 'timeout'
}

async function launch(phase) {
  const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
    cwd: rootDir,
    env: { ...process.env, ARBOR_USER_DATA_DIR: profileDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  })
  child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`))

  let result
  try {
    const page = await waitForPage()
    const cdp = connect(page.webSocketDebuggerUrl)
    await cdp.ready
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const ready = await cdp.send('Runtime.evaluate', {
        expression: "document.readyState === 'complete' && !!document.querySelector('.sidebar-edge') && !!window.api",
        returnByValue: true
      })
      if (ready.result?.result?.value) break
      await sleep(300)
    }
    const source = await fs.readFile(rendererScript, 'utf8')
    const expression = `window.__CANVAS_PHASE__ = ${phase};\n(async () => {\n${source}\n})()`
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 180000
    })
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 2000))
    }
    result = response.result?.result?.value
    if (result === undefined) {
      console.error(`[cdp] phase ${phase} 未返回结果：${JSON.stringify(response).slice(0, 1500)}`)
    }

    await cdp.send('Runtime.evaluate', {
      expression:
        "document.querySelector('.sidebar')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); true"
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 900,
      y: 420,
      button: 'none',
      buttons: 0
    })
    await sleep(500)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    if (shot.result?.data) {
      await fs.writeFile(path.join(workDir, `canvas-phase${phase}.png`), Buffer.from(shot.result.data, 'base64'))
    }

    void cdp.send('Runtime.evaluate', { expression: 'window.close()' })
    await waitForExit(child, 8000)
    cdp.ws.close()
  } finally {
    if (!(await waitForExit(child, 3000))) {
      child.kill()
      await waitForExit(child, 4000)
    }
  }
  return result
}

await fs.rm(profileDir, { recursive: true, force: true })
await fs.mkdir(path.join(profileDir, 'data'), { recursive: true })
await fs.mkdir(workDir, { recursive: true })
await fs.writeFile(path.join(profileDir, 'data', 'library.json'), JSON.stringify(seed, null, 2), 'utf8')

const first = await launch(1)
const libraryAfterFirst = JSON.parse(
  await fs.readFile(path.join(profileDir, 'data', 'library.json'), 'utf8')
)
const second = await launch(2)

const board = libraryAfterFirst.canvases?.[0]
const cardsText = (first?.cards ?? []).map((card) => card.text).join('\n')
const checks = [
  ['侧边栏入口可进入并高亮', first?.sidebarActive === true],
  ['新建画布名称为验收画布', first?.boardName === '验收画布'],
  ['四类卡片齐全', (first?.cards ?? []).map((card) => card.kind).sort().join(',') === 'chat,document,excerpt,section'],
  ['文献卡片内容正确', cardsText.includes('画布验收文献') && cardsText.includes('张三')],
  ['摘录卡片内容正确', cardsText.includes('核心贡献')],
  ['问答卡片内容正确', cardsText.includes('问答回答')],
  ['分区卡片内容正确', cardsText.includes('问题定义')],
  ['连线可创建', first?.edgeAfterConnect === true],
  ['连线可删除', first?.edgeAfterDelete === true],
  ['连线可重建', first?.edgeAfterReconnect === true],
  ['按钮缩放 144%', first?.zoomButton === '144%'],
  ['滚轮缩放 158%', first?.zoomWheel === '158%'],
  ['空白拖拽平移', first?.panChanged === true],
  ['导出 PNG 文件名正确', first?.export?.download === '验收画布.png'],
  ['导出内容为 PNG', first?.export?.isPngDataUrl === true && first?.export?.bytes > 10000],
  ['卡片可调整尺寸', first?.resize?.ok === true],
  ['分区拖动带动范围内卡片', first?.section?.ok === true],
  ['分区可调整大小', first?.section?.resizeOk === true],
  ['文献面板可拖入画布', first?.libraryDrop?.count === 5 && first?.libraryDrop?.documents === 2],
  ['画布写入 library.json', board?.name === '验收画布' && board?.nodes?.length === 5 && board?.edges?.length === 1],
  ['重启后仍在画布', second?.sidebarActive === true && second?.boardName === '验收画布'],
  ['重启后卡片完整', (second?.cards ?? []).length === 5],
  ['重启后尺寸保持', (second?.docWidths ?? []).some((width) => width > 260)],
  ['重启后连线保留', second?.edges === 1],
  ['命名弹窗流程正常', first?.naming?.created === true && first?.naming?.renamed === true && first?.naming?.section === true]
]

console.log('\n结果：')
for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}`)
console.log(JSON.stringify({ first, second, libraryCanvas: board }, null, 2))

const failed = checks.filter(([, ok]) => !ok)
if (failed.length) {
  console.error(`\n${failed.length} 项未通过`)
  process.exitCode = 1
} else {
  console.log(`\n全部 ${checks.length} 项通过，截图：scripts/acceptance/.generated/canvas-phase1.png / canvas-phase2.png`)
}
