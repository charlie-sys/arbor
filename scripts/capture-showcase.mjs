import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const port = process.env.CDP_PORT || '9333'
const outDir = resolve('docs/assets/screens')
mkdirSync(outDir, { recursive: true })

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target) {
  console.error('未找到页面目标')
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
}

const send = (method, params = {}) =>
  new Promise((resolvePromise) => {
    nextId += 1
    pending.set(nextId, resolvePromise)
    ws.send(JSON.stringify({ id: nextId, method, params }))
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const evaluate = async (source) => {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {\n${source}\n})()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.result?.exceptionDetails) {
    console.error(JSON.stringify(result.result.exceptionDetails).slice(0, 800))
  }
  return result.result?.result?.value
}

const mouse = (x, y) =>
  send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })

const hoverSidebar = async () => {
  await mouse(4, 420)
  await sleep(450)
}

const leaveSidebar = async () => {
  await mouse(1320, 760)
  await sleep(750)
}

const clickNav = async (label) => {
  await hoverSidebar()
  await evaluate(
    `Array.from(document.querySelectorAll('.nav-item')).find((b) => b.innerText.includes(${JSON.stringify(
      label
    )}))?.click(); return 'ok'`
  )
  await sleep(900)
  await leaveSidebar()
}

const capture = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' })
  if (!result.result?.data) {
    console.error(`截图失败：${name}`)
    return
  }
  writeFileSync(resolve(outDir, `${name}.png`), Buffer.from(result.result.data, 'base64'))
  console.log(`captured ${name}`)
}

await new Promise((r) => (ws.onopen = r))
await send('Page.enable')

await evaluate(`
  localStorage.setItem('zotagent-theme', 'light')
  localStorage.removeItem('arbor-list-width-ratio')
  localStorage.removeItem('arbor-list-column-widths')
  location.reload()
  return 'ok'
`)
await sleep(2600)

await clickNav('文献库')
await capture('library')

await hoverSidebar()
await capture('sidebar')
await leaveSidebar()

await clickNav('AI 对话')
await evaluate(`
  document.querySelectorAll('.notice').forEach((node) => node.remove())
  return 'ok'
`)
await capture('chat')

await clickNav('研究主题')
await capture('topics')
await evaluate(`document.querySelector('.doc-card')?.click(); return 'ok'`)
await sleep(800)
await evaluate(`
  document.querySelectorAll('.notice').forEach((node) => node.remove())
  return 'ok'
`)
await capture('topic-detail')
await evaluate(`
  Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('全部主题'))?.click()
  return 'ok'
`)
await sleep(500)

await clickNav('灵感收集')
await evaluate(`
  Array.from(document.querySelectorAll('.chip-button')).find((b) => b.innerText.includes('待处理'))?.click()
  return 'ok'
`)
await sleep(500)
await capture('inspiration')

await clickNav('截图翻译')
await capture('translations')

await clickNav('设置')
await evaluate(`
  document.querySelectorAll('.kv code').forEach((node) => {
    if (node.textContent.includes('agent-zotero') || node.textContent.includes('\\\\')) {
      node.textContent = 'C:\\\\Users\\\\you\\\\AppData\\\\Roaming\\\\Arbor\\\\data'
    }
  })
  return 'ok'
`)
await capture('settings')
await evaluate(`document.querySelector('.settings-view')?.scrollTo(0, 99999); return 'ok'`)
await sleep(600)
await capture('backups')

await clickNav('文献库')
await evaluate(`document.querySelector('.doc-row .cell-title-text')?.click(); return 'ok'`)
await sleep(4500)
await evaluate(`
  Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('继续阅读'))?.click()
  return 'ok'
`)
await sleep(2200)
await capture('reader')

await evaluate(`
  document.querySelector('button[title="返回文献库"]')?.click()
  return 'ok'
`)
await sleep(800)
await evaluate(`
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  return 'ok'
`)
await sleep(700)
await capture('palette')
await evaluate(`
  Array.from(document.querySelectorAll('.palette-item')).find((b) => b.innerText.includes('主题画布'))?.click()
  return 'ok'
`)
await sleep(900)
await capture('canvas')
await evaluate(`
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  return 'ok'
`)
await sleep(500)
await evaluate(`
  Array.from(document.querySelectorAll('.palette-item')).find((b) => b.innerText.includes('阅读计划'))?.click()
  return 'ok'
`)
await sleep(900)
await capture('reading-plan')

await evaluate(`
  localStorage.setItem('zotagent-theme', 'dark')
  location.reload()
  return 'ok'
`)
await sleep(2600)
await clickNav('文献库')
await capture('dark')

await evaluate(`
  localStorage.setItem('zotagent-theme', 'light')
  location.reload()
  return 'ok'
`)
await sleep(2000)

ws.close()
console.log('done')
process.exit(0)
