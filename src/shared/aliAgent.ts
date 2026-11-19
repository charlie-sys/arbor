import type {
  AliHelpSection,
  AliMemoryTopic,
  AliSource,
  AliToolTrace
} from './ali'

export type { AliHelpSection } from './ali'

export interface AliToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AliChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: AliToolCall[]
  tool_call_id?: string
}

export interface AliToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AliToolCallResult {
  id: string
  name: string
  arguments: string
}

export interface AliStreamResult {
  content: string
  toolCalls: AliToolCallResult[]
}

export const ALI_TOOL_DEFINITIONS: AliToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '检索阿栗的长期记忆主题。用户提到过去、偏好或“你还记得”时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的记忆关键词或问题' },
          limit: { type: 'number', description: '返回条数，1–5，默认 3' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_help',
      description: '检索 Arbor 使用说明。用户询问软件功能、设置或操作时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的功能或问题' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_help',
      description: '读取指定使用说明章节的完整内容。',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: '章节 id、标题或路径关键词'
          }
        },
        required: ['section']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: '联网搜索公开网页。用户要求查最新信息、外部资料或明确要求搜索时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '结果数量，1–5，默认 5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_github',
      description: '搜索 GitHub 仓库、Issue 或代码。用户要找 GitHub 项目、实现或讨论时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或 GitHub 查询语法' },
          type: {
            type: 'string',
            enum: ['repositories', 'issues', 'code'],
            description: '搜索类型，默认 repositories'
          },
          limit: { type: 'number', description: '结果数量，1–10，默认 5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '抓取一个公开网页并返回正文。用户给出 URL 或需要阅读搜索结果时使用。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的 http/https URL' }
        },
        required: ['url']
      }
    }
  }
]

export function aliToolDefinitions(includeNetwork = true): AliToolDefinition[] {
  const network = new Set(['search_web', 'search_github', 'fetch_url'])
  return ALI_TOOL_DEFINITIONS.filter(
    (tool) =>
      includeNetwork || !network.has(tool.function.name)
  )
}

export async function runAliWithTools(
  messages: AliChatMessage[],
  tools: AliToolDefinition[],
  stream: (
    messages: AliChatMessage[],
    tools: AliToolDefinition[],
    onDelta: (delta: string) => void
  ) => Promise<AliStreamResult>,
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  onDelta: (delta: string) => void,
  onTool: (trace: AliToolTrace) => void
): Promise<{ text: string; sources: AliSource[] }> {
  let activeTools = tools
  let output = ''
  let calls = 0
  let toolChars = 0
  const sources = new Map<string, AliSource>()

  for (let round = 0; round < 4; round += 1) {
    let result: AliStreamResult
    try {
      result = await stream(messages, activeTools, onDelta)
    } catch (error) {
      const message = (error as Error).message || ''
      if (activeTools.length && /400|tool|function/i.test(message)) {
        activeTools = []
        result = await stream(messages, [], onDelta)
      } else {
        throw error
      }
    }
    output += result.content
    if (!result.toolCalls.length) {
      return { text: output, sources: [...sources.values()] }
    }
    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments }
      }))
    })
    for (const call of result.toolCalls) {
      if (calls >= 8) break
      calls += 1
      const startedAt = Date.now()
      onTool({
        id: call.id,
        name: call.name,
        args: call.arguments,
        status: 'running',
        startedAt
      })
      let content = ''
      let status: 'ok' | 'error' = 'ok'
      try {
        const args = call.arguments
          ? (JSON.parse(call.arguments) as Record<string, unknown>)
          : {}
        content = await executeTool(call.name, args)
      } catch (error) {
        status = 'error'
        content = `工具执行失败：${(error as Error).message}`
      }
      const remaining = Math.max(0, 12000 - toolChars)
      if (content.length > remaining) content = content.slice(0, remaining)
      if (content.length > 6000) content = content.slice(0, 6000)
      toolChars += content.length
      if (
        status === 'ok' &&
        (call.name === 'search_web' || call.name === 'search_github')
      ) {
        try {
          const data = JSON.parse(content) as {
            sources?: { title?: string; url?: string; snippet?: string }[]
          }
          for (const source of data.sources || []) {
            if (!source.url) continue
            sources.set(source.url, {
              title: source.title || source.url,
              url: source.url,
              provider:
                call.name === 'search_github' ? 'github' : 'web',
              ...(source.snippet ? { snippet: source.snippet } : {})
            })
          }
        } catch {
          // Tool output is not structured; keep the result without sources.
        }
      }
      onTool({
        id: call.id,
        name: call.name,
        args: call.arguments,
        status,
        summary: content.slice(0, 120),
        ...(status === 'error' ? { error: content } : {}),
        startedAt,
        finishedAt: Date.now()
      })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content
      })
    }
    if (calls >= 8) break
  }
  return { text: output, sources: [...sources.values()] }
}

const HELP_NOUNS = [
  '文献库', '文献', '导入', '导出', '分类', '标签', '属性', '保存视图',
  '阅读器', '高亮', '摘录', '笔记', '任务', '大纲', '对话', 'AI 对话',
  '研究主题', '主题画布', '画布', '阅读计划', '灵感', '截图翻译',
  '翻译', '用量', '设置', '模型', 'API', 'API Key', '快捷键', '备份',
  '恢复', '迁移', '更新', '主题', '阿栗', '桌面伙伴', '独立面板',
  '阅读面板'
]

const HELP_INTENTS = [
  '怎么', '如何', '在哪', '哪里', '为什么', '能不能', '可以', '步骤',
  '用法', '设置', '失败', '找不到', '报错', '没反应', '不工作',
  '无法', '打不开', '更新', '恢复', '导入', '导出', '备份', '迁移',
  '帮助', '使用说明', '是什么'
]

export function tokenize(text: string): string[] {
  const terms = new Set<string>()
  const lower = text.toLowerCase()
  for (const word of lower.match(/[a-z][a-z0-9-]{1,}/g) ?? []) {
    terms.add(word)
  }
  const cjk = lower.replace(/[^\u4e00-\u9fff]/g, ' ')
  for (const run of cjk.split(/\s+/)) {
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2))
    }
  }
  return [...terms]
}

export function shouldRetrieveHelp(query: string): boolean {
  const text = (query || '').toLowerCase()
  if (!text.trim()) return false
  if (/使用说明|帮助文档|官方文档|help me use|user guide/.test(text)) {
    return true
  }
  const noun = HELP_NOUNS.some((item) =>
    text.includes(item.toLowerCase())
  )
  const intent = HELP_INTENTS.some((item) =>
    text.includes(item.toLowerCase())
  )
  return noun && intent
}

function slug(text: string): string {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return clean || 'section'
}

function splitBody(body: string): string[] {
  const max = 1200
  const clean = body.trim()
  if (clean.length <= max) return clean ? [clean] : []
  const chunks: string[] = []
  let current = ''
  for (const paragraph of clean.split(/\n{2,}/)) {
    if (current.length + paragraph.length + 2 <= max) {
      current = current ? `${current}\n\n${paragraph}` : paragraph
      continue
    }
    if (current) chunks.push(current)
    if (paragraph.length <= max) {
      current = paragraph
    } else {
      for (let index = 0; index < paragraph.length; index += max) {
        chunks.push(paragraph.slice(index, index + max))
      }
      current = ''
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function extractKeywords(text: string): string[] {
  const match = text.match(/<!--\s*ali:keywords:\s*(.+?)\s*-->/i)
  return match
    ? match[1]
        .split(/[,，;；]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

interface HelpDraft {
  title: string
  path: string
  body: string[]
  keywords?: string[]
}

export function parseHelp(markdown: string): AliHelpSection[] {
  const sections: AliHelpSection[] = []
  let h2: HelpDraft | null = null
  let current: HelpDraft | null = null
  let fence = false
  const flush = (): void => {
    if (!current) return
    const raw = current.body.join('\n')
    const keywords = [
      ...new Set([
        ...(current.keywords ?? []),
        ...extractKeywords(raw)
      ])
    ]
    const body = raw.replace(/<!--\s*ali:keywords:.*?-->/gi, '').trim()
    splitBody(body).forEach((chunk, index) => {
      sections.push({
        id: `${slug(current!.path)}${index ? `-${index + 1}` : ''}`,
        title: `${current!.title}${index ? `（续 ${index + 1}）` : ''}`,
        path: current!.path,
        keywords,
        body: chunk
      })
    })
  }
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (/^\s*```/.test(line)) fence = !fence
    if (!fence && line.startsWith('## ')) {
      flush()
      h2 = { title: line.slice(3).trim(), path: line.slice(3).trim(), body: [] }
      current = h2
      continue
    }
    if (!fence && line.startsWith('### ')) {
      flush()
      const title = line.slice(4).trim()
      current = {
        title,
        path: h2 ? `${h2.title} / ${title}` : title,
        body: [],
        keywords: h2 ? extractKeywords(h2.body.join('\n')) : []
      }
      continue
    }
    if (current) current.body.push(line)
  }
  flush()
  return sections.filter((section) => section.body.trim().length > 0)
}

function scoreSection(section: AliHelpSection, terms: string[]): number {
  if (!terms.length) return 0
  const title = `${section.title} ${section.path}`.toLowerCase()
  const keywords = section.keywords.join(' ').toLowerCase()
  const body = section.body.toLowerCase()
  let score = 0
  for (const term of terms) {
    const titleHits = title.split(term).length - 1
    const keywordHits = keywords.split(term).length - 1
    const bodyHits = Math.min(8, body.split(term).length - 1)
    score += titleHits * 4 + keywordHits * 3 + bodyHits
  }
  return score / Math.sqrt(Math.max(40, (title.length + body.length) / 40))
}

export function searchHelpSections(
  sections: AliHelpSection[],
  query: string,
  limit = 2,
  budget = 2200
): AliHelpSection[] {
  const terms = tokenize(query)
  const ranked = sections
    .map((section) => ({ section, score: scoreSection(section, terms) }))
    .filter((item) => item.score >= 0.8)
    .sort((left, right) => right.score - left.score)
  const result: AliHelpSection[] = []
  let used = 0
  for (const item of ranked) {
    if (result.length >= limit) break
    if (used + item.section.body.length > budget) continue
    result.push(item.section)
    used += item.section.body.length
  }
  return result
}

interface ScoredTopic {
  doc: string
  title: string
  description: string
  body: string
  pinned: boolean
}

export function memoryTopics(
  topics: AliMemoryTopic[]
): ScoredTopic[] {
  return topics.map((topic) => {
    let description = topic.description
    let pinned = topic.pinned
    let body = topic.content
    if (body.startsWith('---')) {
      const end = body.indexOf('\n---', 3)
      if (end >= 0) {
        const front = body.slice(3, end)
        body = body.slice(end + 4).trim()
        description =
          front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? description
        pinned = /^pinned:\s*true$/m.test(front) || pinned
      }
    }
    return {
      doc: topic.doc,
      title: topic.title,
      description,
      body,
      pinned
    }
  })
}

export function retrieveMemoryTopics(
  topics: AliMemoryTopic[],
  query: string,
  limit = 3,
  threshold = 1
): ScoredTopic[] {
  const terms = tokenize(query)
  const list = memoryTopics(topics)
  const scoreTopic = (topic: ScoredTopic): number => {
    if (!terms.length) return topic.pinned ? 1 : 0
    const head = `${topic.title} ${topic.description}`.toLowerCase()
    const body = topic.body.toLowerCase()
    let score = 0
    for (const term of terms) {
      let hits = 0
      let from = 0
      while (hits < 5) {
        const index = head.indexOf(term, from)
        if (index < 0) break
        hits += 1
        from = index + term.length
      }
      let bodyHits = 0
      from = 0
      while (bodyHits < 12) {
        const index = body.indexOf(term, from)
        if (index < 0) break
        bodyHits += 1
        from = index + term.length
      }
      score += hits * 3 + bodyHits
    }
    return score / Math.sqrt(Math.max(40, head.length + body.length / 40))
  }
  const pinned = list.filter((topic) => topic.pinned)
  const scored = list
    .filter((topic) => !topic.pinned)
    .map((topic) => ({ topic, score: scoreTopic(topic) }))
    .filter((item) => item.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.topic)
  const seen = new Set<string>()
  return [...pinned, ...scored].filter((topic) => {
    if (seen.has(topic.doc)) return false
    seen.add(topic.doc)
    return true
  })
}

export function retrievalBlock(topics: ScoredTopic[]): string {
  return topics
    .map(
      (topic) =>
        `### ${topic.title}${topic.description ? `（${topic.description}）` : ''}\n${topic.body.slice(0, 800)}`
    )
    .join('\n\n')
}
