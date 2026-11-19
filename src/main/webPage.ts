import { BrowserWindow, WebContentsView, session, type WebContents } from 'electron'
import type { WebBounds, WebPageState, WebPageAction, WebPageSnapshot, WebPageSource } from '../shared/web'
import type { DocumentMeta } from '../shared/types'
import type { ChatContext, InboxAttachment } from '../shared/types'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeWebUrl } from '../shared/web'
import { store } from './store'
import { t } from '../shared/i18n'

const PARTITION = 'persist:arbor-web'
let sessionReady = false
let offlineSessionReady = false
const offlineFiles = new Set<string>()

function isAbortedNavigation(error: unknown): boolean {
  const value = error as { code?: string; errno?: number; message?: string }
  return value?.code === 'ERR_ABORTED' || value?.errno === -3 || /ERR_ABORTED|\(-3\)/.test(value?.message ?? '')
}

function webPreferences(source: WebPageSource = 'online'): Electron.WebPreferences {
  if (source === 'offline') {
    if (!offlineSessionReady) {
      const offline = session.fromPartition('arbor-web-offline')
      offline.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      offline.setPermissionCheckHandler(() => false)
      offline.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !offlineFiles.has(details.url) }))
      offlineSessionReady = true
    }
    return { partition: 'arbor-web-offline', sandbox: true, nodeIntegration: false, contextIsolation: true,
      javascript: false, webSecurity: true, webviewTag: false, navigateOnDragDrop: false }
  }
  if (!sessionReady) {
    const webSession = session.fromPartition(PARTITION)
    webSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    webSession.setPermissionCheckHandler(() => false)
    // 网页下载不自动写入本机；文献导入由应用自己的流程处理。
    webSession.on('will-download', (event) => event.preventDefault())
    sessionReady = true
  }
  return { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false }
}

function restrictNavigation(contents: WebContents,
  open: (url: string) => void = (url) => { void contents.loadURL(url).catch(() => undefined) }, offline = false): void {
  const check = (event: Electron.Event, url: string): void => {
    try {
      const target = normalizeWebUrl(url)
      if (offline) { event.preventDefault(); queueMicrotask(() => open(target)) }
    } catch { event.preventDefault() }
  }
  contents.on('will-navigate', check)
  contents.on('will-redirect', check)
  contents.setWindowOpenHandler(({ url }) => {
    // 一些网站先拿到空白窗口的 WindowProxy，再设置 location；直接 deny 会使 open 返回 null。
    if (!url || url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { show: false } }
    try { const target = normalizeWebUrl(url); queueMicrotask(() => open(target)) } catch { /* 非网页协议不打开 */ }
    return { action: 'deny' }
  })
  contents.on('did-create-window', (child) => {
    let forwarded = false
    const close = (): void => { if (!child.isDestroyed()) child.destroy() }
    const timer = setTimeout(close, 10000)
    const navigate = (event: Electron.Event, url: string): void => {
      if (url === 'about:blank') return
      event.preventDefault()
      if (forwarded) return
      forwarded = true
      let target: string
      try { target = normalizeWebUrl(url) } catch { close(); return }
      queueMicrotask(() => {
        if (!contents.isDestroyed()) open(target)
        close()
      })
    }
    // 空白窗口继承远程父页面的沙盒，不加载应用 preload，也不在桌面显示。
    child.webContents.on('will-navigate', navigate)
    child.webContents.on('will-redirect', navigate)
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.once('destroyed', close)
    child.once('closed', () => { clearTimeout(timer); contents.removeListener('destroyed', close) })
  })
}

// 仅在提问时读取当前 DOM，保留标题/表格/链接/图片说明；不生成本地分页正文。
function extractSnapshot(): WebPageSnapshot {
  const candidates = [...document.querySelectorAll('article, main, [role="main"]')]
  const root = (candidates.sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0]
    ?? document.body).cloneNode(true) as HTMLElement
  root.querySelectorAll('script,style,noscript,nav,aside,footer,form,button,input,select,textarea,iframe,svg,canvas,[hidden],[aria-hidden="true"],[role="navigation"],[role="dialog"]').forEach((node) => node.remove())
  const urlOf = (value: string | null): string => {
    try {
      const url = new URL(value ?? '', location.href)
      return ['http:', 'https:'].includes(url.protocol) ? url.href.replace(/[()\s]/g, (c) => encodeURIComponent(c)) : ''
    } catch { return '' }
  }
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ')
    if (!(node instanceof Element)) return ''
    const tag = node.tagName.toLowerCase()
    const content = () => [...node.childNodes].map(inline).join('')
    if (tag === 'pre') return '\n\n```\n' + (node.textContent ?? '').replace(/```/g, '~~~') + '\n```\n\n'
    if (tag === 'code') return '`' + (node.textContent ?? '').replace(/`/g, '') + '`'
    if (/^h[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + content().trim() + '\n\n'
    if (tag === 'a') {
      const url = urlOf(node.getAttribute('href'))
      return url && content().trim() ? `[${content().trim().replace(/[\[\]]/g, '')}](${url})` : content()
    }
    if (tag === 'img') return node.getAttribute('alt') ? ` [${node.getAttribute('alt')}] ` : ''
    if (tag === 'br') return '\n'
    if (tag === 'li') return '\n- ' + content().trim() + '\n'
    if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map((row) => [...row.querySelectorAll('th,td')]
        .map((cell) => (cell.textContent ?? '').trim().replace(/\s+/g, ' ').replace(/\|/g, '\\|')))
      if (!rows.length) return ''
      const columns = Math.max(...rows.map((row) => row.length))
      const lines = rows.map((row) => '| ' + Array.from({ length: columns }, (_, i) => row[i] ?? '').join(' | ') + ' |')
      lines.splice(1, 0, '| ' + Array(columns).fill('---').join(' | ') + ' |')
      return '\n\n' + lines.join('\n') + '\n\n'
    }
    if (['p', 'div', 'section', 'article', 'main', 'blockquote', 'ul', 'ol', 'dl', 'dt', 'dd'].includes(tag)) {
      return '\n\n' + content().trim() + '\n\n'
    }
    return content()
  }
  const title = (document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || location.hostname).trim()
  const text = inline(root).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const images = [...document.querySelectorAll('article img, main img, [role="main"] img')].slice(0, 100).map((image) => {
    const img = image as HTMLImageElement
    const rect = img.getBoundingClientRect()
    return { src: urlOf(img.currentSrc || img.src), alt: img.alt,
      caption: img.closest('figure')?.querySelector('figcaption')?.textContent?.trim() ?? '',
      visible: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth }
  })
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const visible: string[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!parent || parent.closest('script,style,noscript,[hidden],[aria-hidden="true"]')) continue
    const rect = parent.getBoundingClientRect()
    if (rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight) {
      const value = node.textContent?.trim()
      if (value) visible.push(value)
    }
  }
  return { url: location.href, title, author: document.querySelector('meta[name="author"]')?.getAttribute('content') ?? '',
    text: `# ${title.replace(/\n/g, ' ')}\n\n${text}`, images,
    visibleText: visible.join('\n'), selection: getSelection()?.toString().trim() ?? '' }
}

/** MHTML 禁止页面脚本执行；用调试接口执行应用自带的只读 DOM 提取器，不启用归档内脚本。 */
export async function readPageScript<T = unknown>(contents: WebContents, code: string): Promise<T> {
  if (!contents.getURL().startsWith('file:')) return contents.mainFrame.executeJavaScript(code) as Promise<T>
  const debuggerApi = contents.debugger
  const owned = !debuggerApi.isAttached()
  if (owned) debuggerApi.attach('1.3')
  try {
    const result = await debuggerApi.sendCommand('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Offline page could not be read')
    return result.result.value as T
  } finally { if (owned && debuggerApi.isAttached()) debuggerApi.detach() }
}

export async function captureWebContents(contents: WebContents, sourceUrl?: string): Promise<WebPageSnapshot> {
  const snapshot = await readPageScript<WebPageSnapshot>(contents, `(${extractSnapshot.toString()})()`)
  snapshot.url = normalizeWebUrl(sourceUrl ?? snapshot.url)
  if (!snapshot.text || snapshot.text.length < snapshot.title.length + 10) throw new Error(t('网页没有可导入的正文，请在原网页加载完成后重试'))
  if (snapshot.text.length > 2_000_000) throw new Error(t('网页正文过大，请导入具体文章页面'))
  return snapshot
}

/** 正文可以先于图片、视频和第三方请求就绪，不以整个页面的 load 事件为唯一门槛。 */
function loadReadablePage(win: BrowserWindow, url: string): Promise<void> {
  const contents = win.webContents
  return new Promise((resolve, reject) => {
    let done = false
    let domReady = false
    let checking = false
    let status = 0
    const finish = (error?: Error): void => {
      if (done) return
      done = true
      clearInterval(timer)
      contents.removeListener('dom-ready', onReady)
      contents.removeListener('did-navigate', onNavigate)
      contents.removeListener('did-start-navigation', onStart)
      contents.removeListener('destroyed', onDestroyed)
      error ? reject(error) : resolve()
    }
    const probe = async (): Promise<void> => {
      if (done || !domReady || checking || status >= 400 || contents.isDestroyed()) return
      checking = true
      try {
        const readable = await contents.mainFrame.executeJavaScript(`(() => {
          const article = document.querySelector('article, main, [role="main"]');
          return !!document.title.trim() && ((article?.innerText?.trim().length ?? 0) >= 100 ||
            (document.body?.innerText?.trim().length ?? 0) >= 300);
        })()`)
        if (readable && domReady) finish()
      } catch { /* 页面正在重定向时等待下一次 DOM 就绪 */ }
      finally { checking = false }
    }
    const onReady = (): void => { domReady = true; void probe() }
    const onStart = (_event: Electron.Event, _url: string, inPlace: boolean, main: boolean): void => {
      if (main && !inPlace) domReady = false
    }
    const onNavigate = (_event: Electron.Event, _url: string, code: number): void => { status = code }
    const onDestroyed = (): void => finish(new Error(t('网页读取已停止')))
    const timer = setInterval(() => { void probe() }, 200)
    contents.on('dom-ready', onReady)
    contents.on('did-navigate', onNavigate)
    contents.on('did-start-navigation', onStart)
    contents.once('destroyed', onDestroyed)
    void win.loadURL(url).then(() => {
      // 很短的合法网页仍可在完整加载后导入。
      if (status < 400) finish()
    }).catch((error: Error & { code?: string }) => {
      if (!isAbortedNavigation(error)) finish(error)
    })
  })
}

export async function importWebUrl(input: string, options: { signal?: AbortSignal; onSaving?: () => void; collectionId?: string } = {}): Promise<DocumentMeta> {
  const { signal } = options
  if (signal?.aborted) throw new Error(t('网页导入已取消'))
  if (options.collectionId && !store.data.collections.some(item => item.id === options.collectionId)) throw new Error(t('目标文件夹不存在，请重新选择导入位置'))
  const url = normalizeWebUrl(input)
  const win = new BrowserWindow({ show: false, webPreferences: webPreferences() })
  restrictNavigation(win.webContents)
  let stop!: (error: Error) => void
  const stopped = new Promise<never>((_resolve, reject) => { stop = reject })
  const destroy = (): void => { if (!win.isDestroyed()) win.destroy() }
  const cancel = (): void => { stop(new Error(t('网页导入已取消'))); destroy() }
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => { stop(new Error(t('网页加载超时，请稍后重试'))); destroy() }, 45000)
  try {
    const reading = (async () => {
      await loadReadablePage(win, url)
      // 动态网页允许一个有上限的稳定期。
      await win.webContents.mainFrame.executeJavaScript(`new Promise(resolve => {
        let idle; const finish = () => { clearTimeout(idle); observer.disconnect(); resolve(true) };
        const observer = new MutationObserver(() => { clearTimeout(idle); idle = setTimeout(finish, 500) });
        observer.observe(document.body, { childList: true, subtree: true });
        idle = setTimeout(finish, 500); setTimeout(finish, 2500);
      })`)
      return win.webContents.mainFrame.executeJavaScript(`({ url: location.href,
        title: (document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || location.hostname).trim(),
        author: document.querySelector('meta[name="author"]')?.getAttribute('content') ?? '' })`) as Promise<{ url: string; title: string; author: string }>
    })()
    const snapshot = await Promise.race([reading, stopped])
    if (signal?.aborted) throw new Error(t('网页导入已取消'))
    // 从这里开始提交已经完整读取的快照，不再接受取消，避免“已取消”却仍写入文献。
    options.onSaving?.()
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
    return await store.addWebLink({ ...snapshot, url: normalizeWebUrl(snapshot.url) }, undefined, options.collectionId)
  } catch (error) {
    if (signal?.aborted) throw new Error(t('网页导入已取消'))
    throw new Error(t('网页导入失败：{0}', [(error as Error).message]))
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
    destroy()
  }
}

interface EmbeddedPage {
  owner: BrowserWindow
  sender: WebContents
  view: WebContentsView
  docId: string
  source: WebPageSource
  archiveUrl?: string
  bounds?: WebBounds
  readable?: boolean
  navigation: number
  error?: string
  onClosed: () => void
}
const pages = new Map<number, EmbeddedPage>()

export function closeWebPage(senderId: number): void {
  const page = pages.get(senderId)
  if (!page) return
  pages.delete(senderId)
  if (page.archiveUrl) offlineFiles.delete(page.archiveUrl)
  page.owner.removeListener('closed', page.onClosed)
  page.sender.removeListener('did-start-loading', page.onClosed)
  page.sender.removeListener('render-process-gone', page.onClosed)
  if (!page.owner.isDestroyed()) page.owner.contentView.removeChildView(page.view)
  if (!page.view.webContents.isDestroyed()) page.view.webContents.close()
}

function getPage(senderId: number): EmbeddedPage {
  const page = pages.get(senderId)
  if (!page || !page.view.webContents || page.view.webContents.isDestroyed()) throw new Error(t('原网页尚未打开'))
  return page
}

export function webPageState(senderId: number): WebPageState {
  const page = getPage(senderId)
  const contents = page.view.webContents
  return { url: page.source === 'offline' ? store.getDocument(page.docId)!.url : contents.getURL(), title: contents.getTitle(), loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(), error: page.error,
    source: page.source, hasArchive: !!store.getDocument(page.docId)?.webArchivedAt, readable: page.readable,
    visible: page.view.getVisible() }
}

export function setWebBounds(senderId: number, bounds: WebBounds | null): void {
  const page = pages.get(senderId)
  if (!page) return
  if (!bounds || !Object.values(bounds).every(Number.isFinite)) { page.view.setVisible(false); return }
  page.bounds = { ...bounds }
  // Renderer rectangles use CSS pixels; native View bounds use DIP. Only the
  // application renderer's zoom belongs here, not webpage zoom or display DPI.
  const zoom = page.sender.getZoomFactor()
  const [width, height] = page.owner.getContentSize()
  const x = Math.min(width, Math.max(0, Math.round(bounds.x * zoom)))
  const y = Math.min(height, Math.max(0, Math.round(bounds.y * zoom)))
  const right = Math.min(width, Math.round((bounds.x + bounds.width) * zoom))
  const bottom = Math.min(height, Math.round((bounds.y + bounds.height) * zoom))
  const w = Math.max(0, right - x)
  const h = Math.max(0, bottom - y)
  page.view.setBounds({ x, y, width: w, height: h })
  page.view.setVisible(w > 0 && h > 0)
}

function archiveUrlFor(doc: DocumentMeta): string {
  if (!/^[0-9a-f-]{36}$/i.test(doc.id) || doc.fileName !== `${doc.id}.mhtml`) throw new Error(t('该网页尚未保存离线归档'))
  return pathToFileURL(path.join(store.filesDir, doc.fileName)).href
}

export function mountWebPage(sender: WebContents, docId: string, bounds: WebBounds, source: WebPageSource = 'online', targetUrl?: string): WebPageState {
  const existing = pages.get(sender.id)
  if (existing?.docId === docId && existing.source === source) { setWebBounds(sender.id, bounds); return webPageState(sender.id) }
  closeWebPage(sender.id)
  const doc = store.getDocument(docId)
  if (doc?.sourceFormat !== 'web') throw new Error(t('该文献不是网页'))
  const url = normalizeWebUrl(targetUrl ?? doc.url)
  const owner = BrowserWindow.fromWebContents(sender)
  if (!owner) throw new Error(t('阅读窗口已关闭'))
  const archiveUrl = source === 'offline' ? archiveUrlFor(doc) : undefined
  const view = new WebContentsView({ webPreferences: webPreferences(source) })
  // Native webpage input does not pass through the React reader's wheel handlers.
  // This also works for archives whose page scripts are disabled.
  view.webContents.on('zoom-changed', (_event, direction) => {
    const contents = view.webContents
    const factor = contents.getZoomFactor() * (direction === 'in' ? 1.1 : 1 / 1.1)
    contents.setZoomFactor(Math.min(3, Math.max(0.5, factor)))
  })
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && input.key === '0') {
      event.preventDefault()
      view.webContents.setZoomFactor(1)
    }
  })
  const page: EmbeddedPage = { owner, sender, view, docId, source, archiveUrl, navigation: 0, onClosed: () => closeWebPage(sender.id) }
  if (archiveUrl) offlineFiles.add(archiveUrl)
  pages.set(sender.id, page)
  owner.contentView.addChildView(view)
  restrictNavigation(view.webContents, (target) => {
    if (pages.get(sender.id) !== page) return
    if (source === 'offline') {
      switchWebPageSource(sender.id, 'online', target)
    } else {
      void view.webContents.loadURL(target).catch((error) => {
        if (pages.get(sender.id) === page && !isAbortedNavigation(error)) page.error = error.message
      })
    }
  }, source === 'offline')
  view.webContents.on('did-start-navigation', (_event, _url, inPlace, main) => {
    if (main && !inPlace) { page.error = undefined; page.readable = false; page.navigation++ }
  })
  view.webContents.on('dom-ready', () => { page.readable = true })
  view.webContents.on('did-navigate', () => { page.error = undefined })
  view.webContents.on('did-fail-load', (_event, code, description, _url, main) => {
    if (main && code !== -3) page.error = description
  })
  owner.once('closed', page.onClosed)
  sender.once('did-start-loading', page.onClosed)
  sender.once('render-process-gone', page.onClosed)
  setWebBounds(sender.id, bounds)
  void view.webContents.loadURL(archiveUrl ?? url).catch((error) => {
    if (pages.get(sender.id) === page && !isAbortedNavigation(error)) page.error = error.message
  })
  return { url, title: doc.title, loading: true, canGoBack: false, canGoForward: false, source, hasArchive: !!doc.webArchivedAt }
}

export function switchWebPageSource(senderId: number, source: WebPageSource, targetUrl?: string): WebPageState {
  const current = getPage(senderId)
  const bounds = current.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
  const visible = current.view.getVisible()
  const next = mountWebPage(current.sender, current.docId, bounds, source, targetUrl)
  if (!visible) setWebBounds(senderId, null)
  return next
}

export async function navigateWebPage(senderId: number, input: string): Promise<void> {
  const page = getPage(senderId)
  if (page.source === 'offline') throw new Error(t('请先切换到在线网页再导航'))
  try { await page.view.webContents.loadURL(normalizeWebUrl(input)) }
  catch (error) { if (!isAbortedNavigation(error)) throw error }
}

export function actOnWebPage(senderId: number, action: WebPageAction): void {
  const contents = getPage(senderId).view.webContents
  if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
  else if (action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
  else if (action === 'reload') contents.reload()
}

export async function saveWebPage(senderId: number) {
  const page = getPage(senderId)
  const contents = page.view.webContents
  if (page.source === 'offline') throw new Error(t('当前已是离线网页'))
  const navigation = page.navigation
  const metadata = await contents.mainFrame.executeJavaScript(`({url: location.href, title: document.title, author: document.querySelector('meta[name="author"]')?.getAttribute('content') ?? ''})`) as { url: string; title: string; author: string }
  metadata.url = normalizeWebUrl(metadata.url)
  const document = await store.addWebLink(metadata, async (file) => {
    await contents.savePage(file, 'MHTML')
    if (navigation !== page.navigation) throw new Error(t('保存期间网页发生跳转，请重试'))
  })
  return document
}

export async function selectedWebText(senderId: number) {
  const page = getPage(senderId)
  const text = await readPageScript<string>(page.view.webContents, 'getSelection()?.toString().trim() ?? ""')
  const state = webPageState(senderId)
  return { text, url: state.url, title: state.title }
}

/** 当前浏览页面优先；独立聊天未打开阅读器时临时加载 URL/离线归档，仅在内存中读取。 */
export async function webGrounding(docId: string, senderId: number | undefined, chatId: string, options: ChatContext,
  signal: AbortSignal): Promise<{ context: string; images: InboxAttachment[] }> {
  const doc = store.getDocument(docId)
  if (!doc || doc.sourceFormat !== 'web') throw new Error(t('该文献不是网页'))
  const active = senderId === undefined ? undefined : pages.get(senderId)
  let page = active?.docId === docId ? active : [...pages.values()].find((item) => item.docId === docId && !item.owner.isDestroyed())
  let temporary: BrowserWindow | undefined
  let archiveUrl: string | undefined
  const abort = (): void => { if (temporary && !temporary.isDestroyed()) temporary.destroy() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    if (signal.aborted) throw new Error(t('网页读取已停止'))
    let contents: WebContents
    let sourceUrl: string | undefined
    if (page) {
      contents = page.view.webContents
      sourceUrl = page.source === 'offline' ? doc.url : undefined
      if (page.error) throw new Error(page.error)
      if (!page.readable) throw new Error(t('网页仍在加载，请稍后提问'))
    } else {
      const source = doc.webArchivedAt ? 'offline' : 'online'
      archiveUrl = source === 'offline' ? archiveUrlFor(doc) : undefined
      if (archiveUrl) offlineFiles.add(archiveUrl)
      temporary = new BrowserWindow({ show: false, webPreferences: { ...webPreferences(source), offscreen: true } })
      restrictNavigation(temporary.webContents)
      contents = temporary.webContents
      sourceUrl = source === 'offline' ? doc.url : undefined
      const timeout = setTimeout(abort, 30000)
      try { await loadReadablePage(temporary, archiveUrl ?? normalizeWebUrl(doc.url)) }
      finally { clearTimeout(timeout) }
    }
    const snapshot = await captureWebContents(contents, sourceUrl)
    if (options.contextMode === 'selection' && !(options.selection || snapshot.selection)) throw new Error(t('请先在网页中选择文字'))
    if (signal.aborted) throw new Error(t('网页读取已停止'))
    const body = options.contextMode === 'page' ? snapshot.visibleText ?? snapshot.text : snapshot.text
    const context = [t('当前网页：《{0}》\n来源：{1}', [snapshot.title, snapshot.url]),
      options.contextMode === 'selection' ? t('选中的网页内容：\n{0}', [options.selection || snapshot.selection || '']) : '',
      body.slice(0, store.data.settings.maxContextChars > 0 ? store.data.settings.maxContextChars : 120000),
      snapshot.images?.length ? t('网页图片与说明：\n{0}', [JSON.stringify(snapshot.images)]) : '',
      options.includeNotes && doc.notes ? t('文献笔记：\n{0}', [doc.notes]) : '',
      t('请按网页标题、章节、表格或图片说明定位引用，并附来源网址。网页不使用 PDF 页码。')].filter(Boolean)
    const images: InboxAttachment[] = []
    if (options.webVisual !== false && store.data.settings.visionModel.trim()) {
      try {
        const capture = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        if (capture.isEmpty()) throw new Error('Empty capture')
        const size = capture.getSize()
        const image = size.width > 1600 ? capture.resize({ width: 1600 }) : capture
        images.push(await store.saveChatAttachment(chatId, 'web-viewport.jpg', image.toJPEG(80), 'image'))
        context.push(t('附图是当前可见网页区域的截图，仅据实际可见图片内容作图像判断。'))
      } catch {
        context.push(t('当前网页截图不可用，本轮只能依据文字和图片说明，不能声称已识别图像内容。'))
      }
    } else {
      context.push(t('本轮未提供网页截图，只能依据文字和图片说明，不能判断未提供图像的细节。'))
    }
    return { context: context.join('\n\n'), images }
  } finally {
    signal.removeEventListener('abort', abort)
    abort()
    if (archiveUrl) offlineFiles.delete(archiveUrl)
  }
}
