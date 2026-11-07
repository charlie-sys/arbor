import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const demoDir = path.join(rootDir, 'scripts', 'demo')
const generatedDir = path.join(demoDir, '.generated')
const profileDir = process.env.DEMO_PROFILE_DIR
  ? path.resolve(process.env.DEMO_PROFILE_DIR)
  : path.join(generatedDir, 'profile')
const port = Number(process.env.CDP_PORT || 9335)
const hour = 60 * 60 * 1000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!profileDir.startsWith(generatedDir + path.sep)) {
  throw new Error(`拒绝写入非演示目录：${profileDir}`)
}

async function extractPages(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(filePath))
  const task = pdfjs.getDocument({ data, useSystemFonts: true })
  try {
    const doc = await task.promise
    const pages = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        text += item.hasEOL ? '\n' : ' '
      }
      pages.push(text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim())
      page.cleanup()
    }
    return pages
  } finally {
    await task.destroy()
  }
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
    await sleep(500)
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
  const result = await Promise.race([exited, timer])
  return result !== 'timeout'
}

const pdfFiles = ['demo-paper.pdf']
const texts = {}
for (const file of pdfFiles) {
  texts[file] = await extractPages(path.join(generatedDir, file))
}

await fs.rm(profileDir, { recursive: true, force: true })
await fs.mkdir(profileDir, { recursive: true })
console.log(`隔离 profile：${profileDir}`)

const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
  cwd: rootDir,
  env: { ...process.env, ARBOR_USER_DATA_DIR: profileDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false
})
child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
child.stderr.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`))

let summary
try {
  const page = await waitForPage()
  const cdp = connect(page.webSocketDebuggerUrl)
  await cdp.ready
  const script = await fs.readFile(path.join(demoDir, 'seed-renderer.js'), 'utf8')
  const payload = {
    files: Object.fromEntries(pdfFiles.map((file) => [file, path.join(generatedDir, file)])),
    texts
  }
  const expression = `window.__DEMO__ = ${JSON.stringify(payload)};\n(async () => {\n${script}\n})()`
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 180000
  })
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 2000))
  }
  summary = response.result?.result?.value
  void cdp.send('Runtime.evaluate', { expression: 'window.close()' })
  await waitForExit(child, 8000)
  cdp.ws.close()
} finally {
  if (!(await waitForExit(child, 3000))) {
    child.kill()
    await waitForExit(child, 4000)
  }
}

const dataDir = path.join(profileDir, 'data')
const libraryFile = path.join(dataDir, 'library.json')
const library = JSON.parse(await fs.readFile(libraryFile, 'utf8'))
const now = Date.now()

const translationsDir = path.join(dataDir, 'translations')
await fs.mkdir(translationsDir, { recursive: true })
const translationDefs = [
  {
    original: 'translation-original-1.png',
    translated: 'translation-translated-1.png',
    hoursAgo: 2,
    model: 'qwen-vl-plus',
    structured:
      '## 图 3 · SOH 估计误差随充电窗口变化\n\n| 可用窗口 | 本文模型 | 无迁移基线 |\n| --- | --- | --- |\n| 10 分钟 | 2.06% | 3.72% |\n| 20 分钟 | 1.43% | 2.94% |\n| 40 分钟 | 1.18% | 2.31% |\n\n**结论**：短窗口下迁移模型的优势最明显；LFP 电芯因电压平台较平坦，误差最高。',
    plain:
      '图 3：SOH 估计误差随充电窗口变化。可用窗口为 10 分钟时，本文模型误差 2.06%，无迁移基线 3.72%；20 分钟时分别为 1.43% 与 2.94%；40 分钟时分别为 1.18% 与 2.31%。短窗口下迁移模型更稳定，LFP 电芯误差最高。'
  },
  {
    original: 'translation-original-2.png',
    translated: 'translation-translated-2.png',
    hoursAgo: 26,
    model: 'deepseek-vl',
    structured:
      '## 第 3.2 节 · 贝叶斯超参数调优\n\n目标函数：$L = L_{\\mathrm{MAPE}} + \\lambda \\max(0, \\sigma_{\\mathrm{fold}} - \\sigma_0)$\n\n- 使用高斯过程代理模型，共 64 次试验\n- 选定的配置在迁移前冻结，避免目标域信息泄漏\n- 随后在无标签目标域片段上重估批归一化统计量',
    plain:
      '第 3.2 节：我们使用高斯过程代理模型在 64 次试验中优化学习率、卷积核宽度、丢弃率与权重衰减。目标函数同时考虑验证误差与稳定性惩罚，以抑制相邻折之间的过大差异。选定的配置在迁移前被冻结，以避免目标域信息泄漏。随后在无标签的目标域片段上重新估计批归一化统计量。'
  },
  {
    original: 'translation-original-3.png',
    translated: 'translation-translated-3.png',
    hoursAgo: 75,
    model: 'qwen-vl-plus',
    structured:
      '## 表 S1 · 质量过滤后的数据集构成\n\n| 体系 | 电芯数 | 片段数 | 窗口 |\n| --- | --- | --- | --- |\n| NCA | 42 | 3,180 | 20 min |\n| NCM | 28 | 2,406 | 20 min |\n| LFP | 19 | 1,572 | 25 min |\n\n短于 10 分钟的窗口会保留，但会被标记为弱观测。',
    plain:
      '表 S1：质量过滤后的数据集构成。NCA 使用 42 个电芯、3,180 个片段、20 分钟窗口；NCM 使用 28 个电芯、2,406 个片段、20 分钟窗口；LFP 使用 19 个电芯、1,572 个片段、25 分钟窗口。短于 10 分钟的窗口保留但标记为弱观测。'
  }
]
library.translations = []
for (const item of translationDefs) {
  const id = crypto.randomUUID()
  const imageFile = `${id}.png`
  const translatedImageFile = `${id}-translated.png`
  await fs.copyFile(path.join(generatedDir, item.original), path.join(translationsDir, imageFile))
  await fs.copyFile(path.join(generatedDir, item.translated), path.join(translationsDir, translatedImageFile))
  library.translations.push({
    id,
    createdAt: now - item.hoursAgo * hour,
    imageFile,
    translatedImageFile,
    structured: item.structured,
    plain: item.plain,
    model: item.model
  })
}
library.translations.sort((a, b) => b.createdAt - a.createdAt)

if (library.settings?.apiKey || library.settings?.apiKeyEnc) {
  throw new Error('演示数据中不应包含 API Key')
}
await fs.writeFile(libraryFile, JSON.stringify(library, null, 2), 'utf8')

const backupsRoot = path.join(profileDir, 'backups')
await fs.rm(backupsRoot, { recursive: true, force: true })
for (const hoursAgo of [3, 27, 75]) {
  const createdAt = now - hoursAgo * hour
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupsRoot, stamp)
  await fs.mkdir(target, { recursive: true })
  await fs.cp(dataDir, path.join(target, 'data'), { recursive: true })
  await fs.writeFile(
    path.join(target, 'manifest.json'),
    JSON.stringify({ createdAt, version: '0.1.0', source: path.join(profileDir, 'data') }, null, 2),
    'utf8'
  )
}

const report = {
  profile: profileDir,
  dataDir,
  documents: library.documents.map((doc) => ({ title: doc.title, pages: doc.pageCount, status: doc.readingStatus })),
  counts: {
    documents: library.documents.length,
    collections: library.collections.length,
    tags: library.tags.length,
    properties: library.properties.length,
    highlights: library.highlights.length,
    excerpts: library.excerpts.length,
    chats: library.chats.length,
    topics: library.researchTopics.length,
    canvases: library.canvases.length,
    inbox: library.inbox.length,
    tasks: library.tasks.length,
    views: library.savedViews.length,
    translations: library.translations.length,
    backups: (await fs.readdir(backupsRoot)).length
  },
  seedSummary: summary
}
console.log(JSON.stringify(report, null, 2))
