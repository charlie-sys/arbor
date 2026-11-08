import path from 'path'
import { promises as fs } from 'fs'
import { aliMemory } from './memory'
import { writeJsonAtomic } from './atomic'

export interface MemoryOp {
  op: 'add' | 'supersede' | 'retract' | 'create_topic' | 'pin'
  doc: string
  section?: string
  line?: string
  old?: string
  topic?: string
  description?: string
  message_ids: string[]
}

const DOC = /^(SELF|MEMORY)\.md$|^topics\/[a-z0-9][a-z0-9-]{0,63}\.md$/
const SECRET = /sk-[a-z0-9]{8,}|api[_-]?key\s*[:=]|password\s*[:=]|密码\s*[:=]|身份证/i
let writeChain: Promise<unknown> = Promise.resolve()

function withMemoryLock<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.then(() => undefined, () => undefined)
  return run
}

function validLine(line: unknown): line is string {
  return typeof line === 'string' && line.startsWith('- ') && line.trim().length > 2 && line.split(/\r?\n/).length === 1 && line.length <= 122 && !SECRET.test(line)
}

export function parseMemoryOps(raw: string, userIds: Set<string>): MemoryOp[] {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('记忆提炼结果不是有效 JSON')
  const parsed = JSON.parse(text.slice(start, end + 1)) as { ops?: unknown }
  if (!Array.isArray(parsed.ops)) throw new Error('记忆提炼结果缺少 ops 数组')
  const result: MemoryOp[] = []
  for (const item of parsed.ops) {
    if (!item || typeof item !== 'object') continue
    const value = item as Partial<MemoryOp>
    if (!['add', 'supersede', 'retract', 'create_topic', 'pin'].includes(String(value.op))) continue
    const ids = Array.isArray(value.message_ids) ? value.message_ids.filter((id): id is string => typeof id === 'string') : []
    if (!ids.length || ids.some((id) => !userIds.has(id))) continue
    if (value.op === 'create_topic') {
      const topic = typeof value.topic === 'string' ? value.topic.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 48) : ''
      if (!topic || !validLine(value.line)) continue
      result.push({ op: 'create_topic', doc: `topics/${topic}.md`, topic, description: String(value.description || '').slice(0, 80), line: value.line, message_ids: ids })
      continue
    }
    const doc = String(value.doc || 'MEMORY.md')
    if (!DOC.test(doc)) continue
    if (value.op === 'pin') {
      if (doc.startsWith('topics/')) result.push({ op: 'pin', doc, message_ids: ids })
      continue
    }
    if (!validLine(value.line)) continue
    if (value.op === 'supersede' || value.op === 'retract') {
      if (typeof value.old !== 'string' || !value.old.startsWith('- ')) continue
    }
    result.push({
      op: value.op as MemoryOp['op'],
      doc,
      ...(typeof value.section === 'string' ? { section: value.section.slice(0, 40) } : {}),
      line: value.line,
      ...(typeof value.old === 'string' ? { old: value.old } : {}),
      message_ids: ids
    })
  }
  return result.slice(0, 12)
}

function addLine(text: string, section: string | undefined, line: string): string {
  const heading = `## ${section || '用户事实'}`
  const index = text.indexOf(heading)
  if (index < 0) return `${text.trimEnd()}\n\n${heading}\n${line}\n`
  const insert = index + heading.length
  return `${text.slice(0, insert)}\n${line}${text.slice(insert)}`
}

async function applyMemoryOpsUnlocked(ops: MemoryOp[]): Promise<{ applied: number; conflicts: string[] }> {
  let self = await aliMemory.readSelf()
  let memory = await aliMemory.readMemory()
  const topics = new Map<string, string>()
  const conflicts: string[] = []
  let applied = 0
  for (const op of ops) {
    const target = op.doc.startsWith('topics/') ? topics.get(op.doc) ?? '' : op.doc === 'SELF.md' ? self : memory
    if (op.op === 'create_topic') {
      topics.set(op.doc, `---\ndescription: ${op.description || op.topic}\n---\n${op.line}\n`)
      applied += 1
      continue
    }
    if (op.op === 'pin') {
      const text = topics.get(op.doc)
      if (!text) {
        conflicts.push(`pin ${op.doc}: 主题不存在`)
        continue
      }
      const next = text.startsWith('---') ? text.replace(/^---\n/, '---\npinned: true\n') : `---\npinned: true\n---\n${text}`
      topics.set(op.doc, next)
      applied += 1
      continue
    }
    if (op.op === 'add') {
      if (target.includes(op.line!)) continue
      const next = addLine(target, op.section, op.line!)
      if (op.doc.startsWith('topics/')) topics.set(op.doc, next)
      else if (op.doc === 'SELF.md') self = next
      else memory = next
      applied += 1
      continue
    }
    const old = op.old
    const line = op.line
    if (!old || !line) {
      conflicts.push(`${op.op} ${op.doc}: 缺少旧条目或新内容`)
      continue
    }
    if (!target.includes(old)) {
      conflicts.push(`${op.op} ${op.doc}: 未找到旧条目`)
      continue
    }
    await aliMemory.archive(op.doc, [old])
    const next = op.op === 'retract' ? target.replace(`${old}\n`, '').replace(old, '') : target.replace(old, line)
    if (op.doc.startsWith('topics/')) topics.set(op.doc, next)
    else if (op.doc === 'SELF.md') self = next
    else memory = next
    applied += 1
  }
  await aliMemory.save('SELF.md', self)
  await aliMemory.save('MEMORY.md', memory)
  for (const [doc, content] of topics) await aliMemory.save(doc, content)
  return { applied, conflicts }
}

export interface ConsolidationOp {
  op: 'merge' | 'prune'
  doc: 'MEMORY.md' | 'SELF.md'
  olds?: string[]
  old?: string
  line?: string
}

export function parseConsolidationOps(raw: string): ConsolidationOp[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('记忆整理结果不是有效 JSON')
  const parsed = JSON.parse(text.slice(start, end + 1)) as { ops?: unknown }
  if (!Array.isArray(parsed.ops)) throw new Error('记忆整理结果缺少 ops')
  const result: ConsolidationOp[] = []
  for (const item of parsed.ops) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    if (value.op !== 'merge' && value.op !== 'prune') continue
    if (value.doc !== 'MEMORY.md' && value.doc !== 'SELF.md') continue
    if (value.op === 'merge') {
      const olds = Array.isArray(value.olds) ? value.olds.filter((line): line is string => typeof line === 'string' && line.startsWith('- ')) : []
      if (olds.length < 2 || !validLine(value.line)) continue
      result.push({ op: 'merge', doc: value.doc, olds, line: value.line })
    } else {
      if (typeof value.old !== 'string' || !value.old.startsWith('- ')) continue
      if (value.line !== undefined && !validLine(value.line)) continue
      result.push({ op: 'prune', doc: value.doc, old: value.old, ...(typeof value.line === 'string' ? { line: value.line } : {}) })
    }
  }
  return result.slice(0, 24)
}

export function applyMemoryOps(ops: MemoryOp[]): Promise<{ applied: number; conflicts: string[] }> {
  return withMemoryLock(() => applyMemoryOpsUnlocked(ops))
}

async function applyConsolidationOpsUnlocked(
  ops: ConsolidationOp[]
): Promise<{ applied: number; conflicts: string[] }> {
  let self = await aliMemory.readSelf()
  let memory = await aliMemory.readMemory()
  const conflicts: string[] = []
  let applied = 0
  for (const op of ops) {
    let target = op.doc === 'SELF.md' ? self : memory
    if (op.op === 'merge') {
      const olds = op.olds ?? []
      if (olds.some((line) => !target.includes(line))) {
        conflicts.push(`merge ${op.doc}: 部分旧条目不存在`)
        continue
      }
      target = target.replace(olds[0], op.line!)
      for (const old of olds.slice(1)) target = target.replace(`${old}\n`, '').replace(old, '')
      await aliMemory.archive(op.doc, olds)
    } else {
      if (!target.includes(op.old!)) {
        conflicts.push(`prune ${op.doc}: 旧条目不存在`)
        continue
      }
      target = op.line ? target.replace(op.old!, op.line) : target.replace(`${op.old}\n`, '').replace(op.old!, '')
      await aliMemory.archive(op.doc, [op.old!])
    }
    if (op.doc === 'SELF.md') self = target
    else memory = target
    applied += 1
  }
  await aliMemory.save('SELF.md', self)
  await aliMemory.save('MEMORY.md', memory)
  return { applied, conflicts }
}

export function applyConsolidationOps(
  ops: ConsolidationOp[]
): Promise<{ applied: number; conflicts: string[] }> {
  return withMemoryLock(() => applyConsolidationOpsUnlocked(ops))
}

function receiptsFile(): string {
  return path.join(aliMemory.root, 'receipts.json')
}

export async function hasReceipt(sourceRef: string): Promise<boolean> {
  try {
    const data = JSON.parse(await fs.readFile(receiptsFile(), 'utf-8')) as Record<string, unknown>
    return Boolean(data[sourceRef])
  } catch {
    return false
  }
}

export async function writeReceipt(sourceRef: string, applied: number, conflicts: string[]): Promise<void> {
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(await fs.readFile(receiptsFile(), 'utf-8')) as Record<string, unknown>
  } catch {
    // first receipt
  }
  data[sourceRef] = { applied, conflicts, at: new Date().toISOString() }
  await writeJsonAtomic(receiptsFile(), data)
}

export async function saveDraft(payload: unknown): Promise<void> {
  await writeJsonAtomic(path.join(aliMemory.root, 'drafts', `draft-${Date.now()}.json`), payload)
}

async function removeMemoryLinesUnlocked(lines: string[]): Promise<number> {
  let self = await aliMemory.readSelf()
  let memory = await aliMemory.readMemory()
  let removed = 0
  for (const line of lines) {
    if (!line.startsWith('- ')) continue
    if (memory.includes(line)) {
      memory = memory.replace(`${line}\n`, '').replace(line, '')
      removed += 1
    } else if (self.includes(line)) {
      self = self.replace(`${line}\n`, '').replace(line, '')
      removed += 1
    }
  }
  if (removed) {
    await aliMemory.save('SELF.md', self)
    await aliMemory.save('MEMORY.md', memory)
  }
  return removed
}

export function removeMemoryLines(lines: string[]): Promise<number> {
  return withMemoryLock(() => removeMemoryLinesUnlocked(lines))
}

async function restoreMemoryLineUnlocked(doc: 'MEMORY.md' | 'SELF.md', line: string): Promise<void> {
  if (!validLine(line)) throw new Error('归档条目无效')
  const text = await aliMemory.read(doc)
  await aliMemory.save(doc, addLine(text, undefined, line))
}

export function restoreMemoryLine(doc: 'MEMORY.md' | 'SELF.md', line: string): Promise<void> {
  return withMemoryLock(() => restoreMemoryLineUnlocked(doc, line))
}
