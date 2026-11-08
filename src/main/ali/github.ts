export type GitHubSearchType = 'repositories' | 'issues' | 'code'

export interface GitHubSource {
  title: string
  url: string
  snippet: string
}

export interface GitHubResult {
  sources: GitHubSource[]
  raw: string
  cached?: boolean
}

const CACHE_TTL = 5 * 60 * 1000
const cache = new Map<string, { at: number; result: GitHubResult }>()

async function request(url: string, token: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'Arbor-Ali',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      signal: controller.signal
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GitHub 搜索失败（${response.status}）：${text.slice(0, 200)}`)
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

export async function searchGitHub(
  query: string,
  type: GitHubSearchType,
  limit = 5,
  token = '',
  baseUrl = 'https://api.github.com'
): Promise<GitHubResult> {
  const clean = query.trim()
  if (!clean) throw new Error('搜索关键词不能为空')
  if (type === 'code' && !token) throw new Error('GitHub 代码搜索需要 Personal Access Token，请先在设置中配置')
  const key = `${type}|${limit}|${clean}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return { ...hit.result, sources: hit.result.sources.map((item) => ({ ...item })), cached: true }
  const path = type === 'repositories' ? 'repositories' : type === 'issues' ? 'issues' : 'code'
  const url = `${baseUrl.replace(/\/+$/, '')}/search/${path}?q=${encodeURIComponent(clean)}&per_page=${Math.min(10, Math.max(1, limit))}`
  const response = await request(url, token)
  const json = (await response.json()) as { items?: Record<string, any>[] }
  const items = (json.items || []).slice(0, limit)
  let sources: GitHubSource[] = []
  if (type === 'repositories') {
    sources = items.map((item) => ({
      title: `${item.full_name || item.name || 'repository'}${item.stargazers_count !== undefined ? ` · ★ ${item.stargazers_count}` : ''}`,
      url: item.html_url || '',
      snippet: [item.description, item.language, item.updated_at ? `更新于 ${String(item.updated_at).slice(0, 10)}` : ''].filter(Boolean).join(' · ')
    }))
  } else if (type === 'issues') {
    sources = items.map((item) => ({
      title: `${item.title || 'issue'} · ${item.state || ''}`,
      url: item.html_url || '',
      snippet: (item.body || '').replace(/\s+/g, ' ').slice(0, 240)
    }))
  } else {
    sources = items.map((item) => ({
      title: `${item.repository?.full_name || ''}/${item.path || item.name || ''}`,
      url: item.html_url || '',
      snippet: `${item.repository?.full_name || ''} · ${item.path || ''}`
    }))
  }
  sources = sources.filter((item) => item.url)
  if (!sources.length) throw new Error('GitHub 未返回搜索结果')
  const result: GitHubResult = {
    sources,
    raw: sources.map((item) => `${item.title}\n${item.url}\n${item.snippet}`).join('\n\n').slice(0, 6000)
  }
  if (cache.size > 50) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), result })
  return result
}
