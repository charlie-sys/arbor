import assert from 'node:assert/strict'
import http from 'node:http'
import { createServer } from 'vite'

const receipts = new Map()
globalThis.localStorage = {
  getItem(key) {
    return receipts.get(key) ?? null
  },
  setItem(key, value) {
    receipts.set(key, String(value))
  },
  removeItem(key) {
    receipts.delete(key)
  }
}

const requests = []
const api = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    requests.push(payload)
    const system = (payload.messages || [])
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n')
    const user = (payload.messages || [])
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n')
    if (!payload.stream) {
      const id = [...user.matchAll(/\[([0-9a-f-]+)\]/g)].at(-1)?.[1]
      let content = '摘要'
      if (system.includes('记忆判断器')) {
        const ops =
          id && user.includes('晚上读论文')
            ? [
                {
                  op: 'add',
                  doc: 'MEMORY.md',
                  section: '用户偏好',
                  line: '- 喜欢晚上读论文',
                  message_ids: [id]
                }
              ]
            : []
        content = JSON.stringify({ ops })
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
      return
    }
    const hasToolResult = (payload.messages || []).some(
      (message) => message.role === 'tool'
    )
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (!hasToolResult) {
      const args = JSON.stringify({ query: '阅读计划怎么用' })
      res.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_help',
                    function: { name: 'search_help', arguments: args }
                  }
                ]
              }
            }
          ]
        })}\n\n`
      )
    } else {
      res.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                content: '阅读计划可从工具菜单进入。（使用说明 · 主题阅读计划）'
              }
            }
          ]
        })}\n\n`
      )
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
const port = api.address().port
const vite = await createServer({
  configFile: './web/vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom'
})

try {
  const { sendWebAli, webAliHelpSections } = await vite.ssrLoadModule(
    '/src/aliAgent.ts'
  )
  assert.equal(webAliHelpSections().length, 73)

  const session = {
    id: 'session',
    title: '新的对话',
    messages: [],
    summary: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  let memory = {
    self: '# 阿栗的自我认知',
    memory: '# 用户长期记忆',
    topics: [],
    archive: '',
    usage: {
      self: { chars: 0, quota: 1800 },
      memory: { chars: 0, quota: 3000 }
    }
  }
  const usage = []
  const events = []
  const host = {
    settings: () => ({
      language: 'zh-CN',
      ali: {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'test',
        model: 'mock',
        temperature: 0.2,
        searchPolicy: 'off',
        memoryEnabled: true,
        memoryExtract: true
      }
    }),
    getSession: (id) => (id === session.id ? session : undefined),
    appendMessage: (_id, message) => {
      session.messages.push(message)
      session.updatedAt = Date.now()
      return session
    },
    updateSession: (_id, patch) => {
      Object.assign(session, patch)
      return session
    },
    memory: () => memory,
    saveMemory: (state) => {
      memory = state
      return state
    },
    emit: (event) => events.push(event),
    recordUsage: (record) => usage.push(record),
    fetchUrl: async () => ({ url: '', title: '', text: '' })
  }

  await sendWebAli(
    {
      requestId: 'help',
      sessionId: session.id,
      content: '阅读计划怎么用？'
    },
    host
  )
  const helpMessage = session.messages.at(-1)
  assert.equal(helpMessage.role, 'assistant')
  assert.deepEqual(helpMessage.helpSections, [
    '8. 主题阅读计划',
    '4.1 打开与继续阅读'
  ])
  assert.equal(helpMessage.toolTraces?.[0]?.name, 'search_help')
  assert.ok(
    requests.some((request) =>
      (request.messages || []).some(
        (message) =>
          message.role === 'system' &&
          String(message.content).includes('使用说明摘录')
      )
    )
  )
  assert.ok(events.some((event) => event.type === 'done'))

  await sendWebAli(
    {
      requestId: 'identity',
      sessionId: session.id,
      content: '我叫唐清忠'
    },
    host
  )
  assert.match(memory.memory, /唐清忠/)

  await sendWebAli(
    {
      requestId: 'memory',
      sessionId: session.id,
      content: '我喜欢晚上读论文'
    },
    host
  )
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.match(memory.memory, /喜欢晚上读论文/)
  assert.ok(usage.some((record) => record.kind === 'ali-memory'))

  console.log(
    'PASS: Web Ali bundles the user guide, retrieves help, executes tools, remembers identity and extracts long-term memory.'
  )
} finally {
  await vite.close()
  await new Promise((resolve) => api.close(resolve))
}
