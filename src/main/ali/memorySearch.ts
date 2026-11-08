import { promises as fs } from 'fs'
import path from 'path'
import { aliMemory } from './memory'

export interface MemoryTopic {
  doc: string
  title: string
  description: string
  body: string
  pinned: boolean
}

export function tokenize(text: string): string[] {
  const terms = new Set<string>()
  const lower = text.toLowerCase()
  for (const word of lower.match(/[a-z][a-z0-9-]{1,}/g) ?? []) terms.add(word)
  const cjk = lower.replace(/[^\u4e00-\u9fff]/g, ' ')
  for (const run of cjk.split(/\s+/)) {
    for (let index = 0; index < run.length - 1; index += 1) terms.add(run.slice(index, index + 2))
  }
  return [...terms]
}

export function scoreTopic(topic: MemoryTopic, terms: string[]): number {
  if (!terms.length) return topic.pinned ? 1 : 0
  const head = `${topic.title} ${topic.description}`.toLowerCase()
  const body = topic.body.toLowerCase()
  let score = 0
  for (const term of terms) {
    let headHits = 0
    let bodyHits = 0
    let from = 0
    while (headHits < 5) {
      const index = head.indexOf(term, from)
      if (index < 0) break
      headHits += 1
      from = index + term.length
    }
    from = 0
    while (bodyHits < 12) {
      const index = body.indexOf(term, from)
      if (index < 0) break
      bodyHits += 1
      from = index + term.length
    }
    score += headHits * 3 + bodyHits
  }
  return score / Math.sqrt(Math.max(40, head.length + body.length / 40))
}

function parseTopic(doc: string, text: string): MemoryTopic {
  let description = ''
  let pinned = false
  let body = text
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3)
    if (end >= 0) {
      const front = text.slice(3, end)
      body = text.slice(end + 4).trim()
      description = front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
      pinned = /^pinned:\s*true$/m.test(front)
    }
  }
  return {
    doc,
    title: path.basename(doc, '.md').replace(/-/g, ' '),
    description,
    body,
    pinned
  }
}

export async function listTopics(): Promise<MemoryTopic[]> {
  try {
    const names = await fs.readdir(aliMemory.topicsDir)
    const topics: MemoryTopic[] = []
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const doc = `topics/${name}`
      const text = await fs.readFile(path.join(aliMemory.topicsDir, name), 'utf-8')
      topics.push(parseTopic(doc, text))
    }
    return topics
  } catch {
    return []
  }
}

export async function retrieveMemoryTopics(
  query: string,
  limit = 3,
  threshold = 1
): Promise<MemoryTopic[]> {
  const terms = tokenize(query)
  const topics = await listTopics()
  const pinned = topics.filter((topic) => topic.pinned)
  const scored = topics
    .filter((topic) => !topic.pinned)
    .map((topic) => ({ topic, score: scoreTopic(topic, terms) }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.topic)
  const seen = new Set<string>()
  return [...pinned, ...scored].filter((topic) => {
    if (seen.has(topic.doc)) return false
    seen.add(topic.doc)
    return true
  })
}

export function retrievalBlock(topics: MemoryTopic[]): string {
  if (!topics.length) return ''
  return topics
    .map((topic) => `### ${topic.title}${topic.description ? `（${topic.description}）` : ''}\n${topic.body.slice(0, 800)}`)
    .join('\n\n')
}
