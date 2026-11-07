import http from 'http'
import { globalSearch } from './search'
import { store } from './store'

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: JsonRpcId
  method?: unknown
  params?: unknown
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean }
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'search_library',
    description: '在文献全文、标题、作者、摘要、标签、摘录与对话中检索，返回命中片段与页码。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词' },
        limit: { type: 'integer', description: '返回条数上限，默认 20，最大 50' }
      },
      required: ['query']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_documents',
    description: '列出文献库中的文献元数据（标题、作者、年份、期刊、标签、阅读状态、页数）。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_document_text',
    description: '读取某篇文献的原文文本，可按页码区间截取（页码从 1 开始）。',
    inputSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: '文献 ID' },
        startPage: { type: 'integer', description: '起始页码，默认 1' },
        endPage: { type: 'integer', description: '结束页码（含），默认起始页 + 4' }
      },
      required: ['docId']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_excerpts',
    description: '读取摘录/笔记，可按文献 ID 过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: '仅返回该文献的摘录' },
        limit: { type: 'integer', description: '返回条数上限，默认 50' }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_chat_history',
    description: '读取 AI 对话历史；不传 chatId 时返回最近对话列表。',
    inputSchema: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: '对话 ID' },
        limit: { type: 'integer', description: '返回对话数量上限，默认 10' }
      }
    },
    annotations: { readOnlyHint: true }
  }
]

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Accept',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  })
  res.end(body)
}

function result(id: JsonRpcId, value: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: value }
}

function error(id: JsonRpcId, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'search_library') {
    const query = asString(args.query)
    if (!query) throw new Error('缺少参数 query')
    const limit = Math.min(50, Math.max(1, asNumber(args.limit) ?? 20))
    return globalSearch(query, limit)
  }
  if (name === 'list_documents') {
    return store.data.documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      authors: doc.authors,
      year: doc.year,
      journal: doc.journal,
      doi: doc.doi,
      tags: doc.tags,
      collections: doc.collections,
      readingStatus: doc.readingStatus ?? 'unread',
      pageCount: doc.pageCount,
      lastPage: doc.lastPage ?? 1,
      updatedAt: doc.updatedAt
    }))
  }
  if (name === 'get_document_text') {
    const docId = asString(args.docId)
    if (!docId) throw new Error('缺少参数 docId')
    const doc = store.getDocument(docId)
    if (!doc) throw new Error(`文献不存在：${docId}`)
    const pages = await store.getDocumentTexts(docId)
    const startPage = Math.max(1, Math.floor(asNumber(args.startPage) ?? 1))
    const endPage = Math.max(startPage, Math.min(pages.length, Math.floor(asNumber(args.endPage) ?? startPage + 4)))
    const slice = pages.slice(startPage - 1, endPage).map((text, index) => ({ page: startPage + index, text }))
    return { docId, title: doc.title, pageCount: pages.length, startPage, endPage, pages: slice }
  }
  if (name === 'list_excerpts') {
    const docId = asString(args.docId)
    const limit = Math.min(500, Math.max(1, asNumber(args.limit) ?? 50))
    return store.data.excerpts
      .filter((excerpt) => !docId || excerpt.docId === docId)
      .slice(0, limit)
      .map((excerpt) => ({
        id: excerpt.id,
        docId: excerpt.docId,
        docTitle: excerpt.docTitle,
        page: excerpt.page,
        source: excerpt.source,
        question: excerpt.question,
        answer: excerpt.answer,
        docMissing: excerpt.docMissing ?? false,
        createdAt: excerpt.createdAt
      }))
  }
  if (name === 'get_chat_history') {
    const chatId = asString(args.chatId)
    const limit = Math.min(50, Math.max(1, asNumber(args.limit) ?? 10))
    const chats = chatId
      ? store.data.chats.filter((chat) => chat.id === chatId)
      : [...store.data.chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
    return chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      docIds: chat.docIds,
      updatedAt: chat.updatedAt,
      messages: chat.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        quotedPage: message.quotedPage,
        createdAt: message.createdAt
      }))
    }))
  }
  throw new Error(`未知工具：${name}`)
}

async function handleMessage(message: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return error(message?.id ?? null, -32600, 'Invalid Request')
  }
  const id = message.id ?? null
  const method = message.method
  const params = (message.params ?? {}) as Record<string, unknown>

  if (method.startsWith('notifications/')) return null
  if (method === 'initialize') {
    return result(id, {
      protocolVersion: asString(params.protocolVersion) ?? '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'arbor-mcp', version: '0.1.0' },
      instructions:
        'Arbor 只读 MCP 服务：可检索文献、读取原文、摘录与对话历史。服务不注册任何写入工具，不会修改本地文献库。'
    })
  }
  if (method === 'ping') return result(id, {})
  if (method === 'tools/list') return result(id, { tools: TOOLS })
  if (method === 'tools/call') {
    const name = asString(params.name)
    if (!name) return error(id, -32602, '缺少工具名称')
    const args = (params.arguments ?? {}) as Record<string, unknown>
    try {
      const data = await callTool(name, args)
      return result(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: false })
    } catch (err) {
      return result(id, { content: [{ type: 'text', text: `错误：${(err as Error).message}` }], isError: true })
    }
  }
  return error(id, -32601, `Method not found: ${method}`)
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 2 * 1024 * 1024) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Accept',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    })
    res.end()
    return
  }
  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, name: 'arbor-mcp', readOnly: true, tools: TOOLS.map((tool) => tool.name) })
    return
  }
  if (url.pathname !== '/mcp') {
    sendJson(res, 404, { error: 'Not Found' })
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '仅支持 POST /mcp' })
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, error(null, -32700, 'Parse error'))
    return
  }
  if (Array.isArray(parsed)) {
    const responses: Record<string, unknown>[] = []
    for (const item of parsed) {
      const response = await handleMessage(item as JsonRpcRequest)
      if (response) responses.push(response)
    }
    if (!responses.length) {
      res.writeHead(202, { 'Access-Control-Allow-Origin': '*' })
      res.end()
      return
    }
    sendJson(res, 200, responses)
    return
  }
  const response = await handleMessage(parsed as JsonRpcRequest)
  if (!response) {
    res.writeHead(202, { 'Access-Control-Allow-Origin': '*' })
    res.end()
    return
  }
  sendJson(res, 200, response)
}

export function startMcpServer(): Promise<number | null> {
  if (process.env.ZOTAGENT_MCP === '0') return Promise.resolve(null)
  const port = Number(process.env.ZOTAGENT_MCP_PORT ?? 39217)
  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message })
      else res.end()
    })
  })
  return new Promise((resolve) => {
    server.once('error', (err) => {
      console.warn('[mcp] 只读服务启动失败：', err.message)
      resolve(null)
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(`[mcp] 只读服务已启动：http://127.0.0.1:${port}/mcp`)
      resolve(port)
    })
  })
}
