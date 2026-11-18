import { app, BrowserWindow, WebContentsView } from 'electron'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { store } from '../../src/main/store'
import { streamChat, type ChatHandlers } from '../../src/main/llm'
import type { ChatRequest } from '../../src/shared/types'
import { importWebUrl, captureWebContents, readPageScript, mountWebPage, webPageState, navigateWebPage, actOnWebPage, saveWebPage, closeWebPage, setWebBounds, switchWebPageSource } from '../../src/main/webPage'
import { selectChatHistory } from '../../src/shared/chatPrompt'
import { normalizeWebUrl } from '../../src/shared/web'
import { usageFromApi } from '../../src/main/usage'
import { globalSearch } from '../../src/main/search'

app.setPath('userData', process.env.ARBOR_TEST_DIR!)
app.on('window-all-closed', () => {})
const requests: any[] = []
const webRequests: string[] = []
let networkUnavailable = false
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    webRequests.push(req.url ?? '')
    if (networkUnavailable) { res.writeHead(503).end('offline'); return }
  }
  if (req.url === '/diagram.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XkAAAAASUVORK5CYII=', 'base64'))
    return
  }
  if (req.url === '/style.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' }).end('h1 { color: rgb(13, 80, 100); }')
    return
  }
  if (req.url === '/slow' || req.url === '/pending-image') {
    res.writeHead(200, { 'Content-Type': req.url === '/slow' ? 'text/html' : 'image/png' })
    res.write(req.url === '/slow' ? '<title>Slow page</title>' : Buffer.from([137, 80, 78, 71]))
    const timer = setTimeout(() => res.end(), 10000)
    res.once('close', () => clearTimeout(timer))
    return
  }
  if (req.method === 'GET') {
    const linked = req.url === '/linked'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><title>${linked ? 'Linked study' : 'Web study'}</title><meta name="author" content="Researcher"><link rel="stylesheet" href="/style.css">
      <nav>Navigation noise</nav><main><h1>${linked ? 'Linked study' : 'Battery study'}</h1>
      <p>${linked ? 'Second page evidence' : 'Battery capacity retention is 95 percent.'.repeat(req.url === '/with-slow-image' ? 8 : 1)}</p>
      <p id="dynamic"></p><a href="/linked" id="link">Read next</a>${req.url === '/with-slow-image' ? '<img src="/pending-image">' : ''}
      <a id="new-tab" target="_blank" href="/popup">Open new tab</a>
      <button id="blank-popup" onclick="const child = window.open('about:blank', '_blank'); if (child) setTimeout(() => child.location.href='/interim', 20)">Open through blank popup</button>
      <figure><img id="diagram" src="/diagram.png" width="64" height="64" alt="Capacity diagram"><figcaption>Figure 1: capacity retention</figcaption></figure>
      <button id="interact" onclick="document.querySelector('#dynamic').textContent='Interaction worked'">Click</button>
      <table><tr><th>Cycles</th><th>Retention</th></tr><tr><td>100</td><td>95%</td></tr></table>
      <script>setTimeout(() => document.querySelector('#dynamic').textContent='Dynamic evidence loaded', 100)</script></main>`)
    return
  }
  let body = ''
  for await (const part of req) body += part
  requests.push(JSON.parse(body))
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Answer' } }], usage: {
    prompt_tokens: 3000, completion_tokens: 1, prompt_cache_hit_tokens: 2000
  } })}\n\ndata: [DONE]\n\n`)
})

async function run(): Promise<void> {
  await store.init()
  if (process.env.ARBOR_IMPORT_TEST_URL) {
    const started = Date.now()
    app.on('browser-window-created', (_event, win) => {
      win.webContents.on('did-navigate', (_event, url, status) => console.log(JSON.stringify({ stage: 'navigate', elapsedMs: Date.now() - started, url, status })))
      win.webContents.on('dom-ready', () => {
        void win.webContents.mainFrame.executeJavaScript('({ title: document.title, textChars: document.body?.innerText.length ?? 0, articleChars: document.querySelector("article")?.innerText.length ?? 0 })')
          .then((detail) => console.log(JSON.stringify({ stage: 'dom-ready', elapsedMs: Date.now() - started, ...detail }))).catch(() => undefined)
      })
    })
    try {
      const imported = await importWebUrl(process.env.ARBOR_IMPORT_TEST_URL)
      const pages = await store.getDocumentTexts(imported.id)
      console.log(JSON.stringify({ result: 'imported', elapsedMs: Date.now() - started, title: imported.title,
        url: imported.url, fileName: imported.fileName, pages: pages.length, textChars: pages.join('\n').length, preview: pages.join('\n').slice(0, 100) }))
    } catch (error) {
      console.log(JSON.stringify({ result: 'failed', elapsedMs: Date.now() - started, error: (error as Error).message }))
    }
    return
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  await store.updateSettings({ apiBaseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test', chatModel: 'test', maxContextChars: 7000 })
  const file = path.join(app.getPath('userData'), 'fixture.txt')
  await fs.writeFile(file, 'test')
  const doc = await store.addDocument(file, 'Cache fixture')
  await store.setDocumentText(doc.id, [
    'battery energy '.repeat(800), 'health lifetime '.repeat(800), 'thermal temperature '.repeat(800)
  ])
  const chat = await store.createChat([doc.id])
  let context = ''
  const handlers: ChatHandlers & { onContext(text: string): void } = {
    onContext: (text) => { context = text }, onDelta() {}, onAttachment() {}, onDone() {},
    onError(error) { throw new Error(error) }
  }
  const first: ChatRequest = { requestId: 'first', chatId: chat.id, docIds: [doc.id], messages: [
    { id: 'q1', role: 'user', content: 'battery energy' }
  ] }
  await streamChat(first, handlers)
  await streamChat({ ...first, requestId: 'second', messages: [
    { ...first.messages[0], promptContext: context }, { role: 'assistant', content: 'Answer' },
    { id: 'q2', role: 'user', content: 'health lifetime' }
  ] }, handlers)
  assert.deepEqual(requests[1].messages.slice(0, 2), requests[0].messages,
    'Follow-up must preserve the previous request prefix despite query-dependent retrieval')
  assert.ok(requests[1].messages[3].content.split('health lifetime').length > 5, 'Retrieval must still include the new question’s source evidence')
  console.log('PASS: query changes preserve the model request prefix')
  const history: ChatRequest['messages'] = Array.from({ length: 25 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user', content: `message ${i}`
  }))
  assert.equal(selectChatHistory(history).length, 25, 'Short turns must not slide after 16 messages')
  const longHistory = history.map((m) => ({ ...m, content: m.content.repeat(1500) }))
  assert.equal(selectChatHistory(longHistory)[0].role, 'user')
  console.log('PASS: history retention uses a character budget and whole conversation groups')
  assert.equal(usageFromApi({ usage: { prompt_tokens: 3000, completion_tokens: 50, prompt_cache_hit_tokens: 2000 } })?.cachedTokens, 2000)
  assert.equal(usageFromApi({ usage: { prompt_tokens: 3000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 1500 } } })?.cachedTokens, 1500)
  assert.equal(usageFromApi({ usage: { prompt_tokens: 3000, completion_tokens: 50 } })?.cachedTokens, undefined)
  console.log('PASS: cache usage fields remain accurate; missing telemetry is not treated as a miss')

  const base = `http://127.0.0.1:${address.port}`
  const beforeDocs = store.data.documents.length
  const beforeFiles = await fs.readdir(store.filesDir)
  const beforeWindows = BrowserWindow.getAllWindows().length
  for (const route of ['/slow', '/article']) {
    const controller = new AbortController()
    const started = Date.now()
    const pending = importWebUrl(`${base}${route}`, { signal: controller.signal })
    const timer = setTimeout(() => controller.abort(), 150)
    await assert.rejects(pending, /取消/)
    clearTimeout(timer)
    assert.ok(Date.now() - started < 2000, 'Cancellation must not wait for page load or the import timeout')
    assert.equal(BrowserWindow.getAllWindows().length, beforeWindows)
    assert.equal(store.data.documents.length, beforeDocs)
    assert.deepEqual(await fs.readdir(store.filesDir), beforeFiles)
  }
  const alreadyCanceled = new AbortController()
  alreadyCanceled.abort()
  await assert.rejects(importWebUrl(`${base}/article`, { signal: alreadyCanceled.signal }), /取消/)
  console.log('PASS: cancel during loading or stabilization stops promptly without files, documents or windows')
  const slowStarted = Date.now()
  await importWebUrl(`${base}/with-slow-image`)
  assert.ok(Date.now() - slowStarted < 3500, 'Ready article text must not wait for a stalled image')
  console.log('PASS: article import does not wait for slow secondary resources')
  for (const url of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'https://user:password@example.com']) {
    assert.throws(() => normalizeWebUrl(url))
  }
  const web = await importWebUrl(`${base}/article`)
  assert.equal(web.sourceFormat, 'web')
  assert.equal(web.authors, 'Researcher')
  assert.equal(web.fileName, '', 'Importing a URL must not create a Markdown snapshot')
  assert.equal(web.pageCount, 0)
  assert.deepEqual(await store.getDocumentTexts(web.id), [])
  assert.equal((await fs.readdir(store.filesDir)).some((name) => name.startsWith(web.id)), false)
  await store.updateDocument(web.id, { notes: 'Saved research note', starred: true })
  await store.addHighlight({ docId: web.id, page: 1, text: '95 percent', color: 'yellow', note: '',
    rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }] })
  assert.equal(store.getHighlights(web.id).length, 1)
  assert.ok((await globalSearch('Saved research note')).some((item) => item.docId === web.id))
  const webChat = await store.createChat([web.id])
  await streamChat({ ...first, chatId: webChat.id, docIds: [web.id] }, handlers)
  assert.match(JSON.stringify(requests[requests.length - 1].messages), /capacity retention/)
  console.log('PASS: URL-only import, notes, search, preserved highlights and transient live-page Q&A')

  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  await owner.loadURL('about:blank')
  owner.showInactive()
  mountWebPage(owner.webContents, web.id, { x: 0, y: 0, width: 600, height: 400 })
  const view = owner.contentView.children.find((child) => child instanceof WebContentsView) as WebContentsView
  const waitFor = async (predicate: () => boolean | Promise<boolean>): Promise<void> => {
    const deadline = Date.now() + 5000
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for page navigation')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  await waitFor(() => !view.webContents.isLoading() && view.webContents.getURL().endsWith('/article'))
  await owner.webContents.executeJavaScript(`document.body.innerHTML = '<div id="web-host" style="position:absolute;left:12px;top:80px;width:60vw;height:65vh"></div>'`)
  for (const zoom of [0.8, 1.25, 1]) {
    owner.webContents.setZoomFactor(zoom)
    const box = await owner.webContents.executeJavaScript(`(() => {
      const r = document.querySelector('#web-host').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`)
    setWebBounds(owner.webContents.id, box)
    const native = view.getBounds()
    assert.ok(Math.abs(native.x + native.width - (box.x + box.width) * zoom) <= 1,
      `Native webpage must stop at the reader divider after app zoom: ${JSON.stringify({ zoom, box, native })}`)
    assert.ok(Math.abs(native.y - box.y * zoom) <= 1, 'Webpage must stay below the toolbar after app zoom')
  }
  setWebBounds(owner.webContents.id, { x: 0, y: 0, width: 600, height: 400 })
  console.log('PASS: native webpage stays inside its reader at 80%, 125% and 100% application zoom')
  const checkWheelZoom = async (contents: Electron.WebContents) => {
    owner.focus()
    contents.focus()
    const initial = contents.getZoomFactor()
    contents.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaY: 120, wheelTicksY: 1, modifiers: ['control'], canScroll: true })
    await waitFor(() => contents.getZoomFactor() > initial)
    contents.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaY: -120, wheelTicksY: -1, modifiers: ['control'], canScroll: true })
    await waitFor(() => Math.abs(contents.getZoomFactor() - initial) < 0.01)
    contents.setZoomFactor(1.5)
    contents.sendInputEvent({ type: 'keyDown', keyCode: '0', modifiers: ['control'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: '0', modifiers: ['control'] })
    await waitFor(() => Math.abs(contents.getZoomFactor() - 1) < 0.01)
    contents.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaY: -120, canScroll: true })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(contents.getZoomFactor(), 1, 'Ordinary scrolling must not zoom the webpage')
  }
  await checkWheelZoom(view.webContents)
  console.log('PASS: Ctrl + wheel zooms the online webpage; Ctrl + 0 resets; ordinary scrolling does not zoom')
  const slowDoc = await store.addWebLink({ url: `${base}/slow`, title: 'Interrupted navigation', author: '' })
  const navigationOwner = new BrowserWindow({ show: false })
  mountWebPage(navigationOwner.webContents, slowDoc.id, { x: 0, y: 0, width: 600, height: 400 })
  const navigationView = navigationOwner.contentView.children.find((child) => child instanceof WebContentsView) as WebContentsView
  await waitFor(() => navigationView.webContents.getURL().endsWith('/slow') && navigationView.webContents.isLoading())
  await navigateWebPage(navigationOwner.webContents.id, `${base}/article`)
  assert.equal(webPageState(navigationOwner.webContents.id).error, undefined,
    'A normal navigation that aborts the old request must not mark the new page as failed')
  closeWebPage(navigationOwner.webContents.id)
  navigationOwner.destroy()
  console.log('PASS: replacing an unfinished page does not leave an ERR_ABORTED error on the new page')
  await waitFor(async () => await view.webContents.mainFrame.executeJavaScript('document.querySelector("#dynamic").textContent === "Dynamic evidence loaded"') as boolean)
  assert.equal(await view.webContents.executeJavaScript('typeof require + ":" + typeof window.api'), 'undefined:undefined')
  await view.webContents.executeJavaScript('document.querySelector("#interact").click()', true)
  await streamChat({ ...first, chatId: webChat.id, docIds: [web.id] }, handlers, { webSenderId: owner.webContents.id })
  assert.match(JSON.stringify(requests[requests.length - 1].messages), /Interaction worked/)
  assert.match(JSON.stringify(requests[requests.length - 1].messages), /Capacity diagram/)
  await waitFor(async () => {
    try { return !(await view.webContents.capturePage()).isEmpty() } catch { return false }
  })
  await store.updateSettings({ visionModel: 'vision-test' })
  await streamChat({ ...first, chatId: webChat.id, docIds: [web.id] }, handlers, { webSenderId: owner.webContents.id })
  const visual = requests[requests.length - 1]
  assert.equal(visual.model, 'vision-test')
  assert.ok(visual.messages[1].content.some((part: any) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/jpeg')))
  await store.updateSettings({ visionModel: '' })
  const archive = await saveWebPage(owner.webContents.id)
  assert.match(archive.fileName, /\.mhtml$/)
  assert.ok(archive.webArchivedAt)
  const mime = await fs.readFile(path.join(store.filesDir, archive.fileName), 'utf8')
  assert.match(mime, /multipart\/related/)
  assert.match(mime, /image\/png/)
  assert.deepEqual(await store.getDocumentTexts(archive.id), [])
  console.log('PASS: live DOM changes and image descriptions reach the model; visual model receives a screenshot; MHTML contains image data')
  await view.webContents.executeJavaScript('document.querySelector("#new-tab").click()', true)
  await waitFor(() => !view.webContents.isLoading() && view.webContents.getURL().endsWith('/popup'))
  console.log('PASS: direct target=_blank links navigate in the reader')
  actOnWebPage(owner.webContents.id, 'back')
  await waitFor(() => !view.webContents.isLoading() && view.webContents.getURL().endsWith('/article'))
  await view.webContents.executeJavaScript('document.querySelector("#blank-popup").click()', true)
  await waitFor(() => !view.webContents.isLoading() && view.webContents.getURL().endsWith('/interim'))
  actOnWebPage(owner.webContents.id, 'back')
  await waitFor(() => !view.webContents.isLoading() && view.webContents.getURL().endsWith('/article'))
  console.log('PASS: new-tab links and blank-window redirects display their target in the reader')
  await view.webContents.executeJavaScript('document.querySelector("#link").click()', true)
  await waitFor(() => !view.webContents.isLoading() && view.webContents.getURL().endsWith('/linked'))
  await waitFor(() => webPageState(owner.webContents.id).canGoBack)
  assert.equal(webPageState(owner.webContents.id).canGoBack, true, 'Click navigation must retain back history')
  const linkedDoc = await saveWebPage(owner.webContents.id)
  assert.notEqual(linkedDoc.id, web.id, 'Saving a browsed page must not overwrite the old snapshot or annotations')
  assert.match(linkedDoc.url, /\/linked$/)
  await streamChat({ ...first, chatId: webChat.id, docIds: [web.id] }, handlers, { webSenderId: owner.webContents.id })
  assert.match(JSON.stringify(requests[requests.length - 1].messages), /Second page evidence/)
  assert.match(JSON.stringify(requests[requests.length - 1].messages), /\/linked/)
  console.log('PASS: questions after link navigation use the current page without creating a text snapshot')
  assert.equal(store.getHighlights(web.id).length, 1)
  actOnWebPage(owner.webContents.id, 'back')
  await waitFor(() => !view.webContents.isLoading() && view.webContents.getURL().endsWith('/article'))
  actOnWebPage(owner.webContents.id, 'forward')
  await waitFor(() => !view.webContents.isLoading() && view.webContents.getURL().endsWith('/linked'))
  await assert.rejects(() => navigateWebPage(owner.webContents.id, 'file:///C:/Windows/win.ini'))
  networkUnavailable = true
  const requestsBeforeOffline = webRequests.length
  mountWebPage(owner.webContents, archive.id, { x: 0, y: 0, width: 600, height: 400 }, 'offline')
  const offline = owner.contentView.children.find((child) => child instanceof WebContentsView) as WebContentsView
  await waitFor(() => !offline.webContents.isLoading() && offline.webContents.getURL().endsWith('.mhtml'))
  assert.equal(webRequests.length, requestsBeforeOffline, 'Offline reading must not fetch source assets')
  owner.webContents.setZoomFactor(0.8)
  setWebBounds(owner.webContents.id, { x: 12, y: 80, width: 600, height: 400 })
  const scaledArchiveBounds = offline.getBounds()
  assert.deepEqual(scaledArchiveBounds, { x: 10, y: 64, width: 480, height: 320 })
  setWebBounds(owner.webContents.id, null)
  switchWebPageSource(owner.webContents.id, 'online')
  const switchedOnline = owner.contentView.children.find((child) => child instanceof WebContentsView) as WebContentsView
  assert.deepEqual(switchedOnline.getBounds(), scaledArchiveBounds, 'Switching sources must not apply app zoom twice')
  assert.equal(switchedOnline.getVisible(), false, 'Source switching must preserve a hidden native view')
  await waitFor(() => !switchedOnline.webContents.isLoading())
  switchWebPageSource(owner.webContents.id, 'offline')
  const switchedArchive = owner.contentView.children.find((child) => child instanceof WebContentsView) as WebContentsView
  assert.deepEqual(switchedArchive.getBounds(), scaledArchiveBounds)
  owner.webContents.setZoomFactor(1)
  setWebBounds(owner.webContents.id, { x: 0, y: 0, width: 600, height: 400 })
  await waitFor(() => !switchedArchive.webContents.isLoading())
  console.log('PASS: source switches preserve scaled bounds and visibility without applying zoom twice')
  const restored = await readPageScript(switchedArchive.webContents, `({
    image: document.querySelector('#diagram')?.naturalWidth,
    color: getComputedStyle(document.querySelector('h1')).color,
    text: document.body.innerText
  })`) as { image: number; color: string; text: string }
  assert.ok(restored.image > 0, 'Archived image must load without the origin server')
  assert.equal(restored.color, 'rgb(13, 80, 100)')
  assert.match(restored.text, /Interaction worked/)
  // The explicit online-source switch above may request the original URL; the
  // archive reload itself must still avoid requesting its source assets.
  const requestsBeforeOfflineQuestion = webRequests.length
  await checkWheelZoom(switchedArchive.webContents)
  console.log('PASS: Ctrl + wheel zoom also works in script-disabled offline archives')
  const archiveChat = await store.createChat([archive.id])
  await streamChat({ ...first, chatId: archiveChat.id, docIds: [archive.id] }, handlers, { webSenderId: owner.webContents.id })
  assert.equal(webRequests.length, requestsBeforeOfflineQuestion, 'Offline reading and Q&A must not fetch source assets')
  assert.match(JSON.stringify(requests[requests.length - 1].messages), /Interaction worked/)
  assert.doesNotMatch(JSON.stringify(requests[requests.length - 1].messages), /file:/)
  console.log('PASS: offline MHTML restores images, styles and current DOM and supports Q&A without network access')
  networkUnavailable = false
  await readPageScript(switchedArchive.webContents, 'document.querySelector("#link").click()')
  await waitFor(() => webPageState(owner.webContents.id).source === 'online' && webPageState(owner.webContents.id).url.endsWith('/linked'))
  console.log('PASS: external links from offline archives open in the online reader')
  const currentView = owner.contentView.children.find((child) => child instanceof WebContentsView) as WebContentsView
  setWebBounds(owner.webContents.id, null)
  assert.equal(currentView.getVisible(), false)
  const contents = currentView.webContents
  closeWebPage(owner.webContents.id)
  await waitFor(() => contents.isDestroyed())
  mountWebPage(owner.webContents, web.id, { x: 0, y: 0, width: 600, height: 400 })
  await owner.loadURL('about:blank')
  assert.throws(() => webPageState(owner.webContents.id), 'Reloading the app must not leave a native webpage over the new renderer')
  mountWebPage(owner.webContents, web.id, { x: 0, y: 0, width: 600, height: 400 })
  owner.destroy()
  console.log('PASS: embedded navigation, links, interaction, page capture, isolation and cleanup')
}

app.whenReady().then(run).then(() => { server.close(); app.exit(0) }).catch((error) => {
  console.error(error); server.close(); app.exit(1)
})
