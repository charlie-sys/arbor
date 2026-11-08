export interface WebSearchConfig {
  provider: 'exa' | 'searxng'
  endpoint: string
  apiKey: string
}

export interface WebSource {
  title: string
  url: string
  snippet: string
}

export interface WebSearchResult {
  sources: WebSource[]
  raw: string
  cached?: boolean
}

export interface FetchUrlOptions {
  resolve?: (host: string) => Promise<string[]>
  fetchImpl?: typeof fetch
  allowPort?: boolean
}

import { promises as dns } from 'dns'

const CACHE_TTL = 5 * 60 * 1000
const cache = new Map<string, { at: number; result: WebSearchResult }>()

function cacheGet(key: string): WebSearchResult | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return { ...hit.result, sources: hit.result.sources.map((item) => ({ ...item })), cached: true }
}

function cacheSet(key: string, result: WebSearchResult): void {
  if (cache.size > 50) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), result })
}

async function request(url: string, init: RequestInit, timeoutMs = 25000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`)
    return response
  } finally {
    clearTimeout(timer)
  }
}

function extractSources(text: string): WebSource[] {
  const sources: WebSource[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/\[([^\]]{1,160})\]\((https?:\/\/[^\s)]+)\)/g)) {
    if (seen.has(match[2])) continue
    seen.add(match[2])
    sources.push({ title: match[1].trim(), url: match[2], snippet: '' })
  }
  if (!sources.length) {
    for (const line of text.split(/\r?\n/)) {
      const url = line.match(/https?:\/\/[^\s)]+/)?.[0]
      if (!url || seen.has(url)) continue
      seen.add(url)
      sources.push({ title: line.replace(url, '').trim().slice(0, 80) || url, url, snippet: '' })
    }
  } else {
    for (const line of text.split(/\r?\n/)) {
      const url = line.match(/https?:\/\/[^\s)]+/)?.[0]
      if (!url || seen.has(url)) continue
      seen.add(url)
      sources.push({ title: line.replace(url, '').trim().slice(0, 80) || url, url, snippet: '' })
    }
  }
  return sources.slice(0, 8)
}

async function readExa(response: Response): Promise<WebSearchResult> {
  const type = response.headers.get('content-type') || ''
  let text = ''
  if (type.includes('text/event-stream')) {
    const raw = await response.text()
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      try {
        const message = JSON.parse(data)
        if (message?.result) {
          text = (message.result.content || [])
            .map((part: { text?: string }) => part?.text ?? '')
            .join('\n')
        }
      } catch {
        // ignore keep-alive
      }
    }
  } else {
    const json = (await response.json()) as {
      result?: { content?: { text?: string }[]; structuredContent?: unknown }
      content?: { text?: string }[]
    }
    const result = (json.result ?? json) as {
      content?: { text?: string }[]
      structuredContent?: unknown
    }
    text = (result.content || []).map((part) => part?.text ?? '').join('\n')
    if (!text && result.structuredContent) text = JSON.stringify(result.structuredContent)
  }
  if (!text.trim()) throw new Error('Exa 未返回搜索结果')
  return { sources: extractSources(text), raw: text.slice(0, 6000) }
}

async function searchExa(query: string, config: WebSearchConfig, limit: number): Promise<WebSearchResult> {
  const endpoint = config.endpoint.trim() || 'https://mcp.exa.ai/mcp'
  const url = config.apiKey ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}exaApiKey=${encodeURIComponent(config.apiKey)}` : endpoint
  const response = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: { query, numResults: limit, livecrawl: 'fallback', type: 'auto' }
      }
    })
  })
  return readExa(response)
}

async function searchSearxng(query: string, config: WebSearchConfig, limit: number): Promise<WebSearchResult> {
  if (!config.endpoint.trim()) throw new Error('请先在设置中填写 SearXNG 地址')
  const base = config.endpoint.trim().replace(/\/+$/, '')
  const endpoint = base.endsWith('/search') ? base : `${base}/search`
  const url = `${endpoint}?q=${encodeURIComponent(query)}&format=json&language=zh-CN&safesearch=0`
  const response = await request(url, { headers: { accept: 'application/json' } })
  const json = (await response.json()) as { results?: { title?: string; url?: string; content?: string }[] }
  const seen = new Set<string>()
  const sources = (json.results || [])
    .filter((item) => item.url && !seen.has(item.url) && Boolean(seen.add(item.url!)))
    .slice(0, limit)
    .map((item) => ({
      title: item.title || item.url || '',
      url: item.url || '',
      snippet: (item.content || '').slice(0, 300)
    }))
  if (!sources.length) throw new Error('SearXNG 未返回搜索结果')
  return {
    sources,
    raw: sources.map((item) => `${item.title}\n${item.url}\n${item.snippet}`).join('\n\n').slice(0, 6000)
  }
}

export async function searchWeb(
  query: string,
  config: WebSearchConfig,
  limit = 5
): Promise<WebSearchResult> {
  const clean = query.trim()
  if (!clean) throw new Error('搜索关键词不能为空')
  const key = `${config.provider}|${config.endpoint}|${limit}|${clean}`
  const cached = cacheGet(key)
  if (cached) return cached
  const result =
    config.provider === 'searxng'
      ? await searchSearxng(clean, config, limit)
      : await searchExa(clean, config, limit)
  result.sources = result.sources.slice(0, limit)
  cacheSet(key, result)
  return result
}

export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase()
  if (!value) return true
  if (value.includes(':')) {
    if (value === '::1' || value === '::') return true
    if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80')) return true
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPrivateAddress(mapped[1]) : false
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

async function defaultResolve(host: string): Promise<string[]> {
  const entries = await dns.lookup(host, { all: true })
  return entries.map((entry) => entry.address)
}

export async function assertPublicUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
  allowPort = false
): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('URL 格式无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只允许 http/https 地址')
  if (url.username || url.password) throw new Error('URL 不能包含账号密码')
  if (!allowPort && url.port && url.port !== '80' && url.port !== '443') throw new Error('只允许 80/443 端口')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('该地址不允许访问')
  }
  const addresses = await resolve(host)
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('该地址不允许访问')
  return url
}

function stripHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ''
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `${title ? `# ${title}\n\n` : ''}${text}`.slice(0, 6000)
}

async function readLimited(response: Response, limit = 2 * 1024 * 1024): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) throw new Error('网页内容超过 2MB 上限')
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

export async function fetchUrl(raw: string, options: FetchUrlOptions = {}): Promise<{ url: string; title: string; text: string }> {
  const resolve = options.resolve ?? defaultResolve
  const fetchImpl = options.fetchImpl ?? fetch
  let current = raw
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const url = await assertPublicUrl(current, resolve, options.allowPort === true)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    let response: Response
    try {
      response = await fetchImpl(url.toString(), {
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1', 'user-agent': 'Arbor-Ali' },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('网页重定向缺少目标地址')
      current = new URL(location, url).toString()
      continue
    }
    if (!response.ok) throw new Error(`网页请求失败（${response.status}）`)
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (type && !/^(text\/|application\/json|application\/xml|application\/xhtml\+xml)/.test(type)) {
      throw new Error(`不支持的内容类型：${type}`)
    }
    const body = await readLimited(response)
    const text = type === 'application/json' ? body.slice(0, 6000) : stripHtml(body)
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ''
    return { url: url.toString(), title, text }
  }
  throw new Error('网页重定向次数过多')
}
