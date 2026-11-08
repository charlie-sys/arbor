import { promises as fs } from 'fs'
import path from 'path'
import { extractRawText } from 'mammoth'
import WordExtractor from 'word-extractor'
import { store } from './store'
import { documentFormatOf } from '../shared/documents'
import type { DocumentFormat, ExtractedDocument } from '../shared/types'

const PAGE_TARGET = 3000
const LONG_BLOCK = PAGE_TARGET * 1.6

function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitLongBlock(block: string, max: number): string[] {
  const units = block.split(/(?<=[。！？；.!?;])\s*|\n+/).filter((unit) => unit.trim())
  const pieces: string[] = []
  let current = ''
  for (const unit of units) {
    if (unit.length > max) {
      if (current) {
        pieces.push(current)
        current = ''
      }
      for (let start = 0; start < unit.length; start += max) {
        pieces.push(unit.slice(start, start + max))
      }
      continue
    }
    if (current && current.length + unit.length > max) {
      pieces.push(current)
      current = ''
    }
    current += unit
  }
  if (current) pieces.push(current)
  return pieces
}

export function splitIntoPages(text: string): string[] {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  const pages: string[] = []
  let current = ''
  const flush = (): void => {
    const page = current.trim()
    if (page) pages.push(page)
    current = ''
  }
  for (const block of blocks) {
    const pieces = block.length > LONG_BLOCK ? splitLongBlock(block, PAGE_TARGET) : [block]
    for (const piece of pieces) {
      if (piece.length >= PAGE_TARGET) {
        flush()
        pages.push(piece.trim())
        continue
      }
      if (current && current.length + piece.length + 2 > PAGE_TARGET) flush()
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  flush()
  return pages.length ? pages : [normalized]
}

async function readDocumentBody(filePath: string, format: DocumentFormat): Promise<string> {
  if (format === 'docx') {
    const result = await extractRawText({ path: filePath })
    return result.value
  }
  if (format === 'doc') {
    const extractor = new WordExtractor()
    const document = await extractor.extract(filePath)
    return document.getBody()
  }
  return fs.readFile(filePath, 'utf8')
}

export async function extractDocumentText(docId: string): Promise<ExtractedDocument> {
  const doc = store.getDocument(docId)
  if (!doc) throw new Error('文献不存在')
  if (!doc.fileName) throw new Error('该文献没有关联文件')
  const format = documentFormatOf(doc)
  if (format === 'pdf') throw new Error('PDF 文本请在阅读器中提取')
  const filePath = path.join(store.filesDir, doc.fileName)
  let body = ''
  try {
    body = await readDocumentBody(filePath, format)
  } catch (err) {
    if (format === 'doc') {
      throw new Error(`无法解析 Word 97-2003 文档：${(err as Error).message}`)
    }
    throw err
  }
  const pages = splitIntoPages(body)
  if (!pages.length) throw new Error('未从文件中提取到正文')
  return { pageCount: pages.length, pages }
}
