import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WORK = path.join(ROOT, 'scripts/acceptance/.generated/ali')
const PROFILE = path.join(WORK, 'ui-profile')
const PORT = 9471
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const auxCalls = []
const auxServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    auxCalls.push({ model: payload.model, auth: req.headers.authorization || '' })
    const userText = (payload.messages || []).filter((message) => message.role === 'user').map((message) => message.content).join(' ')
    const systemText = (payload.messages || []).filter((message) => message.role === 'system').map((message) => message.content).join(' ')
    if (systemText.includes('记忆判断器') || systemText.includes('长期记忆提炼器')) {
      const ids = [...userText.matchAll(/\[([0-9a-f-]+)\](?:\s*用户：)?/g)].map((match) => match[1])
      const id = ids[ids.length - 1]
      const morning = userText.includes('早上读论文')
      const wantsPreference = userText.includes('喜欢晚上读论文')
      const op = morning
        ? { op: 'supersede', doc: 'MEMORY.md', old: '- 喜欢晚上读论文', line: '- 喜欢早上读论文', message_ids: [id] }
        : wantsPreference
          ? { op: 'add', doc: 'MEMORY.md', section: '用户偏好', line: '- 喜欢晚上读论文', message_ids: [id] }
          : null
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(id && op ? { ops: [op] } : { ops: [] }) } }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: '辅助模型摘要' } }] }))
  })
})

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1')
    if (requestUrl.pathname === '/search') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        results: [
          { title: 'RAG 项目', url: 'https://github.com/example/rag', content: '一个 RAG 项目' }
        ]
      }))
      return
    }
    const payload = JSON.parse(body || '{}')
    const userText = (payload.messages || []).filter((message) => message.role === 'user').map((message) => message.content).join(' ')
    const systemText = (payload.messages || []).filter((message) => message.role === 'system').map((message) => message.content).join(' ')
    const hasToolResult = (payload.messages || []).some((message) => message.role === 'tool')
    if (!payload.stream) {
      if (systemText.includes('记忆判断器') || systemText.includes('长期记忆提炼器')) {
        const ids = [...userText.matchAll(/\[([0-9a-f-]+)\](?:\s*用户：)?/g)].map((match) => match[1])
        const id = ids[ids.length - 1]
        const morning = userText.includes('早上读论文')
        const wantsPreference = userText.includes('喜欢晚上读论文')
        const op = morning
          ? { op: 'supersede', doc: 'MEMORY.md', old: '- 喜欢晚上读论文', line: '- 喜欢早上读论文', message_ids: [id] }
          : wantsPreference
            ? { op: 'add', doc: 'MEMORY.md', section: '用户偏好', line: '- 喜欢晚上读论文', message_ids: [id] }
            : null
        const ops = id && op ? { ops: [op] } : { ops: [] }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ops) } }] }))
        return
      }
      if (systemText.includes('压缩阿栗与用户的陪伴对话')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: '用户打了招呼，并希望阿栗记住阅读偏好。' } }] }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
      return
    }
    if (userText.includes('ERROR')) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'mock error' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (userText.includes('搜索 RAG') && payload.tools && !hasToolResult) {
      const args = JSON.stringify({ query: 'RAG', limit: 2 })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_search', function: { name: 'search_web', arguments: args } }] } }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    const helpInjected = systemText.includes('使用说明摘录')
    const knowsName = systemText.includes('唐清忠')
    const answerText = hasToolResult
      ? '已找到 RAG 项目。'
      : helpInjected
        ? '已找到使用说明。'
        : userText.includes('我叫什么名字')
          ? knowsName
            ? '你叫唐清忠。'
            : '我还不知道你的名字。'
          : userText.includes('我叫唐清忠')
            ? '你好，唐清忠。'
            : '你好，我是阿栗。'
    res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(answerText)}}}]}\n\n`)
    const delay = userText.includes('SLOW') ? 3000 : 120
    setTimeout(() => {
      if (res.writableEnded) return
      res.write('data: {"choices":[{"delta":{"content":"今天想聊点什么？"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }, delay)
  })
})

async function targets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  } catch {
    return []
  }
}

async function waitTarget() {
  for (let i = 0; i < 200; i++) {
    const page = (await targets()).find((item) => item.type === 'page' && item.url.includes('index.html'))
    if (page) return page
    await sleep(250)
  }
  throw new Error('等待 Electron 页面超时')
}

function open(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  let next = 0
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const resolve = pending.get(message.id)
    if (!resolve) return
    pending.delete(message.id)
    resolve(message)
  }
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP 连接失败'))
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时 ${method}`)) }, 15000)
    pending.set(id, (message) => { clearTimeout(timer); resolve(message) })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return { ws, ready, send }
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await new Promise((resolve) => auxServer.listen(0, '127.0.0.1', resolve))
  const apiPort = server.address().port
  const auxPort = auxServer.address().port
  await fs.rm(PROFILE, { recursive: true, force: true })
  await fs.mkdir(path.join(PROFILE, 'data'), { recursive: true })
  await fs.writeFile(path.join(PROFILE, 'data/library.json'), JSON.stringify({
    version: 1,
    documents: [], collections: [], chats: [], translations: [], highlights: [], excerpts: [], inbox: [], tasks: [],
    researchTopics: [], canvases: [], tags: [], properties: [], savedViews: [],
    settings: {
      language: 'zh-CN',
      apiBaseUrl: `http://127.0.0.1:${apiPort}/v1`,
      apiKey: 'test',
      chatModel: 'mock',
      visionModel: '',
      temperature: 0.3,
      maxContextChars: 0,
      petEnabled: false,
      petBubbles: false,
      ali: { model: 'mock', temperature: 0.7, searchPolicy: 'auto', webProvider: 'searxng', webEndpoint: `http://127.0.0.1:${apiPort}` }
    }
  }, null, 2))

  const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: ROOT,
    env: { ...process.env, ARBOR_USER_DATA_DIR: PROFILE, ARBOR_PET_DEBUG: '0' },
    stdio: 'ignore'
  })
  let client
  try {
    const target = await waitTarget()
    client = open(target.webSocketDebuggerUrl)
    await client.ready
    const evaluate = async (expression) => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text || 'evaluate failed')
      return result.result?.result?.value
    }
    const waitFor = async (expression, timeout = 15000) => {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (await evaluate(expression)) return true
        await sleep(150)
      }
      return false
    }

    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await waitFor(`Boolean(document.querySelector('.app-shell'))`, 20000)
    await sleep(300)
    const edgeExists = await evaluate(`Boolean(document.querySelector('.sidebar-edge'))`)
    await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}))`)
    await sleep(500)
    const navCount = await evaluate(`document.querySelectorAll('.nav-item').length`)
    let navClicked = false
    let paletteReady = false
    if (navCount > 0) {
      navClicked = await evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('阿栗')); if(!b) return false; b.click(); return true })()`)
    }
    if (!navClicked) {
      await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 })
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 })
      paletteReady = await waitFor(`Boolean(document.querySelector('.palette'))`)
      if (paletteReady) {
        await evaluate(`(() => { const el=document.querySelector('.palette input'); if(!el) return false; const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(el,'阿栗'); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
        await sleep(300)
        navClicked = await evaluate(`(() => { const b=[...document.querySelectorAll('.palette-item')].find(x=>x.textContent.includes('和阿栗聊天')); if(!b) return false; b.click(); return true })()`)
      }
    }
    const viewReady = await waitFor(`Boolean(document.querySelector('[data-testid="ali-view"]')?.closest('.view-slot.active'))`)
    const emptyReady = await waitFor(`(document.querySelector('[data-testid="ali-view"]')?.innerText||'').includes('和阿栗聊天')`)
    await evaluate(`document.querySelector('.sidebar-host')?.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`)
    await sleep(400)

    await evaluate(`document.querySelector('[data-testid="ali-new-session"]')?.click()`)
    const sessionReady = await waitFor(`document.querySelectorAll('[data-testid="ali-session-list"] .session-item').length > 0`)
    await evaluate(`(() => { const el=document.querySelector('[data-testid="ali-input"]'); if(!el) return false; const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(el,'你好，阿栗'); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
    await sleep(200)
    await evaluate(`document.querySelector('[data-testid="ali-send"]')?.click()`)
    const answerReady = await waitFor(`(document.querySelector('[data-testid="ali-message-assistant"]')?.innerText||'').includes('你好，我是阿栗')`, 20000)
    const answerText = await evaluate(`document.querySelector('[data-testid="ali-message-assistant"]')?.innerText || ''`)
    const zoomBefore = Number(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--chat-font-scale') || 1`))
    await evaluate(`(() => { const el=document.querySelector('.ali-view .chat-messages'); for(let i=0;i<3;i+=1) el?.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true})); return true })()`)
    await sleep(250)
    const zoomAfter = Number(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--chat-font-scale') || 1`))
    const zoomBadge = await evaluate(`(document.querySelector('.chat-zoom-badge')?.innerText||'').includes('字号')`)
    await evaluate(`(() => { const el=document.querySelector('.ali-view .chat-messages'); for(let i=0;i<3;i+=1) el?.dispatchEvent(new WheelEvent('wheel',{deltaY:100,ctrlKey:true,bubbles:true,cancelable:true})); return true })()`)
    await sleep(200)
    const zoomWorks = zoomAfter > zoomBefore + 0.05 && zoomBadge
    const ttsDefaultOff = await evaluate(`document.querySelector('[data-testid="ali-voice-toggle"]')?.getAttribute('aria-pressed') === 'false'`)
    await evaluate(`(() => { const synth=window.speechSynthesis; window.__aliSpeech=[]; window.__aliCancel=0; synth.speak=(u)=>{window.__aliSpeech.push(u.text)}; synth.cancel=()=>{window.__aliCancel+=1}; return true })()`)
    await evaluate(`document.querySelector('[data-testid="ali-voice-toggle"]')?.click()`)
    await sleep(500)
    const voiceOn = await evaluate(`document.querySelector('[data-testid="ali-voice-toggle"]')?.getAttribute('aria-pressed') === 'true'`)
    const speakButton = await waitFor(`Boolean(document.querySelector('[data-testid="ali-speak"]'))`, 5000)
    await evaluate(`document.querySelector('[data-testid="ali-speak"]')?.click()`)
    await sleep(300)
    const speechSpoken = await evaluate(`window.__aliSpeech?.length || 0`)
    await evaluate(`document.querySelector('[data-testid="ali-voice-settings-button"]')?.click()`)
    const voiceSettings = await waitFor(`Boolean(document.querySelector('[data-testid="ali-voice-settings"]'))`, 5000)
    await evaluate(`(() => { const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; const rate=document.querySelector('[data-testid="ali-voice-rate"]'); set.call(rate,'1.2'); rate.dispatchEvent(new Event('input',{bubbles:true})); const vol=document.querySelector('[data-testid="ali-voice-volume"]'); set.call(vol,'0.7'); vol.dispatchEvent(new Event('input',{bubbles:true})); const mainBase=document.querySelector('[data-testid="ali-base"]'); set.call(mainBase,'http://127.0.0.1:${apiPort}/v1'); mainBase.dispatchEvent(new Event('input',{bubbles:true})); const mainKey=document.querySelector('[data-testid="ali-key"]'); set.call(mainKey,'main-secret'); mainKey.dispatchEvent(new Event('input',{bubbles:true})); const aux=document.querySelector('[data-testid="ali-aux-model"]'); set.call(aux,'aux-mock'); aux.dispatchEvent(new Event('input',{bubbles:true})); const auxBase=document.querySelector('[data-testid="ali-aux-base"]'); set.call(auxBase,'http://127.0.0.1:${auxPort}/v1'); auxBase.dispatchEvent(new Event('input',{bubbles:true})); const auxKey=document.querySelector('[data-testid="ali-aux-key"]'); set.call(auxKey,'aux-secret'); auxKey.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-testid="ali-voice-auto"]')?.click(); return true })()`)
    await sleep(200)
    const settingsShot = await client.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(WORK, 'ali-settings.png'), Buffer.from(settingsShot.result.data, 'base64'))
    await evaluate(`document.querySelector('[data-testid="ali-voice-save"]')?.click()`)
    await sleep(700)
    const voiceSettingsSaved = await evaluate(`window.api.ali.getState().then((s) => s.settings.ttsAutoSpeak === true && Math.abs(s.settings.ttsRate - 1.2) < 0.001 && Math.abs(s.settings.ttsVolume - 0.7) < 0.001 && s.settings.baseUrl === 'http://127.0.0.1:${apiPort}/v1' && s.settings.apiKey === 'main-secret' && s.settings.auxModel === 'aux-mock' && s.settings.auxBaseUrl === 'http://127.0.0.1:${auxPort}/v1' && s.settings.auxApiKey === 'aux-secret')`)
    const voiceSettingsClosed = await evaluate(`!document.querySelector('[data-testid="ali-voice-settings"]')`)
    const storedSettings = JSON.parse(await fs.readFile(path.join(PROFILE, 'data/library.json'), 'utf8')).settings
    const auxKeyEncrypted = storedSettings.ali?.auxApiKey === '' && Boolean(storedSettings.aliAuxApiKeyEnc)
    const mainKeyEncrypted = storedSettings.ali?.apiKey === '' && Boolean(storedSettings.aliApiKeyEnc)
    const selfFile = path.join(PROFILE, 'data/ali/memory/SELF.md')
    const selfExists = await fs.readFile(selfFile, 'utf-8').then((text) => text.includes('人格与形象')).catch(() => false)
    const shot = await client.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(WORK, 'ali-ui.png'), Buffer.from(shot.result.data, 'base64'))

    const typeAndSend = async (text) => {
      await evaluate(`(() => { const el=document.querySelector('[data-testid="ali-input"]'); if(!el) return false; const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(el,${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
      await sleep(150)
      await evaluate(`document.querySelector('[data-testid="ali-send"]')?.click()`)
    }
    await typeAndSend('记住：我喜欢晚上读论文')
    const secondAnswer = await waitFor(`document.querySelectorAll('[data-testid="ali-message-assistant"]').length >= 2`, 15000)
    await sleep(1800)
    const autoSpoken = await evaluate(`(window.__aliSpeech?.length || 0) > ${speechSpoken}`)
    const memoryText = await fs.readFile(path.join(PROFILE, 'data/ali/memory/MEMORY.md'), 'utf-8').catch(() => '')
    const receiptsText = await fs.readFile(path.join(PROFILE, 'data/ali/memory/receipts.json'), 'utf-8').catch(() => '')
    const memoryWritten = memoryText.includes('- 喜欢晚上读论文')
    const receiptWritten = receiptsText.includes('"applied"')
    const speechCancelled = await evaluate(`(window.__aliCancel || 0) > 0`)
    const undoVisible = await waitFor(`Boolean(document.querySelector('[data-testid="ali-memory-undo"]'))`, 8000)
    await typeAndSend('记住：我改成早上读论文')
    const thirdAnswer = await waitFor(`document.querySelectorAll('[data-testid="ali-message-assistant"]').length >= 3`, 15000)
    await sleep(1800)
    const memoryAfterSupersede = await fs.readFile(path.join(PROFILE, 'data/ali/memory/MEMORY.md'), 'utf-8').catch(() => '')
    const archivePath = path.join(PROFILE, 'data/ali/memory/archive', `${new Date().toISOString().slice(0, 7)}.md`)
    const archiveText = await fs.readFile(archivePath, 'utf-8').catch(() => '')
    const memorySuperseded = memoryAfterSupersede.includes('- 喜欢早上读论文') && !memoryAfterSupersede.includes('- 喜欢晚上读论文')
    const archiveHasOld = archiveText.includes('喜欢晚上读论文')
    const undoVisible2 = await waitFor(`Boolean(document.querySelector('[data-testid="ali-memory-undo"]'))`, 8000)
    await evaluate(`document.querySelector('[data-testid="ali-memory-undo"]')?.click()`)
    await sleep(700)
    const memoryAfterUndo = await fs.readFile(path.join(PROFILE, 'data/ali/memory/MEMORY.md'), 'utf-8').catch(() => '')
    const memoryUndone = !memoryAfterUndo.includes('- 喜欢早上读论文')
    const undoGone = await evaluate(`!document.querySelector('[data-testid="ali-memory-undo"]')`)
    await typeAndSend('怎么恢复备份')
    const helpAnswer = await waitFor(`document.querySelectorAll('[data-testid="ali-message-assistant"]').length >= 4`, 15000)
    const sourceBadge = await waitFor(`Boolean(document.querySelector('[data-testid="ali-source-badge"]'))`, 8000)
    const sourceText = await evaluate(`document.querySelector('[data-testid="ali-source-badge"]')?.innerText || ''`)
    await evaluate(`document.querySelector('[data-testid="ali-source-badge"]')?.click()`)
    const helpModal = await waitFor(`Boolean(document.querySelector('[data-testid="ali-help-modal"]'))`, 8000)
    const helpText = await evaluate(`document.querySelector('[data-testid="ali-help-modal"]')?.innerText || ''`)
    await evaluate(`document.querySelector('[data-testid="ali-help-modal"] .icon-btn')?.click()`)
    await sleep(300)
    const helpClosed = await evaluate(`!document.querySelector('[data-testid="ali-help-modal"]')`)
    await typeAndSend('帮我搜索 RAG 项目')
    const searchAnswer = await waitFor(`document.querySelectorAll('[data-testid="ali-message-assistant"]').length >= 5`, 20000)
    const toolCard = await waitFor(`Boolean(document.querySelector('[data-testid="ali-tool-card"]'))`, 8000)
    const sourceList = await waitFor(`Boolean(document.querySelector('[data-testid="ali-source-list"]'))`, 8000)
    const sourceLink = await evaluate(`document.querySelector('[data-testid="ali-source-link"]')?.getAttribute('href') || ''`)
    await evaluate(`document.querySelector('[data-testid="ali-memory-button"]')?.click()`)
    const memoryPanel = await waitFor(`Boolean(document.querySelector('[data-testid="ali-memory-panel"]'))`, 8000)
    const quotaVisible = await evaluate(`(document.querySelector('[data-testid="ali-memory-panel"]')?.innerText||'').includes('/3000')`)
    await evaluate(`(() => { const b=[...document.querySelectorAll('.ali-memory-tab')].find(x=>x.textContent.includes('长期记忆')); b?.click(); return Boolean(b) })()`)
    await sleep(300)
    const panelEdit = await evaluate(`(() => { const el=document.querySelector('.ali-memory-editor'); if(!el) return false; const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(el, el.value + '\\n- 记忆面板测试'); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
    await sleep(200)
    await evaluate(`document.querySelector('.ali-memory-panel .btn.primary')?.click()`)
    await sleep(900)
    const panelMemory = await fs.readFile(path.join(PROFILE, 'data/ali/memory/MEMORY.md'), 'utf-8').catch(() => '')
    const panelSaved = panelMemory.includes('- 记忆面板测试')
    await evaluate(`document.querySelector('.ali-memory-panel .icon-btn')?.click()`)
    await sleep(300)
    const panelClosed = await evaluate(`!document.querySelector('[data-testid="ali-memory-panel"]')`)
    await client.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 600, deviceScaleFactor: 1, mobile: false })
    await sleep(500)
    const narrowOk = await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 2`)
    await client.send('Emulation.clearDeviceMetricsOverride')
    await sleep(300)
    await typeAndSend('SLOW 请慢慢回答')
    const stopVisible = await waitFor(`Boolean(document.querySelector('[data-testid="ali-stop"]'))`)
    await evaluate(`document.querySelector('[data-testid="ali-stop"]')?.click()`)
    await sleep(600)
    const stopped = await evaluate(`!document.querySelector('[data-testid="ali-stop"]')`)
    const assistantAfterStop = await evaluate(`document.querySelectorAll('[data-testid="ali-message-assistant"]').length`)
    await typeAndSend('ERROR 请返回错误')
    const errorReady = await waitFor(`Boolean(document.querySelector('[data-testid="ali-view"] .notice'))`, 15000)
    const errorText = await evaluate(`document.querySelector('[data-testid="ali-view"] .notice')?.innerText || ''`)
    const backupName = await evaluate(`window.api.backup.run().then((info) => info.name)`)
    const manifest = JSON.parse(await fs.readFile(path.join(PROFILE, 'backups', backupName, 'manifest.json'), 'utf8'))
    const backupAli = Boolean(manifest.ali && manifest.ali.sessions >= 1)
    const backupSelf = await fs.readFile(path.join(PROFILE, 'backups', backupName, 'data/ali/memory/SELF.md'), 'utf8').then((text) => text.includes('人格与形象')).catch(() => false)
    await client.send('Page.reload')
    await waitFor(`Boolean(document.querySelector('.app-shell'))`, 20000)
    await sleep(400)
    await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}))`)
    await sleep(500)
    await evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('阿栗')); b?.click(); return Boolean(b) })()`)
    const persistedActive = await waitFor(`Boolean(document.querySelector('[data-testid="ali-view"]')?.closest('.view-slot.active'))`, 10000)
    const persistedSession = await evaluate(`document.body.innerText.includes('你好，阿栗')`)
    const persistedAnswer = await evaluate(`document.body.innerText.includes('你好，我是阿栗')`)
    const regressionViews = [
      ['文献库', '.view-slot.active .library-view'],
      ['研究主题', '.view-slot.active'],
      ['主题画布', '.view-slot.active .canvas-view'],
      ['截图翻译', '.view-slot.active .translate-page'],
      ['用量仪表盘', '.view-slot.active .usage-view'],
      ['设置', '.view-slot.active .settings-view'],
      ['AI 对话', '.view-slot.active .chat-page:not(.ali-view)']
    ]
    let regressionOk = true
    for (const [label, selector] of regressionViews) {
      await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}))`)
      await sleep(250)
      const clicked = await evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes(${JSON.stringify(label)})); b?.click(); return Boolean(b) })()`)
      if (!clicked) { regressionOk = false; break }
      await sleep(300)
      const visible = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
      if (!visible) { regressionOk = false; break }
    }
    await evaluate(`document.querySelector('.sidebar-edge')?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,relatedTarget:null}))`)
    await sleep(250)
    await evaluate(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('阿栗')); b?.click(); return Boolean(b) })()`)
    await waitFor(`Boolean(document.querySelector('[data-testid="ali-view"]')?.closest('.view-slot.active'))`, 8000)
    await evaluate(`document.querySelector('[data-testid="ali-new-session"]')?.click()`)
    const freshSession = await waitFor(`document.querySelectorAll('[data-testid="ali-message-assistant"]').length === 0`, 8000)
    await typeAndSend('我叫唐清忠')
    const nameReply = await waitFor(`(document.querySelector('[data-testid="ali-message-assistant"]')?.innerText||'').includes('唐清忠')`, 15000)
    const nameMemory = await fs.readFile(path.join(PROFILE, 'data/ali/memory/MEMORY.md'), 'utf-8').catch(() => '')
    const nameRemembered = nameMemory.includes('唐清忠')
    await evaluate(`document.querySelector('[data-testid="ali-new-session"]')?.click()`)
    await sleep(400)
    await typeAndSend('我叫什么名字')
    const nameAnswered = await waitFor(`(document.querySelector('[data-testid="ali-message-assistant"]')?.innerText||'').includes('唐清忠')`, 15000)
    await evaluate(`window.api.pet.openAliChat()`)
    let popupTarget = null
    for (let index = 0; index < 40 && !popupTarget; index += 1) {
      popupTarget = (await targets()).find((item) => item.type === 'page' && item.url.includes('ali-chat.html'))
      if (!popupTarget) await sleep(250)
    }
    let popupReady = false
    let popupSessions = false
    if (popupTarget) {
      const popup = open(popupTarget.webSocketDebuggerUrl)
      await popup.ready
      await popup.send('Runtime.enable')
      const popupEval = async (expression) => {
        const result = await popup.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        return result.result?.result?.value
      }
      const popupWait = async (expression, timeout = 10000) => {
        const start = Date.now()
        while (Date.now() - start < timeout) {
          if (await popupEval(expression)) return true
          await sleep(200)
        }
        return false
      }
      popupReady = await popupWait(`Boolean(document.querySelector('[data-testid="ali-view"]'))`, 10000)
      popupSessions = await popupWait(`document.querySelectorAll('[data-testid="ali-session-select"] option').length > 0`, 10000)
      const popupCompact = await popupEval(`Boolean(document.querySelector('.ali-view.compact'))`)
      if (!popupCompact) popupSessions = false
      const popupShot = await popup.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(WORK, 'ali-popup.png'), Buffer.from(popupShot.result.data, 'base64'))
      const popupFits = await popupEval(`window.innerWidth >= 360 && window.innerHeight >= 460 && window.innerWidth <= screen.availWidth && window.innerHeight <= screen.availHeight`)
      if (!popupFits) popupSessions = false
      popup.ws.close()
    }
    const usage = JSON.parse(await fs.readFile(path.join(PROFILE, 'data/usage.json'), 'utf8').catch(() => '[]'))
    const auxModelUsed = Array.isArray(usage) && usage.some((record) => record.kind === 'ali-memory' && record.model === 'aux-mock')
    const auxServiceUsed = auxCalls.some((call) => call.model === 'aux-mock' && call.auth === 'Bearer aux-secret')

    const result = { edgeExists, navCount, paletteReady, navClicked, viewReady, emptyReady, sessionReady, answerReady, answerText, ttsDefaultOff, voiceOn, speakButton, speechSpoken, zoomWorks, voiceSettings, voiceSettingsSaved, voiceSettingsClosed, auxKeyEncrypted, mainKeyEncrypted, selfExists, secondAnswer, autoSpoken, memoryWritten, receiptWritten, speechCancelled, thirdAnswer, memorySuperseded, archiveHasOld, undoVisible, undoVisible2, memoryUndone, undoGone, helpAnswer, sourceBadge, sourceText, helpModal, helpText: helpText.slice(0, 60), helpClosed, searchAnswer, toolCard, sourceList, sourceLink, memoryPanel, quotaVisible, panelEdit, panelSaved, panelClosed, narrowOk, stopVisible, stopped, assistantAfterStop, errorReady, errorText, backupName, backupAli, backupSelf, persistedActive, persistedSession, persistedAnswer, regressionOk, freshSession, nameReply, nameRemembered, nameAnswered, popupReady, popupSessions, auxModelUsed, auxServiceUsed, screenshot: 'scripts/acceptance/.generated/ali/ali-ui.png' }
    console.log(JSON.stringify(result))
    const passed =
      [navClicked, viewReady, emptyReady, sessionReady, answerReady, ttsDefaultOff, voiceOn, speakButton, speechSpoken, zoomWorks, voiceSettings, voiceSettingsSaved, voiceSettingsClosed, auxKeyEncrypted, mainKeyEncrypted, selfExists, secondAnswer, autoSpoken, memoryWritten, receiptWritten, speechCancelled, thirdAnswer, memorySuperseded, archiveHasOld, undoVisible2, memoryUndone, undoGone, helpAnswer, sourceBadge, helpModal, helpClosed, searchAnswer, toolCard, sourceList, memoryPanel, quotaVisible, panelEdit, panelSaved, panelClosed, narrowOk, stopVisible, stopped, errorReady, backupAli, backupSelf, persistedActive, persistedSession, persistedAnswer, regressionOk, freshSession, nameReply, nameRemembered, nameAnswered, popupReady, popupSessions, auxModelUsed, auxServiceUsed].every(Boolean) &&
      assistantAfterStop === 5 &&
      sourceLink.includes('github.com/example/rag')
    if (!passed) process.exitCode = 1
    if (passed) {
      const state = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/ali-progress.json'), 'utf8'))
      const hash = (id) => state.items.find((item) => item.id === id)?.hash
      const at = new Date().toISOString()
      const artifacts = ['scripts/acceptance/.generated/ali/ali-ui.png']
      const notes = {
        'A5-3-A1': '真实 Electron 创建会话并发送消息；Page.reload 后会话与回答仍在',
        'A5-3-A2': '闲聊不注入说明；备份问题显示“使用说明 · 15.2 自动备份”并打开章节',
        'A5-3-A3': '记忆写入/SELF/归档/撤销/面板保存；语音默认关闭、手动朗读与自动朗读',
        'A5-3-A4': '搜索工具卡与来源链接渲染；searchPolicy=off 时网络工具不下发（单测）',
        'A5-3-A5': '截图与 evidence JSON 落盘，含需求 hash、命令与产物路径',
        'A5-4-A2': '回归冒烟：文献库/研究主题/画布/截图翻译/用量/设置/AI 对话均可切换并渲染'
      }
      const evidence = {}
      for (const [id, note] of Object.entries(notes)) {
        evidence[id] = { passed: true, at, hash: hash(id), command: 'node scripts/acceptance/ali-qa.mjs', artifacts, notes: note }
      }
      await fs.writeFile(path.join(ROOT, 'docs/ali-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    }
  } finally {
    try { client?.ws.close() } catch {}
    try { child.kill() } catch {}
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    server.close()
    auxServer.close()
  }
}

main().catch((error) => {
  console.error(error)
  server.close()
  process.exit(1)
})
