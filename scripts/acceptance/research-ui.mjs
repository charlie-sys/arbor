// Run after npm run build. Uses isolated application data and a local fixture, never real API keys.
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { testBatchUi } from './batch-ui.mjs'
import { testFoldersAndFont } from './folders-ui.mjs'
import { testUnsavedNavigation } from './unsaved-ui.mjs'
import { testCitationIndicator } from './citation-ui.mjs'
import { testSettingsListAndLocale } from './settings-ui.mjs'
import { testLibraryPagination } from './pagination-ui.mjs'

const require = createRequire(import.meta.url)
const dir = await mkdtemp(join(tmpdir(), 'arbor-ui-'))
const requests = []
const fixture = http.createServer(async (req, res) => {
  if (req.url === '/slow') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.write('<title>Slow import</title>')
    const timer = setTimeout(() => res.end(), 10000)
    res.once('close', () => clearTimeout(timer))
    return
  }
  if (req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The retention is 95 percent.' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 800 } })}\n\ndata: [DONE]\n\n`)
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<title>Web UI fixture</title><article><h1>Battery research</h1><p>The measured capacity retention is 95 percent after 100 cycles.</p><a href="/next">Read next article</a><a id="offline-external" href="/after-offline">External article</a></article>')
})
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${fixture.address().port}/article`
const portServer = http.createServer()
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve))
const debugPort = portServer.address().port
await new Promise((resolve) => portServer.close(resolve))
await mkdir(join(dir, 'data'))
await writeFile(join(dir, 'data', 'library.json'), JSON.stringify({ version: 1,
  settings: { language: 'zh-CN', petEnabled: false, apiBaseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'test', chatModel: 'test' }, documents: [], chats: [] }))
const env = { ...process.env, ARBOR_USER_DATA_DIR: dir, ZOTAGENT_MCP: '0' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ARBOR_REMOTE_DEBUG
const packagedApp = process.env.ARBOR_TEST_APP
const child = spawn(packagedApp || require('electron'), [...(packagedApp ? [] : ['.']), `--remote-debugging-port=${debugPort}`], { env, windowsHide: true, stdio: 'ignore' })
let client
async function waitFor(fn) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const result = await fn().catch(() => false)
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for application UI')
}
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const pair = pending.get(message.id)
    if (pair) { pending.delete(message.id); message.error ? pair.reject(message.error) : pair.resolve(message.result) }
  }
  return {
    close: () => socket.close(),
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    }
  }
}
const targets = () => fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json())
async function evaluate(expression) {
  const result = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result?.value
}
const click = (text) => evaluate(`(() => {
  const root = document.querySelector('[role="dialog"]') || document;
  const button = [...root.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.trim() === ${JSON.stringify(text)});
  if (!button) throw new Error('Button missing: ' + ${JSON.stringify(text)}); button.click(); return true;
})()`)
async function verifySettings(capture) {
  await testSettingsListAndLocale({ evaluate, waitFor, capture, inspectWindows: async () => {
    const windows = (await targets()).filter(t => t.type === 'page' && (t.url.includes('index.html') || t.url.includes('ali-chat.html')))
    return Promise.all(windows.map(async target => {
      const connection = await connect(target)
      try {
        const result = await connection.call('Runtime.evaluate', {expression:'({lang:document.documentElement.lang,title:document.title})',returnByValue:true})
        return result.result.value
      } finally { connection.close() }
    }))
  } })
}
try {
  const target = await waitFor(async () => (await targets()).find((t) => t.type === 'page' && t.url.includes('index.html')))
  client = await connect(target)
  await waitFor(() => evaluate('!!window.api && !!document.querySelector(".library-view")'))
  if (process.argv.includes('--settings-only') || process.argv.includes('--pagination-only')) {
    const output = join(process.cwd(), 'scripts', 'acceptance', '.generated')
    await mkdir(output, {recursive:true})
    const source = join(dir, 'locale-fixture.txt')
    await writeFile(source, '原始文献内容 Original source')
    await evaluate(`(async () => {
      const doc = await window.api.library.importDocument(${JSON.stringify(source)}, '原始文献标题');
      await window.api.library.setText(doc.id, ['原始文献内容 Original source']);
      await window.api.library.update(doc.id, {notes:'中文笔记',authors:'原始作者'});
      await window.api.chats.create([doc.id]);
      await window.api.app.newWindow(); window.api.pet.openAliChat();
    })()`)
    await waitFor(async () => (await targets()).some(t => t.url.includes('ali-chat.html')))
    await client.call('Page.bringToFront')
    const capture = async name => {
      await client.call('Page.bringToFront')
      await evaluate('[...document.querySelectorAll(".modal")].forEach(node => node.getAnimations().forEach(animation => { if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish() }))')
      const shot = await client.call('Page.captureScreenshot', {format:'png'})
      await writeFile(join(output, name + '.png'), Buffer.from(shot.data, 'base64'))
    }
    if (process.argv.includes('--pagination-only')) await testLibraryPagination({evaluate,waitFor,capture,sourcePath:source})
    else await verifySettings(capture)
  } else {
  await click('导入网页')
  await waitFor(() => evaluate('!!document.querySelector("#web-import-url")'))
  await evaluate(`(() => {
    const input = document.querySelector('#web-import-url');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url.replace('/article', '/slow'))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await click('导入网页')
  await waitFor(() => evaluate('[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "取消导入")'))
  await click('取消导入')
  await waitFor(() => evaluate('!document.querySelector(".web-import-dialog")'))
  assert.equal(await evaluate('window.api.library.getState().then(s => s.documents.length)'), 0)
  console.log('PASS: UI cancel aborts the pending import and closes the dialog without saving a document')
  await click('导入网页')
  await waitFor(() => evaluate('!!document.querySelector("#web-import-url")'))
  await evaluate(`(() => {
    const input = document.querySelector('#web-import-url');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await click('导入网页')
  await waitFor(() => evaluate('document.querySelector(".reader-title")?.textContent.includes("Web UI fixture")'))
  await waitFor(() => evaluate('document.querySelector(".web-page-host")?.getBoundingClientRect().height > 100'))
  const live = await waitFor(async () => (await targets()).find((t) => t.type === 'page' && t.url === url))
  const webClient = await connect(live)
  await waitFor(async () => (await webClient.call('Runtime.evaluate', { expression: 'document.readyState === "complete" && !!document.querySelector("a")', returnByValue: true })).result?.value)
  assert.equal(await evaluate('document.querySelector(".web-page-host").getBoundingClientRect().left >= document.querySelector(".sidebar-edge").getBoundingClientRect().right'), true,
    'Native webpage must leave the sidebar edge activation strip accessible')
  await evaluate('document.querySelector(".sidebar-edge").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))')
  await waitFor(() => evaluate('!!document.querySelector(".sidebar-host.drawer")'))
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.equal(await evaluate('window.api.web.state().then(s => s.visible)'), false,
    'Native webpage must not cover the sidebar drawer or its backdrop')
  const sidebarOutput = join(process.cwd(), 'scripts', 'acceptance', '.generated')
  await mkdir(sidebarOutput, { recursive: true })
  const sidebarScreenshot = await client.call('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(sidebarOutput, 'web-sidebar.png'), Buffer.from(sidebarScreenshot.data, 'base64'))
  await evaluate('document.querySelector(".sidebar-host.drawer").dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.querySelector(".main-area") }))')
  await waitFor(() => evaluate('!document.querySelector(".sidebar-host.drawer") && window.api.web.state().then(s => s.visible)'))
  assert.equal((await targets()).find((item) => item.url === url)?.id, live.id,
    'Closing the sidebar must restore the existing page without reloading it')
  console.log('PASS: sidebar overlay hides the native webpage, keeps the edge accessible, then restores the same page')
  await evaluate('document.querySelector(".reader-toolbar-menu-wrap button").click()')
  await waitFor(() => evaluate('!!document.querySelector(".document-tone-menu") && window.api.web.state().then(s => !s.visible)'))
  await evaluate('document.querySelector(".reader-toolbar-menu-wrap button").click()')
  await waitFor(() => evaluate('!document.querySelector(".document-tone-menu") && window.api.web.state().then(s => s.visible)'))
  console.log('PASS: reader popovers also appear above the native webpage')
  await testUnsavedNavigation({ evaluate, waitFor })
  await webClient.call('Runtime.evaluate', { expression: 'document.querySelector("a").click()', userGesture: true })
  webClient.close()
  await waitFor(() => evaluate('document.querySelector(".web-navigation input")?.value.endsWith("/next")'))
  await waitFor(() => evaluate('!document.querySelector(".web-navigation button.btn").disabled'))
  await click('新建对话')
  await waitFor(() => evaluate('!!document.querySelector(".reader-view .chat-thread textarea")'))
  await click('当前视区')
  const ask = async (question) => {
    await evaluate(`(() => {
      const input = document.querySelector('.reader-view .chat-thread textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(question)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await click('发送')
  }
  await ask('What is the capacity retention?')
  await waitFor(() => evaluate('window.api.library.getState().then(s => s.chats.some(c => c.messages.some(m => m.role === "assistant" && m.content.includes("95 percent"))))'))
  assert.match(await evaluate('window.api.library.getState().then(s => s.chats[0].messages[0].promptContext)'), /capacity retention/)
  await waitFor(() => evaluate('![...document.querySelectorAll("button")].some(b => b.textContent.trim() === "停止")'))
  await ask('How many cycles?')
  await waitFor(async () => requests.length === 2)
  assert.deepEqual(requests[1].messages.slice(0, 2), requests[0].messages)
  console.log('PASS: UI persists per-turn source context and replays the identical request prefix')
  await click('保存离线网页')
  await waitFor(() => evaluate('window.api.web.state().then(s => s.source === "offline" && !s.loading)'))
  assert.equal(await evaluate('window.api.library.getState().then(s => s.documents.filter(d => d.fileName.endsWith(".mhtml")).length)'), 1)
  assert.equal(await evaluate('window.api.library.getState().then(s => s.documents.filter(d => d.sourceFormat === "web" && d.fileName.endsWith(".md")).length)'), 0)
  console.log('PASS: UI starts in the live page and saves/reopens an offline MHTML archive')
  const output = join(process.cwd(), 'scripts', 'acceptance', '.generated')
  await mkdir(output, { recursive: true })
  const screenshot = await client.call('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(output, 'web-reader.png'), Buffer.from(screenshot.data, 'base64'))
  const archivedTarget = (await targets()).find((item) => item.type === 'page' && item.url.endsWith('.mhtml'))
  assert.ok(archivedTarget, 'Offline archive must have its own rendered page')
  const archiveClient = await connect(archivedTarget)
  const archiveScreenshot = await archiveClient.call('Page.captureScreenshot', { format: 'png' })
  await archiveClient.call('Runtime.evaluate', { expression: 'document.querySelector("#offline-external").click()', userGesture: true })
  archiveClient.close()
  await writeFile(join(output, 'web-offline-content.png'), Buffer.from(archiveScreenshot.data, 'base64'))
  await waitFor(() => evaluate('window.api.web.state().then(s => s.source === "online" && s.url.endsWith("/after-offline") && !s.loading)'))
  await waitFor(() => evaluate('document.querySelector(".web-navigation input")?.value.endsWith("/after-offline") && document.querySelector("[aria-label=\\"网页来源\\"]")?.value === "online"'))
  await new Promise((resolve) => setTimeout(resolve, 1100))
  assert.equal(await evaluate('window.api.web.state().then(s => s.url.endsWith("/after-offline"))'), true,
    'Syncing source state must not remount the original URL over the clicked target')
  await evaluate(`(() => {
    const select = document.querySelector('[aria-label="网页来源"]');
    select.value = 'offline'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await waitFor(() => evaluate('window.api.web.state().then(s => s.source === "offline" && !s.loading)'))
  console.log('PASS: offline link opens online target, updates address/source and can return to the original archive')
  console.log('PASS: UI URL dialog → live page → navigation → direct Q&A → offline webpage')
  const originalClient = client
  const originalId = target.id
  const docIds = await evaluate('window.api.library.getState().then(s => s.documents.map(d => d.id))')
  const beforeWindows = new Set((await targets()).map(t => t.id))
  await evaluate('document.querySelector(".reader-toolbar button[title=\\"在新窗口打开\\"]").click()')
  const readerTarget = await waitFor(async () => (await targets()).find(t => t.url.includes('openDoc=') && !beforeWindows.has(t.id)))
  const readerClient = await connect(readerTarget)
  client = readerClient
  await waitFor(() => evaluate('!!document.querySelector(".reader-title") && window.api.web.state().then(s => !s.loading)'))
  assert.equal(await evaluate('window.api.web.state().then(s => s.source)'), 'offline')
  await evaluate('document.querySelector(".sidebar-edge")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))')
  await waitFor(() => evaluate('!!document.querySelector("button[title=\\"新建窗口（Ctrl+Shift+N）\\"]")'))
  await evaluate('document.querySelector("button[title=\\"新建窗口（Ctrl+Shift+N）\\"]").click()')
  const blankTarget = await waitFor(async () => (await targets()).find(t => t.url.includes('index.html') && !t.url.includes('openDoc=') && t.id !== originalId))
  const blankClient = await connect(blankTarget)
  client = blankClient
  await waitFor(() => evaluate('!!document.querySelector(".view-slot.active .library-view")'))
  client = readerClient
  await evaluate(`window.api.library.update(${JSON.stringify(docIds[1])}, { title: 'Synced across windows' })`)
  client = blankClient
  await waitFor(() => evaluate('[...document.querySelectorAll(".cell-title-text")].some(n => n.textContent === "Synced across windows")'))
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.doc-row')].find(r => r.textContent.includes('Synced across windows'));
    row.querySelector('button[title="在新窗口打开"]').click();
  })()`)
  const otherTarget = await waitFor(async () => (await targets()).find(t => t.url.includes('openDoc=' + docIds[1])))
  const otherClient = await connect(otherTarget)
  client = otherClient
  await waitFor(() => evaluate('document.querySelector(".reader-title")?.textContent.includes("Synced across windows") && window.api.web.state().then(s => s.source === "online" && !s.loading)'))
  await evaluate('window.api.web.navigate(' + JSON.stringify(url.replace('/article', '/independent')) + ')')
  client = readerClient
  assert.equal(await evaluate('window.api.web.state().then(s => s.source)'), 'offline', 'Navigation in one window must not change another reader')
  client = originalClient
  const ownedPanel = await evaluate('window.api.library.getState().then(s => window.api.readerPanel.open(s.documents[0].id, "notes", null))')
  assert.equal(ownedPanel.open, true)
  client = otherClient
  await evaluate('window.api.readerPanel.close()')
  client = originalClient
  assert.equal(await evaluate('window.api.readerPanel.state().then(s => s.open)'), true, 'Another reader must not close the owner’s detached panel')
  await evaluate('window.close()')
  await waitFor(async () => !(await targets()).some(t => t.id === originalId))
  client = otherClient
  assert.equal(await evaluate('window.api.web.state().then(s => s.url.endsWith("/independent"))'), true)
  assert.equal(await evaluate('window.api.readerPanel.state().then(s => s.open)'), false)
  await evaluate('window.api.app.newWindow()')
  await waitFor(async () => (await targets()).filter(t => t.url.includes('index.html') && !t.url.includes('panel=')).length === 4)
  console.log('PASS: multiple document windows retain independent pages, share library updates, scope detached panels and survive closing the original window')
  const pdfFile = join(dir, 'two-pages.pdf')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 38 >>\nstream\nBT /F1 18 Tf 40 500 Td (Page one) Tj ET\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    '<< /Length 38 >>\nstream\nBT /F1 18 Tf 40 500 Td (Page two) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object, i) => { const offset = pdf.length; pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; return offset })
  const xref = pdf.length
  pdf += `xref\n0 8\n0000000000 65535 f \n${offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  await writeFile(pdfFile, pdf)
  const pdfDoc = await evaluate(`window.api.library.importDocument(${JSON.stringify(pdfFile)}, 'PDF multi-window test')`)
  await evaluate(`window.api.library.setText(${JSON.stringify(pdfDoc.id)}, ['Page one', 'Page two'])`)
  await evaluate(`window.api.app.newWindow(${JSON.stringify(pdfDoc.id)})`)
  const firstPdf = await waitFor(async () => (await targets()).find(t => t.url.includes('openDoc=' + pdfDoc.id)))
  const firstPdfClient = await connect(firstPdf)
  client = firstPdfClient
  await client.call('Page.bringToFront')
  await waitFor(() => evaluate('document.querySelectorAll(".pdfViewer .page").length === 2 && document.querySelector(".pdfViewer .page .textLayer")?.textContent.includes("Page one")'))
  await evaluate(`window.api.app.newWindow(${JSON.stringify(pdfDoc.id)})`)
  const secondPdf = await waitFor(async () => (await targets()).find(t => t.url.includes('openDoc=' + pdfDoc.id) && t.id !== firstPdf.id))
  const secondPdfClient = await connect(secondPdf)
  client = secondPdfClient
  await client.call('Page.bringToFront')
  await waitFor(() => evaluate('document.querySelectorAll(".pdfViewer .page").length === 2 && document.querySelector(".pdfViewer .page .textLayer")?.textContent.includes("Page one")'))
  client = firstPdfClient
  await client.call('Page.bringToFront')
  await evaluate('document.querySelector(".reader-view button[title=\\"下一页\\"]").click()')
  await waitFor(() => evaluate(`window.api.library.getState().then(s => s.documents.find(d => d.id === ${JSON.stringify(pdfDoc.id)}).lastPage === 2)`))
  client = secondPdfClient
  assert.equal(await evaluate('document.querySelector(".page-input").value'), '1')
  await new Promise(resolve => setTimeout(resolve, 2200))
  assert.equal(await evaluate(`window.api.library.getState().then(s => s.documents.find(d => d.id === ${JSON.stringify(pdfDoc.id)}).lastPage)`), 2,
    'An idle window must not overwrite another window’s saved page')
  console.log('PASS: two real PDF readers render independently and retain separate pages without fighting over the saved reading position')
  const citationText = join(dir, 'citation.txt')
  await writeFile(citationText, 'Text first page\nText second page')
  client = firstPdfClient
  await client.call('Page.bringToFront')
  await testCitationIndicator({ evaluate, waitFor, pdfDoc, textPath: citationText, capture: async name => {
    await client.call('Page.bringToFront')
    const shot = await client.call('Page.captureScreenshot', {format:'png'})
    await writeFile(join(output, name + '.png'), Buffer.from(shot.data, 'base64'))
  } })
  firstPdfClient.close()
  secondPdfClient.close()
  client = otherClient
  originalClient.close()
  readerClient.close()
  blankClient.close()
  await testBatchUi({ evaluate, waitFor, url, capture: async name => {
    await client.call('Page.bringToFront')
    await evaluate('[...document.querySelectorAll(".modal")].forEach(node => node.getAnimations().forEach(animation => { if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish() }))')
    const screenshot = await client.call('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'))
  } })
  await evaluate('window.api.pet.openAliChat()')
  const aliWindowTarget = await waitFor(async () => (await targets()).find(t => t.url.includes('ali-chat.html')))
  const aliWindowClient = await connect(aliWindowTarget)
  client = aliWindowClient
  await waitFor(() => evaluate('!!document.querySelector(".ali-view.compact button[title=\\"批量管理会话\\"]")'))
  await evaluate('document.querySelector("button[title=\\"批量管理会话\\"]").click()')
  await waitFor(() => evaluate('!!document.querySelector("[role=dialog][aria-label=\\"批量管理会话\\"]")'))
  await evaluate('[...document.querySelectorAll("[role=dialog] .batch-toolbar button")].find(b => b.textContent === "全选").click()')
  await evaluate('[...document.querySelectorAll("[role=dialog] .batch-toolbar button")].find(b => b.textContent === "批量删除").click()')
  await waitFor(() => evaluate('!!document.querySelector("#batch-delete-code")'))
  assert.equal(await evaluate('document.querySelector(".batch-delete-dialog button[type=submit]").disabled'), true)
  await evaluate(`(() => {
    const input = document.querySelector('#batch-delete-code');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, document.querySelector('[data-testid=batch-delete-challenge]').textContent);
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await evaluate('document.querySelector(".batch-delete-dialog button[type=submit]").click()')
  await waitFor(() => evaluate('!document.querySelector(".batch-delete-dialog") && window.api.ali.getState().then(s => s.sessions.length === 0)'))
  client = otherClient
  await waitFor(() => evaluate('document.querySelectorAll(".ali-view .session-item").length === 0'))
  aliWindowClient.close()
  console.log('PASS: compact Ali chat supports bulk deletion with random confirmation and synchronizes the main conversation list')
  const capture = async name => {
    await client.call('Page.bringToFront')
    await evaluate('[...document.querySelectorAll(".modal")].forEach(node => node.getAnimations().forEach(animation => { if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish() }))')
    const screenshot = await client.call('Page.captureScreenshot', {format:'png'})
    await writeFile(join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'))
  }
  await testFoldersAndFont({ evaluate, waitFor, capture, url, filePath: pdfFile })
  const knownFontWindows = new Set((await targets()).map(t => t.id))
  await evaluate('window.api.app.newWindow()')
  const fontTarget = await waitFor(async () => (await targets()).find(t => t.url.includes('index.html') && !knownFontWindows.has(t.id)))
  const fontClient = await connect(fontTarget)
  client = fontClient
  await waitFor(() => evaluate('document.documentElement.dataset.uiFontSize === "20" && !!document.querySelector(".library-folder-panel")'))
  assert.ok(Math.abs(await evaluate('parseFloat(getComputedStyle(document.body).fontSize)') - 20) < 0.1)
  await evaluate('window.api.settings.save({uiFontSize:14})')
  client = otherClient
  await waitFor(() => evaluate('document.documentElement.dataset.uiFontSize === "14"'))
  fontClient.close()
  console.log('PASS: new and existing windows share persistent interface font settings')
  await verifySettings(capture)
  await testLibraryPagination({evaluate,waitFor,capture,sourcePath:pdfFile})
  await evaluate('window.api.library.getState().then(s => window.api.library.remove(s.documents[0].id))')
  }
} catch (error) {
  if (client) console.error(await evaluate('Promise.all([document.body.innerText.slice(-3500), window.api.web.state().catch(e => e.message), document.querySelector(".web-navigation input")?.value])').catch(() => 'UI unavailable'))
  throw error
} finally {
  client?.close()
  child.kill()
  await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve) })
  await new Promise((resolve) => fixture.close(resolve))
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()))
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
