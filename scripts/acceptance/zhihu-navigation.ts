import { app, BrowserWindow, WebContentsView } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { store } from '../../src/main/store'
import { importWebUrl, mountWebPage, readPageScript, closeWebPage, webPageState } from '../../src/main/webPage'

const original = 'https://zhuanlan.zhihu.com/p/64485020'
app.setPath('userData', process.env.ARBOR_TEST_DIR!)
app.on('window-all-closed', () => {})
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until<T>(fn: () => Promise<T>, timeout = 15000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value } catch { /* navigation replaces the frame */ }
    await sleep(200)
  }
  throw new Error('Page readiness timed out')
}
async function run() {
  await store.init()
  const doc = await importWebUrl(original)
  const owner = new BrowserWindow({ width: 1100, height: 800, show: false })
  await owner.loadURL('about:blank')
  owner.show()
  owner.focus()
  mountWebPage(owner.webContents, doc.id, { x: 0, y: 0, width: 1100, height: 800 })
  const contents = (owner.contentView.children.find((view) => view instanceof WebContentsView) as WebContentsView).webContents
  const events: unknown[] = []
  for (const event of ['will-navigate', 'will-redirect', 'did-navigate', 'did-navigate-in-page'] as const) {
    contents.on(event, (_event: unknown, url: string) => { events.push({ event, url }); console.log(JSON.stringify({ event, url })) })
  }
  contents.on('did-fail-load', (_event, code, message, url, main) => console.log(JSON.stringify({ event: 'failed', code, message, url, main })))
  contents.on('console-message', (_event, _level, message) => {
    if (/error|failed|blocked/i.test(message)) console.log(JSON.stringify({ event: 'page-console', message: message.slice(0, 240) }))
  })
  await until(async () => await readPageScript(contents, '(document.querySelector("article")?.innerText.length ?? 0) > 1000'))
  const links = await readPageScript<{ text: string; href: string; target: string }[]>(contents, `(() => {
    const root = document.querySelector('.Post-RichTextContainer, .RichContent-inner, article');
    return [...root.querySelectorAll('a[href]')].map(a => ({ text: a.innerText.trim().slice(0,100), href: a.href, target: a.target }))
      .filter(a => /^https?:/.test(a.href));
  })()`)
  console.log(JSON.stringify({ stage: 'actual-article-links', title: await readPageScript(contents, 'document.title'), links }))
  const indexes = process.env.ARBOR_LINK_INDEX ? process.env.ARBOR_LINK_INDEX.split(',').map(Number) : [4, 6, 8]
  for (const index of indexes) {
    const link = links[index]
    if (!link) continue
    if (contents.getURL() !== original) {
      void contents.loadURL(original).catch(() => undefined)
      await until(async () => await readPageScript(contents, 'location.href === ' + JSON.stringify(original) + ' && (document.querySelector("article")?.innerText.length ?? 0) > 1000'))
    }
    events.length = 0
    await readPageScript(contents, `(() => {
      const a = [...document.querySelectorAll('article a[href]')].find(a => a.href === ${JSON.stringify(link.href)});
      if (!a) throw new Error('Actual link not found');
      a.scrollIntoView({ block: 'center', behavior: 'instant' });
    })()`)
    await sleep(250)
    const point = await readPageScript<{ x: number; y: number; hitHref?: string; hitClass?: string }>(contents, `(() => {
      const a = [...document.querySelectorAll('article a[href]')].find(a => a.href === ${JSON.stringify(link.href)});
      const r=[...a.getClientRects()].find(r => r.width > 2 && r.height > 2);
      const x=r.x + Math.min(r.width/2,20), y=r.y + r.height/2, hit=document.elementFromPoint(x,y);
      return {x,y,hitHref:hit?.closest('a')?.href, hitClass:hit?.className};
    })()`)
    if (point.hitHref !== link.href) { console.log(JSON.stringify({ stage: 'link-occluded', index, link, point })); continue }
    contents.focus()
    contents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 })
    await sleep(4500)
    const current = await readPageScript(contents, `({ url: location.href, title: document.title, textChars: document.body?.innerText.length,
      articleChars: document.querySelector('article')?.innerText.length ?? 0,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(d => d.innerText.slice(0,150)),
      preview: document.body?.innerText.slice(0,220) })`).catch((error) => ({ error: String(error) }))
    console.log(JSON.stringify({ stage: 'clicked-link', index, link, point, current, state: webPageState(owner.webContents.id), events }))
    const out = path.join(process.cwd(), 'scripts/acceptance/.generated')
    await fs.mkdir(out, { recursive: true })
    try { await fs.writeFile(path.join(out, `zhihu-link-${index}.png`), (await contents.capturePage()).toPNG()) } catch { /* no display surface */ }
  }
  closeWebPage(owner.webContents.id)
  owner.destroy()
}
app.whenReady().then(run).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1) })
