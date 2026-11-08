import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workDir = path.join(rootDir, 'scripts', 'acceptance', '.generated')
const sourceProfile = path.join(workDir, 'qa-stream-perf-profile')
const profileDir = path.join(workDir, `annotations-tone-profile-${Date.now()}`)
const shotDir = path.join(workDir, 'annotations-tone-shots')
const port = Number(process.env.CDP_PORT || 9355)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await fs.rm(profileDir, { recursive: true, force: true })
await fs.mkdir(profileDir, { recursive: true })
await fs.cp(path.join(sourceProfile, 'data'), path.join(profileDir, 'data'), { recursive: true })
await fs.rm(path.join(profileDir, 'data', 'annotations'), { recursive: true, force: true })
await fs.rm(path.join(profileDir, 'data', 'backups'), { recursive: true, force: true })
await fs.mkdir(shotDir, { recursive: true })

let child
let exitCode = 0
const logs = []

async function waitForPage() {
  for (let i = 0; i < 160; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find(
        (item) => item.type === 'page' && (item.url.includes('index.html') || item.title.includes('文献阅读'))
      )
      if (page) return page
    } catch {
      /* not ready */
    }
    await sleep(250)
  }
  throw new Error('页面未就绪')
}

async function launch() {
  child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
    cwd: rootDir,
    env: { ...process.env, ARBOR_USER_DATA_DIR: profileDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  })
  child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`))
  return waitForPage()
}

function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP 连接失败'))
  })
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description).join(' ')
      logs.push({ type: message.params.type, text })
    } else if (message.method === 'Runtime.exceptionThrown') {
      logs.push({ type: 'exception', text: message.params.exceptionDetails?.text ?? 'exception' })
    }
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (source) => {
    const response = await send('Runtime.evaluate', {
      expression: source,
      awaitPromise: true,
      returnByValue: true,
      timeout: 120000
    })
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 2000))
    }
    return response.result?.result?.value
  }
  const screenshot = async (name) => {
    const response = await send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(shotDir, name), Buffer.from(response.result.data, 'base64'))
  }
  const mouse = async (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? (extra.buttons ? 'left' : 'none') : 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      ...extra
    })
  return { ws, send, evaluate, screenshot, mouse, ready }
}

async function main() {
  const page = await launch()
  const cdp = await connect(page)
  await cdp.ready
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  for (let i = 0; i < 120; i += 1) {
    const ready = await cdp.evaluate("document.readyState === 'complete' && !!window.api && !!document.querySelector('.sidebar-edge')")
    if (ready) break
    await sleep(300)
  }
  await sleep(800)

  const opened = await cdp.evaluate(`(async () => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).find((el) => el.innerText.includes('文献库'))
    nav?.click()
    await new Promise((r) => setTimeout(r, 800))
    const title = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('ViT An Image'))
    title?.click()
    await new Promise((r) => setTimeout(r, 2500))
    const pages = document.querySelectorAll('.pdfViewer .page')
    return { clicked: Boolean(title), pages: pages.length, text: document.body.innerText.slice(0, 300) }
  })()`)
  if (!opened.clicked) throw new Error('未找到 ViT 文献：' + JSON.stringify(opened))
  for (let i = 0; i < 60; i += 1) {
    const rendered = await cdp.evaluate("!!document.querySelector('.pdfViewer .page .canvasWrapper > canvas')")
    if (rendered) break
    await sleep(250)
  }
  await sleep(1200)
  await cdp.evaluate(`(() => {
    const resume = Array.from(document.querySelectorAll('.resume-modal .btn')).find((button) =>
      button.innerText.includes('继续') || button.innerText.toLowerCase().includes('continue')
    )
    resume?.click()
    const scroll = document.querySelector('.pdf-scroll')
    if (scroll) scroll.scrollTop = 0
  })()`)
  await sleep(900)

  const docInfo = await cdp.evaluate(`(() => {
    const state = window.api ? null : null
    return {
      annotateTitle: Array.from(document.querySelectorAll('.reader-toolbar button')).map((b) => b.title),
      pages: document.querySelectorAll('.pdfViewer .page').length,
      tone: document.querySelector('.reader-pdf')?.getAttribute('data-tone')
    }
  })()`)

  const annotateClicked = await cdp.evaluate(`(async () => {
    const button = Array.from(document.querySelectorAll('.reader-toolbar button')).find(
      (b) => b.title.includes('标注') || b.title.toLowerCase().includes('annotat')
    )
    button?.click()
    await new Promise((r) => setTimeout(r, 500))
    return {
      clicked: Boolean(button),
      toolbar: Boolean(document.querySelector('.annotation-toolbar')),
      capture: document.querySelector('.annotation-capture')?.className || null,
      tool: document.querySelector('.annotation-toolbar .annotation-tool-btn.active')?.title || null
    }
  })()`)
  if (!annotateClicked.toolbar) throw new Error('标注工具条未出现：' + JSON.stringify(annotateClicked))

  const pageRect = await cdp.evaluate(`(() => {
    const pages = Array.from(document.querySelectorAll('.pdfViewer .page'))
    const page =
      pages.find((item) => {
        const box = item.getBoundingClientRect()
        return box.top < window.innerHeight - 120 && box.bottom > 120
      }) ?? pages[0]
    const rect = page.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })()`)

  const notePoint = {
    x: pageRect.left + pageRect.width * 0.42,
    y: Math.max(pageRect.top + 60, pageRect.top + pageRect.height * 0.32)
  }
  await cdp.evaluate(`(() => {
    window.__qaEvents = []
    for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      document.addEventListener(name, (event) => {
        window.__qaEvents.push({ name, target: event.target?.className ?? null, button: event.button })
      }, true)
    }
  })()`)
  await cdp.mouse('mousePressed', notePoint.x, notePoint.y)
  await cdp.mouse('mouseReleased', notePoint.x, notePoint.y)
  await sleep(600)
  const clickDebug = await cdp.evaluate(`(async () => {
    const point = { x: ${notePoint.x}, y: ${notePoint.y} }
    const element = document.elementFromPoint(point.x, point.y)
    const capture = document.querySelector('.annotation-capture')
    const box = capture?.getBoundingClientRect()
    const doc = (await window.api.library.getState()).documents.find((item) => item.title.includes('ViT An Image'))
    const data = await window.api.annotations.load(doc.id)
    return {
      point,
      pageRect: ${JSON.stringify(pageRect)},
      element: element?.className ?? null,
      capture: capture?.className ?? null,
      captureRect: box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null,
      editor: Boolean(document.querySelector('.sticky-note-editor')),
      pins: document.querySelectorAll('.annotation-pin').length,
      notes: data.notes.length,
      hosts: document.querySelectorAll('.page-annotation-host').length,
      layers: document.querySelectorAll('.page-annotation-layer').length,
      captures: document.querySelectorAll('.annotation-capture').length,
      pageChildren: Array.from(document.querySelector('.pdfViewer .page')?.children ?? []).map((child) => child.className),
      tool: document.querySelector('.annotation-toolbar .annotation-tool-btn.active')?.title ?? null,
      events: window.__qaEvents ?? [],
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollTop: document.querySelector('.pdf-scroll')?.scrollTop
    }
  })()`)
  const editorOpen = await cdp.evaluate(`Boolean(document.querySelector('.sticky-note-editor'))`)
  if (!editorOpen) throw new Error('点击页面后贴纸编辑器没有出现：' + JSON.stringify(clickDebug))

  const noteText = 'QA 贴纸：这个位置提醒我回看方法部分。'
  await cdp.evaluate(`(() => {
    const textarea = document.querySelector('.sticky-note-input')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, ${JSON.stringify(noteText)})
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
  await cdp.screenshot('01-sticky-editor.png')
  await cdp.evaluate(`document.querySelector('.sticky-note-editor .btn.primary')?.click()`)
  await sleep(900)

  const noteSaved = await cdp.evaluate(`(async () => {
    const doc = (await window.api.library.getState()).documents.find((item) => item.title.includes('ViT An Image'))
    const data = await window.api.annotations.load(doc.id)
    return {
      pins: document.querySelectorAll('.annotation-pin').length,
      notes: data.notes.map((note) => ({ page: note.page, text: note.text, x: note.x, y: note.y })),
      tone: (await window.api.library.getState()).documents.find((item) => item.id === doc.id)?.tone ?? null
    }
  })()`)
  if (noteSaved.pins < 1 || !noteSaved.notes.some((note) => note.text === noteText)) {
    throw new Error('贴纸未保存：' + JSON.stringify(noteSaved))
  }

  await cdp.evaluate(`(() => {
    const pen = Array.from(document.querySelectorAll('.annotation-toolbar .annotation-tool-btn')).find(
      (b) => b.title === '画笔' || b.title === 'Pen'
    )
    pen?.click()
  })()`)
  await sleep(400)
  const penReady = await cdp.evaluate(`Boolean(document.querySelector('.annotation-capture.capture-pen'))`)
  if (!penReady) throw new Error('画笔捕获层未出现')

  const start = { x: pageRect.left + pageRect.width * 0.28, y: pageRect.top + pageRect.height * 0.5 }
  await cdp.mouse('mousePressed', start.x, start.y)
  for (let i = 1; i <= 16; i += 1) {
    await cdp.mouse('mouseMoved', start.x + i * 7, start.y + Math.sin(i / 2) * 22, { buttons: 1 })
    await sleep(12)
  }
  await cdp.mouse('mouseReleased', start.x + 112, start.y)
  await sleep(900)

  const strokeSaved = await cdp.evaluate(`(async () => {
    const doc = (await window.api.library.getState()).documents.find((item) => item.title.includes('ViT An Image'))
    const data = await window.api.annotations.load(doc.id)
    const paths = Array.from(document.querySelectorAll('.annotation-ink:not(.live)')).map((path) => path.getAttribute('d')?.slice(0, 30))
    return { strokes: data.strokes.length, pathCount: paths.length, paths }
  })()`)
  if (strokeSaved.strokes < 1 || strokeSaved.pathCount < 1) {
    throw new Error('画笔笔迹未保存：' + JSON.stringify(strokeSaved))
  }
  await cdp.screenshot('02-pen.png')

  const sidePanel = await cdp.evaluate(`(async () => {
    const tab = Array.from(document.querySelectorAll('.panel-tab')).find((item) => item.innerText.includes('标注'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 500))
    return {
      opened: Boolean(tab),
      noteItem: Array.from(document.querySelectorAll('.annotation-note-item')).some((item) =>
        item.innerText.includes('QA 贴纸')
      ),
      inkEntry: Array.from(document.querySelectorAll('.annotation-ink-entry')).some((item) =>
        item.innerText.includes('墨迹')
      ),
      text: document.querySelector('.annotations-panel')?.innerText.slice(0, 240) ?? ''
    }
  })()`)
  if (!sidePanel.noteItem || !sidePanel.inkEntry) throw new Error('标注侧栏未列出贴纸/墨迹：' + JSON.stringify(sidePanel))
  await cdp.screenshot('02b-annotations-panel.png')

  await cdp.evaluate(`(() => {
    const eraser = Array.from(document.querySelectorAll('.annotation-toolbar .annotation-tool-btn')).find(
      (b) => b.title === '橡皮擦' || b.title === 'Eraser'
    )
    eraser?.click()
  })()`)
  await sleep(350)
  await cdp.mouse('mousePressed', start.x, start.y)
  await cdp.mouse('mouseReleased', start.x, start.y)
  await sleep(700)
  const afterErase = await cdp.evaluate(`(async () => {
    const doc = (await window.api.library.getState()).documents.find((item) => item.title.includes('ViT An Image'))
    return (await window.api.annotations.load(doc.id)).strokes.length
  })()`)
  await cdp.evaluate(`(() => {
    const undo = Array.from(document.querySelectorAll('.annotation-toolbar .annotation-tool-btn')).find(
      (b) => b.title === '撤销' || b.title === 'Undo'
    )
    undo?.click()
  })()`)
  await sleep(800)
  const afterUndo = await cdp.evaluate(`(async () => {
    const doc = (await window.api.library.getState()).documents.find((item) => item.title.includes('ViT An Image'))
    return {
      strokes: (await window.api.annotations.load(doc.id)).strokes.length,
      paths: document.querySelectorAll('.annotation-ink:not(.live)').length
    }
  })()`)
  if (afterErase !== 0 || afterUndo.strokes !== 1) {
    throw new Error('橡皮擦/撤销异常：' + JSON.stringify({ afterErase, afterUndo }))
  }

  const toneOpen = await cdp.evaluate(`(async () => {
    const button = Array.from(document.querySelectorAll('.reader-toolbar button')).find(
      (b) => b.title.includes('色调') || b.title.toLowerCase().includes('document tone')
    )
    button?.click()
    await new Promise((r) => setTimeout(r, 350))
    const items = Array.from(document.querySelectorAll('.document-tone-item'))
    const night = items.find((item) => item.innerText.includes('夜间') || item.innerText.includes('Night'))
    night?.click()
    await new Promise((r) => setTimeout(r, 1800))
    return {
      opened: Boolean(button),
      itemCount: items.length,
      tone: document.querySelector('.reader-pdf')?.getAttribute('data-tone'),
      filter: getComputedStyle(document.querySelector('.pdfViewer .page .canvasWrapper > canvas')).filter
    }
  })()`)
  if (toneOpen.tone !== 'night') throw new Error('夜间色调未应用：' + JSON.stringify(toneOpen))

  // 滚动到含插图的页，等图片保留层生成
  await cdp.evaluate(`(() => {
    const pages = Array.from(document.querySelectorAll('.pdfViewer .page'))
    pages[2]?.scrollIntoView({ block: 'center' })
  })()`)
  await sleep(3000)

  const imageEvidence = await cdp.evaluate(`(() => {
    const overlays = Array.from(document.querySelectorAll('.doc-tone-image-layer'))
    const result = []
    for (const overlay of overlays) {
      const source = overlay.parentElement.querySelector('.canvasWrapper > canvas')
      if (!source || !overlay.width || !overlay.height) continue
      const ctx = overlay.getContext('2d')
      let color = null
      let matched = false
      for (let y = 8; y < overlay.height - 8 && !color; y += 12) {
        for (let x = 8; x < overlay.width - 8; x += 12) {
          const pixel = ctx.getImageData(x, y, 1, 1).data
          if (pixel[3] > 0) {
            color = [pixel[0], pixel[1], pixel[2], pixel[3]]
            const sourceCtx = source.getContext('2d')
            const original = sourceCtx.getImageData(x, y, 1, 1).data
            matched = Math.abs(original[0] - pixel[0]) < 3 && Math.abs(original[1] - pixel[1]) < 3 && Math.abs(original[2] - pixel[2]) < 3
            break
          }
        }
      }
      if (color) result.push({ width: overlay.width, height: overlay.height, color, matched })
    }
    return { overlays: overlays.length, preserved: result, tone: document.querySelector('.reader-pdf')?.getAttribute('data-tone') }
  })()`)
  await cdp.screenshot('03-night.png')

  const pinStability = await cdp.evaluate(`(async () => {
    const pages = Array.from(document.querySelectorAll('.pdfViewer .page'))
    pages[0]?.scrollIntoView({ block: 'start' })
    await new Promise((r) => setTimeout(r, 900))
    const pin = document.querySelector('.annotation-pin')
    const before = pin ? { left: pin.style.left, top: pin.style.top } : null
    const page = document.querySelector('.pdfViewer .page')
    const beforeWidth = page?.getBoundingClientRect().width
    const scroll = document.querySelector('.pdf-scroll')
    const viewer = document.querySelector('.pdfViewer .page')
    const oldScale = viewer?.style.width
    scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 900))
    const pinAfter = document.querySelector('.annotation-pin')
    const after = pinAfter ? { left: pinAfter.style.left, top: pinAfter.style.top } : null
    const doc = (await window.api.library.getState()).documents.find((item) => item.title.includes('ViT An Image'))
    const data = await window.api.annotations.load(doc.id)
    return {
      before,
      after,
      beforeWidth,
      afterWidth: page?.getBoundingClientRect().width,
      oldScale,
      newScale: viewer?.style.width,
      saved: data.notes.find((note) => note.text.includes('QA 贴纸')),
      tone: (await window.api.library.getState()).documents.find((item) => item.id === doc.id)?.tone ?? null,
      localTone: localStorage.getItem('zotagent-reader-tone-v1')
    }
  })()`)

  await cdp.send('Page.reload')
  await sleep(2500)
  for (let i = 0; i < 80; i += 1) {
    const ready = await cdp.evaluate("document.readyState === 'complete' && !!window.api && !!document.querySelector('.sidebar-edge')")
    if (ready) break
    await sleep(300)
  }
  const reloadEvidence = await cdp.evaluate(`(async () => {
    const nav = Array.from(document.querySelectorAll('.nav-item')).find((el) => el.innerText.includes('文献库'))
    nav?.click()
    await new Promise((r) => setTimeout(r, 800))
    const title = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('ViT An Image'))
    title?.click()
    await new Promise((r) => setTimeout(r, 2600))
    const resume = Array.from(document.querySelectorAll('.resume-modal .btn')).find((button) =>
      button.innerText.includes('继续') || button.innerText.toLowerCase().includes('continue')
    )
    resume?.click()
    const scroll = document.querySelector('.pdf-scroll')
    if (scroll) scroll.scrollTop = 0
    await new Promise((r) => setTimeout(r, 1600))
    const doc = (await window.api.library.getState()).documents.find((item) => item.title.includes('ViT An Image'))
    const data = await window.api.annotations.load(doc.id)
    return {
      notes: data.notes.length,
      strokes: data.strokes.length,
      tone: doc.tone ?? null,
      dataTone: document.querySelector('.reader-pdf')?.getAttribute('data-tone'),
      pins: document.querySelectorAll('.annotation-pin').length,
      inkPaths: document.querySelectorAll('.annotation-ink:not(.live)').length
    }
  })()`)
  await cdp.screenshot('04-reload.png')

  const inheritance = await cdp.evaluate(`(async () => {
    const back = Array.from(document.querySelectorAll('.reader-toolbar button')).find((b) => b.title.includes('返回文献库'))
    back?.click()
    await new Promise((r) => setTimeout(r, 800))
    const title = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.includes('MoCo'))
    title?.click()
    await new Promise((r) => setTimeout(r, 2600))
    const doc = (await window.api.library.getState()).documents.find((item) => item.title.includes('MoCo'))
    return {
      clicked: Boolean(title),
      docTone: doc?.tone ?? null,
      dataTone: document.querySelector('.reader-pdf')?.getAttribute('data-tone') ?? null,
      localTone: localStorage.getItem('zotagent-reader-tone-v1')
    }
  })()`)
  await cdp.screenshot('05-inherit-tone.png')

  const textTones = await cdp.evaluate(`(async () => {
    const back = Array.from(document.querySelectorAll('.reader-toolbar button')).find((b) => b.title.includes('返回文献库'))
    back?.click()
    await new Promise((r) => setTimeout(r, 800))
    const title = Array.from(document.querySelectorAll('.cell-title-text')).find((el) => el.innerText.trim() === '提示词')
    title?.click()
    await new Promise((r) => setTimeout(r, 1800))
    const resume = Array.from(document.querySelectorAll('.resume-modal .btn')).find((button) =>
      button.innerText.includes('继续') || button.innerText.toLowerCase().includes('continue')
    )
    resume?.click()
    await new Promise((r) => setTimeout(r, 500))
    const results = []
    for (const label of ['暖纸', '护眼', '夜间', '高对比', '原色']) {
      const button = Array.from(document.querySelectorAll('.reader-toolbar button')).find(
        (b) => b.title.includes('色调') || b.title.toLowerCase().includes('document tone')
      )
      button?.click()
      await new Promise((r) => setTimeout(r, 250))
      const item = Array.from(document.querySelectorAll('.document-tone-item')).find((el) => el.innerText.includes(label))
      item?.click()
      await new Promise((r) => setTimeout(r, 550))
      const sheet = document.querySelector('.text-doc-sheet')
      const content = document.querySelector('.text-doc-content')
      results.push({
        label,
        tone: document.querySelector('.reader-pdf')?.getAttribute('data-tone'),
        sheetBg: sheet ? getComputedStyle(sheet).backgroundColor : null,
        textColor: content ? getComputedStyle(content).color : null
      })
    }
    return { clicked: Boolean(title), sheet: Boolean(document.querySelector('.text-doc-sheet')), results }
  })()`)
  await cdp.screenshot('06-text-tone.png')

  const errors = logs.filter((entry) => entry.type === 'error' || entry.type === 'exception')
  console.log(JSON.stringify({ docInfo, annotateClicked, noteSaved, strokeSaved, sidePanel, afterErase, afterUndo, toneOpen, imageEvidence, pinStability, reloadEvidence, inheritance, textTones, errors }, null, 2))
  if (
    reloadEvidence.notes < 1 ||
    reloadEvidence.strokes < 1 ||
    reloadEvidence.tone !== 'night' ||
    reloadEvidence.dataTone !== 'night' ||
    reloadEvidence.pins < 1 ||
    reloadEvidence.inkPaths < 1 ||
    inheritance.dataTone !== 'night' ||
    textTones.results.length !== 5 ||
    textTones.results.some((item) => item.tone !== ({ '暖纸': 'paper', '护眼': 'eye-care', '夜间': 'night', '高对比': 'high-contrast', '原色': 'original' })[item.label]) ||
    errors.length > 0
  ) {
    exitCode = 2
  }
  cdp.ws.close()
}

try {
  await main()
} catch (error) {
  console.error(error)
  console.error(JSON.stringify(logs, null, 2))
  exitCode = 1
} finally {
  if (child) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
  await sleep(600)
  process.exit(exitCode)
}
