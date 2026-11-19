import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = 9472
const DOC_ID = 'fb3ea9bb-86fc-407c-a52e-9b9ed77d77cd'
const FILE_NAME = 'nested document.pdf'
const FLAT_DOC_ID = '2de0431f-ec31-4e74-a2ca-5d8ed2f86333'
const PROFILE = await fs.mkdtemp(path.join(os.tmpdir(), 'arbor-pdf-path-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function targets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  } catch {
    return []
  }
}

async function waitTarget() {
  for (let index = 0; index < 160; index += 1) {
    const page = (await targets()).find(
      (item) => item.type === 'page' && item.url.includes('index.html')
    )
    if (page) return page
    await sleep(250)
  }
  throw new Error('等待 Electron 页面超时')
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 0
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const resolve = pending.get(message.id)
    if (!resolve) return
    pending.delete(message.id)
    resolve(message)
  }
  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('CDP 连接失败'))
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }, 15000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  return { socket, ready, send }
}

const dataDir = path.join(PROFILE, 'data')
const nestedDir = path.join(dataDir, 'files', DOC_ID)
await fs.mkdir(nestedDir, { recursive: true })
await fs.writeFile(
  path.join(nestedDir, FILE_NAME),
  [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF'
  ].join('\n')
)
await fs.writeFile(
  path.join(dataDir, 'library.json'),
  JSON.stringify({
    version: 1,
    documents: [
      {
        id: DOC_ID,
        title: 'Nested Path PDF',
        authors: '',
        year: '',
        journal: '',
        abstract: '',
        doi: '',
        url: '',
        tags: [],
        collections: [],
        addedAt: Date.now(),
        updatedAt: Date.now(),
        fileName: FILE_NAME,
        sourceFormat: 'pdf',
        pageCount: 1,
        starred: false,
        readingStatus: 'unread',
        lastPage: 1,
        notes: ''
      },
      {
        id: FLAT_DOC_ID,
        title: 'Flat Path PDF',
        authors: '',
        year: '',
        journal: '',
        abstract: '',
        doi: '',
        url: '',
        tags: [],
        collections: [],
        addedAt: Date.now(),
        updatedAt: Date.now(),
        fileName: `${FLAT_DOC_ID}.pdf`,
        sourceFormat: 'pdf',
        pageCount: 1,
        starred: false,
        readingStatus: 'unread',
        lastPage: 1,
        notes: ''
      }
    ],
    collections: [],
    chats: [],
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
    readingPlans: [],
    settings: {
      language: 'en',
      apiBaseUrl: '',
      apiKey: '',
      chatModel: '',
      visionModel: '',
      temperature: 0.3,
      maxContextChars: 0,
      petEnabled: false,
      petBubbles: false
    }
  })
)
await fs.copyFile(
  path.join(nestedDir, FILE_NAME),
  path.join(dataDir, 'files', `${FLAT_DOC_ID}.pdf`)
)

const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: ROOT,
  env: { ...process.env, ARBOR_USER_DATA_DIR: PROFILE, ARBOR_PET_DEBUG: '0' },
  stdio: 'ignore'
})

try {
  const target = await waitTarget()
  const client = connect(target.webSocketDebuggerUrl)
  await client.ready
  await client.send('Runtime.enable')
  const evaluate = async (expression) => {
    const response = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (response.result?.exceptionDetails) {
      throw new Error(
        response.result.exceptionDetails.exception?.description ||
          response.result.exceptionDetails.text ||
          '页面执行失败'
      )
    }
    return response.result?.result?.value
  }
  const result = await evaluate(`(async () => {
    const url = await window.api.library.pdfUrl(${JSON.stringify(DOC_ID)})
    const response = await fetch(url)
    const nestedBytes = (await response.arrayBuffer()).byteLength
    const flatUrl = await window.api.library.pdfUrl(${JSON.stringify(FLAT_DOC_ID)})
    const flatResponse = await fetch(flatUrl)
    const flatBytes = (await flatResponse.arrayBuffer()).byteLength
    return {
      url,
      status: response.status,
      nestedBytes,
      flatUrl,
      flatStatus: flatResponse.status,
      flatBytes
    }
  })()`)
  assert.match(
    result.url,
    new RegExp(`^zotfile://files/${DOC_ID}/`),
    `desktop returned legacy flat URL: ${result.url}`
  )
  assert.equal(result.status, 200)
  assert.ok(result.nestedBytes > 0)
  assert.equal(result.flatUrl, `zotfile://files/${FLAT_DOC_ID}.pdf`)
  assert.equal(result.flatStatus, 200)
  assert.ok(result.flatBytes > 0)
  console.log(
    'PASS: desktop serves both Web-synced nested PDFs and legacy flat PDFs.'
  )
  client.socket.close()
} finally {
  child.kill()
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(3000)
    ])
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rm(PROFILE, { recursive: true, force: true })
      break
    } catch (error) {
      if (attempt === 9) throw error
      await sleep(200)
    }
  }
}
