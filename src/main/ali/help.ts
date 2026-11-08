import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { tokenize } from './memorySearch'

export interface HelpSection {
  id: string
  title: string
  path: string
  keywords: string[]
  body: string
}

interface Draft {
  title: string
  path: string
  body: string[]
  keywords?: string[]
}

const HELP_NOUNS = [
  '文献库', '文献', '导入', '导出', '分类', '标签', '属性', '保存视图', '阅读器', '高亮',
  '摘录', '笔记', '任务', '大纲', '对话', 'AI 对话', '研究主题', '主题画布', '画布',
  '阅读计划', '灵感', '截图翻译', '翻译', '用量', '设置', '模型', 'API', 'API Key',
  '快捷键', '备份', '恢复', '迁移', '更新', '主题', '阿栗', '桌面伙伴', '独立面板', '阅读面板'
]

const HELP_INTENTS = [
  '怎么', '如何', '在哪', '哪里', '为什么', '能不能', '可以', '步骤', '用法', '设置',
  '失败', '找不到', '报错', '没反应', '不工作', '无法', '打不开', '更新', '恢复',
  '导入', '导出', '备份', '迁移', '帮助', '使用说明', '是什么'
]

export function shouldRetrieveHelp(query: string): boolean {
  const text = (query || '').toLowerCase()
  if (!text.trim()) return false
  if (/使用说明|帮助文档|官方文档|help me use|user guide/.test(text)) return true
  const noun = HELP_NOUNS.some((item) => text.includes(item.toLowerCase()))
  const intent = HELP_INTENTS.some((item) => text.includes(item.toLowerCase()))
  return noun && intent
}

const MAX_SECTION_CHARS = 1200
let cache: { mtime: number; size: number; sections: HelpSection[] } | null = null

function slug(text: string): string {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return clean || 'section'
}

function splitBody(body: string): string[] {
  const clean = body.trim()
  if (clean.length <= MAX_SECTION_CHARS) return clean ? [clean] : []
  const paragraphs = clean.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 <= MAX_SECTION_CHARS) {
      current = current ? `${current}\n\n${paragraph}` : paragraph
      continue
    }
    if (current) chunks.push(current)
    if (paragraph.length <= MAX_SECTION_CHARS) {
      current = paragraph
    } else {
      for (let index = 0; index < paragraph.length; index += MAX_SECTION_CHARS) {
        chunks.push(paragraph.slice(index, index + MAX_SECTION_CHARS))
      }
      current = ''
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function extractKeywords(text: string): string[] {
  const match = text.match(/<!--\s*ali:keywords:\s*(.+?)\s*-->/i)
  return match ? match[1].split(/[,，;；]/).map((item) => item.trim()).filter(Boolean) : []
}

function flush(draft: Draft | null, sections: HelpSection[]): void {
  if (!draft) return
  const raw = draft.body.join('\n')
  const keywords = [...new Set([...(draft.keywords ?? []), ...extractKeywords(raw)])]
  const body = raw.replace(/<!--\s*ali:keywords:.*?-->/gi, '').trim()
  const chunks = splitBody(body)
  chunks.forEach((chunk, index) => {
    sections.push({
      id: `${slug(draft.path)}${index ? `-${index + 1}` : ''}`,
      title: `${draft.title}${index ? `（续 ${index + 1}）` : ''}`,
      path: draft.path,
      keywords,
      body: chunk
    })
  })
}

export function parseHelp(md: string): HelpSection[] {
  const sections: HelpSection[] = []
  let h2: Draft | null = null
  let h3: Draft | null = null
  let current: Draft | null = null
  let fence = false
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (/^\s*```/.test(line)) fence = !fence
    if (!fence) {
      if (line.startsWith('## ')) {
        flush(current, sections)
        h2 = { title: line.slice(3).trim(), path: line.slice(3).trim(), body: [] }
        h3 = null
        current = h2
        continue
      }
      if (line.startsWith('### ')) {
        flush(current, sections)
        const title = line.slice(4).trim()
        h3 = {
          title,
          path: h2 ? `${h2.title} / ${title}` : title,
          body: [],
          keywords: h2 ? extractKeywords(h2.body.join('\n')) : []
        }
        current = h3
        continue
      }
    }
    if (current) current.body.push(line)
  }
  flush(current, sections)
  return sections.filter((section) => section.body.trim().length > 0)
}

export async function loadHelpSections(): Promise<HelpSection[]> {
  const file = path.join(app.getAppPath(), 'docs', '使用说明.md')
  try {
    const stat = await fs.stat(file)
    if (cache && cache.mtime === stat.mtimeMs && cache.size === stat.size) return cache.sections
    const sections = parseHelp(await fs.readFile(file, 'utf-8'))
    cache = { mtime: stat.mtimeMs, size: stat.size, sections }
    return sections
  } catch {
    cache = null
    return []
  }
}

function scoreSection(section: HelpSection, terms: string[]): number {
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
  sections: HelpSection[],
  query: string,
  limit = 2,
  budget = 2200
): HelpSection[] {
  const terms = tokenize(query)
  const ranked = sections
    .map((section) => ({ section, score: scoreSection(section, terms) }))
    .filter((item) => item.score >= 0.8)
    .sort((a, b) => b.score - a.score)
  const result: HelpSection[] = []
  let used = 0
  for (const item of ranked) {
    if (result.length >= limit) break
    if (used + item.section.body.length > budget) continue
    result.push(item.section)
    used += item.section.body.length
  }
  return result
}

export async function searchHelp(query: string, limit = 2, budget = 2200): Promise<HelpSection[]> {
  return searchHelpSections(await loadHelpSections(), query, limit, budget)
}
