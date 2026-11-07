import { promises as fs } from 'fs'
import { dialog } from 'electron'
import { store, uid } from './store'
import type { DocumentMeta, ImportResult, ImportSummary } from '../shared/types'

interface BibEntry {
  type: string
  key: string
  fields: Record<string, string>
}

function cleanValue(value: string): string {
  let text = value.trim()
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('"') && text.endsWith('"'))) {
    text = text.slice(1, -1)
  }
  return text
    .replace(/[{}]/g, '')
    .replace(/\\([&%$#_])/g, '$1')
    .replace(/\\[a-zA-Z]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseFields(body: string): Record<string, string> {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of body) {
    if (char === '{') depth += 1
    else if (char === '}') depth = Math.max(0, depth - 1)
    else if (char === '"' && depth === 0) quoted = !quoted
    if (char === ',' && depth === 0 && !quoted) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)

  const fields: Record<string, string> = {}
  for (const part of parts) {
    const equals = part.indexOf('=')
    if (equals < 0) continue
    const key = part.slice(0, equals).trim().toLowerCase()
    const value = cleanValue(part.slice(equals + 1))
    if (key && value) fields[key] = value
  }
  return fields
}

export function parseBibtex(raw: string): BibEntry[] {
  const entries: BibEntry[] = []
  let index = 0
  while (index < raw.length) {
    const at = raw.indexOf('@', index)
    if (at < 0) break
    const braceStart = raw.indexOf('{', at)
    if (braceStart < 0) break
    const type = raw.slice(at + 1, braceStart).trim().toLowerCase()
    let depth = 0
    let end = -1
    for (let cursor = braceStart; cursor < raw.length; cursor += 1) {
      if (raw[cursor] === '{') depth += 1
      else if (raw[cursor] === '}') {
        depth -= 1
        if (depth === 0) {
          end = cursor
          break
        }
      }
    }
    if (end < 0) break
    const inner = raw.slice(braceStart + 1, end)
    const comma = inner.indexOf(',')
    const key = comma >= 0 ? inner.slice(0, comma).trim() : ''
    const body = comma >= 0 ? inner.slice(comma + 1) : ''
    if (!['comment', 'string', 'preamble'].includes(type)) entries.push({ type, key, fields: parseFields(body) })
    index = end + 1
  }
  return entries
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\-_—–:：,.，。?？!！()（）[\]{}'"]/g, '')
}

function splitAuthors(value: string): string {
  return value
    .split(/\s+and\s+/i)
    .map((author) => author.trim())
    .filter(Boolean)
    .join('; ')
}

function entryToDocument(entry: BibEntry, now: number): DocumentMeta {
  const fields = entry.fields
  const journal = fields.journal || fields.booktitle || fields.journaltitle || fields.publisher || ''
  const tags = (fields.keywords || fields.tags || '')
    .split(/[,;，；]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  return {
    id: uid(),
    title: fields.title || entry.key || '未命名文献',
    authors: splitAuthors(fields.author || fields.editor || ''),
    year: (fields.year || fields.date || '').slice(0, 4),
    journal,
    abstract: fields.abstract || '',
    doi: fields.doi || '',
    url: fields.url || '',
    tags,
    collections: [],
    addedAt: now,
    updatedAt: now,
    fileName: '',
    pageCount: 0,
    starred: false,
    readingStatus: 'unread',
    lastPage: 1,
    notes: `导入自 BibTeX（@${entry.type}）`
  }
}

export async function importBibtexText(raw: string): Promise<ImportSummary> {
  const entries = parseBibtex(raw)
  if (!entries.length) throw new Error('未在文件中找到 BibTeX 条目')
  const summary: ImportSummary = { kind: 'bibtex', documentsAdded: 0, documentsMerged: 0, excerptsAdded: 0, skipped: 0 }
  const now = Date.now()
  for (const entry of entries) {
    const incoming = entryToDocument(entry, now)
    const existing = store.data.documents.find(
      (doc) =>
        (incoming.doi && doc.doi && doc.doi.toLowerCase() === incoming.doi.toLowerCase()) ||
        (incoming.title && normalizeTitle(doc.title) === normalizeTitle(incoming.title))
    )
    if (existing) {
      if (!existing.authors && incoming.authors) existing.authors = incoming.authors
      if (!existing.year && incoming.year) existing.year = incoming.year
      if (!existing.journal && incoming.journal) existing.journal = incoming.journal
      if (!existing.abstract && incoming.abstract) existing.abstract = incoming.abstract
      if (!existing.doi && incoming.doi) existing.doi = incoming.doi
      if (!existing.url && incoming.url) existing.url = incoming.url
      for (const tag of incoming.tags) if (!existing.tags.includes(tag)) existing.tags.push(tag)
      existing.updatedAt = now
      summary.documentsMerged += 1
    } else {
      store.data.documents.unshift(incoming)
      summary.documentsAdded += 1
    }
  }
  await store.save()
  return summary
}

interface RawHighlight {
  text?: unknown
  note?: unknown
  location?: unknown
  highlighted_at?: unknown
}

interface RawBook {
  title?: unknown
  author?: unknown
  highlights?: unknown
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function importReadwiseText(raw: string): Promise<ImportSummary> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Readwise 导出不是有效 JSON')
  }
  const books = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { books?: unknown }).books)
      ? ((parsed as { books: unknown[] }).books as unknown[])
      : []
  if (!books.length) throw new Error('未在文件中找到 Readwise 书籍或高亮')

  const summary: ImportSummary = { kind: 'readwise', documentsAdded: 0, documentsMerged: 0, excerptsAdded: 0, skipped: 0 }
  const now = Date.now()
  for (const item of books) {
    const book = (item ?? {}) as RawBook
    const title = asText(book.title) || '未命名书籍'
    const doc = store.data.documents.find((candidate) => normalizeTitle(candidate.title) === normalizeTitle(title))
    const highlights = Array.isArray(book.highlights) ? (book.highlights as RawHighlight[]) : []
    for (const rawHighlight of highlights) {
      const text = asText(rawHighlight?.text)
      if (!text) {
        summary.skipped += 1
        continue
      }
      const note = asText(rawHighlight?.note)
      const answer = note ? `${text}\n\n笔记：${note}` : text
      const duplicate = store.data.excerpts.some(
        (excerpt) => normalizeTitle(excerpt.docTitle) === normalizeTitle(title) && excerpt.answer.startsWith(text)
      )
      if (duplicate) {
        summary.skipped += 1
        continue
      }
      const location = typeof rawHighlight?.location === 'number' ? rawHighlight.location : Number(asText(rawHighlight?.location))
      const page = Number.isFinite(location) && location > 0 ? location : undefined
      const created = Date.parse(asText(rawHighlight?.highlighted_at))
      store.data.excerpts.push({
        id: uid(),
        docId: doc?.id ?? null,
        docTitle: title,
        page,
        source: 'readwise',
        question: '',
        answer,
        createdAt: Number.isFinite(created) ? created : now,
        updatedAt: now
      })
      summary.excerptsAdded += 1
    }
  }
  await store.save()
  return summary
}

export async function importBibtexDialog(): Promise<ImportResult> {
  const picked = await dialog.showOpenDialog({
    title: '导入 BibTeX（Zotero 导出）',
    properties: ['openFile'],
    filters: [
      { name: 'BibTeX', extensions: ['bib', 'bibtex'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (picked.canceled || !picked.filePaths.length) return { canceled: true }
  const raw = await fs.readFile(picked.filePaths[0], 'utf-8')
  return { canceled: false, summary: await importBibtexText(raw) }
}

export async function importReadwiseDialog(): Promise<ImportResult> {
  const picked = await dialog.showOpenDialog({
    title: '导入 Readwise 高亮',
    properties: ['openFile'],
    filters: [
      { name: 'Readwise JSON', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (picked.canceled || !picked.filePaths.length) return { canceled: true }
  const raw = await fs.readFile(picked.filePaths[0], 'utf-8')
  return { canceled: false, summary: await importReadwiseText(raw) }
}
