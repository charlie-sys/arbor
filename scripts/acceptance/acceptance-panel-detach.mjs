import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workDir = path.join(rootDir, 'scripts', 'acceptance', '.generated')
const profileDir = path.join(workDir, 'panel-profile')
const port = Number(process.env.CDP_PORT || 9343)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const now = Date.now()
const seed = {
  version: 1,
  documents: [
    {
      id: 'doc-panel-1',
      title: '面板脱离验收文献',
      authors: '张三',
      year: '2026',
      journal: '验收期刊',
      abstract: '用于验证右侧栏脱离为独立窗口。',
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
      notes: '原始笔记内容'
    }
  ],
  collections: [],
  chats: [
    {
      id: 'chat-panel-1',
      title: '面板验收对话',
      docIds: ['doc-panel-1'],
      messages: [{ id: 'msg-panel-1', role: 'assistant', content: '面板验收回答。', createdAt: now }],
      createdAt: now,
      updatedAt: now
    }
  ],
  translations: [],
  highlights: [],
  excerpts: [],
  inbox: [],
  tasks: [],
  researchTopics: [],
  canvases: [],
  tags: [],
  properties: [],
  savedViews: [],
  settings: {}
}

async function listTargets() {
  try {
    return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  } catch {
    return []
  }
}

async function waitForTarget(predicate, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const target = (await listTargets()).find((item) => item.type === 'page' && predicate(item))
    if (target) return target
    await sleep(300)
  }
  throw new Error('等待页面目标超时')
}

function openOnce(wsUrl) {
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
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }, 10000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      ws.send(JSON.stringify({ id, method, params }))
    })
  ws.onclose = () => {
    for (const [id, resolver] of pending) {
      pending.delete(id)
      resolver({ error: { message: 'CDP 连接已关闭' } })
    }
  }
  return { ws, ready, send }
}

async function connect(wsUrl) {
  let lastError = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const connection = openOnce(wsUrl)
      await connection.ready
      return connection
    } catch (error) {
      lastError = error
      await sleep(500)
    }
  }
  throw lastError ?? new Error('CDP 连接失败')
}

async function evaluate(target, expression, timeout = 30000) {
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.ready
  try {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout
    })
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1200))
    }
    return response.result?.result?.value
  } finally {
    cdp.ws.close()
  }
}

async function waitForValue(target, expression, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await evaluate(target, expression)
      if (value) return value
    } catch {
      // page is reloading
    }
    await sleep(250)
  }
  throw new Error(`等待表达式超时：${expression.slice(0, 120)}`)
}

async function screenshot(target, name) {
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.ready
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  cdp.ws.close()
  if (shot.result?.data) {
    const file = path.join(workDir, name)
    await fs.writeFile(file, Buffer.from(shot.result.data, 'base64'))
    return file
  }
  return null
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const timer = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
  return (await Promise.race([exited, timer])) !== 'timeout'
}

await fs.rm(profileDir, { recursive: true, force: true })
await fs.mkdir(path.join(profileDir, 'data'), { recursive: true })
await fs.mkdir(workDir, { recursive: true })
await fs.writeFile(path.join(profileDir, 'data', 'library.json'), JSON.stringify(seed, null, 2), 'utf8')

const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
  cwd: rootDir,
  env: { ...process.env, ARBOR_USER_DATA_DIR: profileDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false
})
child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
child.stderr.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`))

const result = {}
let panelCdp = null

try {
  const main = await waitForTarget((item) => !item.url.includes('panel=1'))
  await waitForValue(main, "document.readyState === 'complete' && !!document.querySelector('.sidebar-edge') && !!window.api")

  result.opened = await evaluate(
    main,
    `(async () => {
      const row = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('面板脱离验收文献'))
      row?.click()
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return !!document.querySelector('.reader-panel') && !!document.querySelector('.panel-detach')
    })()`
  )

  result.beforeDetach = await evaluate(
    main,
    `(() => {
      const body = document.querySelector('.reader-body')?.getBoundingClientRect().width ?? 0
      const pdf = document.querySelector('.reader-pdf')?.getBoundingClientRect().width ?? 0
      const panel = document.querySelector('.reader-panel')?.getBoundingClientRect().width ?? 0
      return { body: Math.round(body), pdf: Math.round(pdf), panel: Math.round(panel) }
    })()`
  )

  await evaluate(main, "document.querySelector('.panel-detach')?.click(); true")
  await sleep(600)
  result.detachClick = await evaluate(
    main,
    `({
      detachButton: !!document.querySelector('.panel-detach'),
      toasts: Array.from(document.querySelectorAll('.toast')).map((el) => el.innerText).join('|'),
      detachedPanel: !document.querySelector('.reader-panel')
    })`
  )
  console.log('[debug] detach click =>', JSON.stringify(result.detachClick))
  console.log('[debug] targets =>', (await listTargets()).map((item) => item.url).join(' , '))

  const panel = await waitForTarget((item) => item.url.includes('panel=1'))
  console.log('[step] panel target', panel.id, panel.webSocketDebuggerUrl)
  await waitForValue(panel, "!!document.querySelector('.panel-window') && !!document.querySelector('.panel-tabs')")
  console.log('[step] panel rendered')

  const evalPanel = (expression) => evaluate(panel, expression)

  result.afterDetach = await evaluate(
    main,
    `(() => {
      const body = document.querySelector('.reader-body')?.getBoundingClientRect().width ?? 0
      const pdf = document.querySelector('.reader-pdf')?.getBoundingClientRect().width ?? 0
      return {
        body: Math.round(body),
        pdf: Math.round(pdf),
        panelPresent: !!document.querySelector('.reader-panel'),
        resizerPresent: !!document.querySelector('.pane-resizer')
      }
    })()`
  )

  console.log('[step] read panel info')
  result.panel = await evalPanel(`(() => ({
      title: document.title,
      width: window.innerWidth,
      height: window.innerHeight,
      tabs: Array.from(document.querySelectorAll('.panel-tab')).map((el) => el.innerText.trim()),
      hasPin: !!document.querySelector('.panel-window-head .icon-btn'),
      hasClose: document.querySelectorAll('.panel-window-head .icon-btn').length >= 2,
      agentVisible: !!document.querySelector('.agent-panel')
    }))()`
  )
  console.log('[step] screenshot panel')
  try {
    const cdp = await connect(panel.webSocketDebuggerUrl)
    const panelShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    cdp.ws.close()
    await fs.writeFile(path.join(workDir, 'panel-detached.png'), Buffer.from(panelShot.result?.data || '', 'base64'))
  } catch (error) {
    console.error('panel screenshot failed', String(error))
  }
  await sleep(1000)

  console.log('[step] pin')
  await evalPanel("document.querySelectorAll('.panel-window-head .icon-btn')[0]?.click(); true")
  await sleep(500)
  result.pinned = await evalPanel('window.api.readerPanel.state()')

  console.log("[step] notes dirty guard")
  await evalPanel("Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.includes('笔记'))?.click(); true")
  await sleep(400)
  await evalPanel("document.querySelector('.notes-head-actions .btn.ghost')?.click(); true")
  await sleep(300)
  await evalPanel(
    `(() => {
      const area = document.querySelector('.notes-editor')
      if (!area) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(area, '未保存的脱机笔记')
      area.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`
  )
  await sleep(500)
  await evalPanel("document.querySelectorAll('.panel-window-head .icon-btn')[1]?.click(); true")
  await sleep(800)
  result.dirtyBlocked = await evalPanel(
    `({ alive: !!document.querySelector('.panel-window'), toast: document.querySelector('.panel-window-toast')?.innerText ?? '' })`
  )
  await evalPanel("document.querySelector('.notes-head-actions .btn.primary')?.click(); true")
  await sleep(900)

  console.log("[step] resize")
  result.afterResize = await evalPanel(
    `(async () => {
      window.resizeTo(380, 620)
      await new Promise((resolve) => setTimeout(resolve, 700))
      const label = document.querySelector('.panel-tab .tab-label')
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        iconOnly: label ? getComputedStyle(label).display === 'none' : null,
        tabsScroll: (() => { const el = document.querySelector('.panel-tabs'); return el ? el.scrollWidth > el.clientWidth : null })()
      }
    })()`
  )
  result.resizeCall = result.afterResize

  console.log("[step] dock from main")
  await evaluate(main, 'window.api.readerPanel.close()')
  await sleep(1200)
  result.panelClosed = (await listTargets()).every((item) => !item.url.includes('panel=1'))

  const mainAfter = await waitForTarget((item) => !item.url.includes('panel=1'))
  result.afterDock = await evaluate(
    mainAfter,
    `(() => {
      const body = document.querySelector('.reader-body')?.getBoundingClientRect().width ?? 0
      const pdf = document.querySelector('.reader-pdf')?.getBoundingClientRect().width ?? 0
      const panelEl = document.querySelector('.reader-panel')
      return {
        body: Math.round(body),
        pdf: Math.round(pdf),
        panel: panelEl ? Math.round(panelEl.getBoundingClientRect().width) : 0,
        activeTab: document.querySelector('.panel-tab.active')?.innerText.trim() ?? '',
        detachButton: !!document.querySelector('.panel-detach'),
        notesSaved: !!Array.from(document.querySelectorAll('.panel-tab')).find((el) => el.innerText.includes('笔记'))
      }
    })()`
  )

  await screenshot(mainAfter, 'panel-docked.png')

  result.savedNotes = JSON.parse(
    await fs.readFile(path.join(profileDir, 'data', 'library.json'), 'utf8')
  ).documents[0].notes

  await evaluate(
    mainAfter,
    `(() => {
      localStorage.setItem('zotagent-theme', 'dark')
      document.documentElement.dataset.theme = 'dark'
      return true
    })()`
  )
  await evaluate(mainAfter, "document.querySelector('.panel-detach')?.click(); true")
  const darkPanel = await waitForTarget((item) => item.url.includes('panel=1'))
  await waitForValue(
    darkPanel,
    "!!document.querySelector('.panel-window') && document.documentElement.dataset.theme === 'dark'"
  )
  await sleep(600)
  await screenshot(darkPanel, 'panel-detached-dark.png')
  result.darkTheme = await evaluate(
    darkPanel,
    `({
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.querySelector('.panel-window')).backgroundColor,
      head: getComputedStyle(document.querySelector('.panel-window-head')).backgroundColor
    })`
  )
  await evaluate(mainAfter, 'window.api.readerPanel.close()')
  await sleep(600)
} catch (error) {
  result.flowError = String(error?.stack || error)
  console.error('FLOW ERROR', result.flowError)
} finally {
  try {
    if (!(await waitForExit(child, 2000))) child.kill()
    await waitForExit(child, 5000)
  } catch {
    // ignore cleanup errors
  }
}

const checks = [
  ['阅读器右侧栏可打开且有脱离按钮', result.opened === true],
  ['脱离前右栏存在且 PDF 未撑满', result.beforeDetach?.panel > 0 && result.beforeDetach.pdf < result.beforeDetach.body - 100],
  ['点击脱离后右栏消失且 PDF 撑满', result.afterDetach?.panelPresent === false && Math.abs(result.afterDetach.pdf - result.afterDetach.body) <= 2],
  ['独立窗口渲染面板与全部页签', (result.panel?.tabs || []).length === 7 && result.panel?.agentVisible === true],
  ['独立窗口含置顶与关闭按钮', result.panel?.hasPin === true && result.panel?.hasClose === true],
  ['置顶状态可切换', result.pinned?.pinned === true],
  ['独立窗口可调整大小并自适应', result.afterResize?.width <= 380 && result.afterResize?.width >= 320],
  ['窄宽度下页签保持单行图标模式', result.afterResize?.iconOnly === true],
  ['有未保存修改时关闭被拦截并提示', result.dirtyBlocked?.alive === true && String(result.dirtyBlocked?.toast || '').includes('未保存')],
  ['保存后可关闭并收回原位置', result.panelClosed === true && Number(result.afterDock?.panel || 0) > 0],
  ['收回后 PDF 恢复为未撑满', Number(result.afterDock?.pdf || 0) < Number(result.afterDock?.body || 0) - 100],
  ['收回后恢复原页签并保留脱离按钮', String(result.afterDock?.activeTab || '').includes('笔记') && result.afterDock?.detachButton === true],
  ['独立窗口保存的笔记已落库', String(result.savedNotes || '').includes('未保存的脱机笔记')],
  ['深色模式下独立窗口为深色面板', result.darkTheme?.theme === 'dark' && !result.darkTheme.bg.includes('255, 253, 249')]
]

console.log(JSON.stringify(result, null, 2))
console.log('\n=== 验收结果 ===')
let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed += 1
}
console.log(`\n${checks.length - failed}/${checks.length} 通过`)
process.exit(failed ? 1 : 0)
