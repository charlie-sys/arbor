import { promises as fs } from 'fs'
import path from 'path'
import { dialog } from 'electron'
import { uniqueFileName } from './uniqueFileName'
import { createZip } from './zip'
import { store } from './store'
import type { DocumentMeta, LibraryData } from '../shared/types'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'

function inlineRuns(text: string, bold = false, italic = false): TextRun[] {
  const runs: TextRun[] = []
  const pattern = /(\$\$[^$]+\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/
  const parts = text.split(pattern).filter((part) => part !== '')
  for (const part of parts) {
    if (/^\$\$[\s\S]+\$\$$/.test(part) || /^\$[^$]+\$$/.test(part)) {
      const formula = part.startsWith('$$') ? part.slice(2, -2) : part.slice(1, -1)
      runs.push(new TextRun({ text: formula.trim(), italics: true, font: 'Cambria Math' }))
    } else if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, italics: italic, font: 'Times New Roman' }))
    } else if (/^\*[^*\n]+\*$/.test(part) || /^_[^_\n]+_$/.test(part)) {
      runs.push(new TextRun({ text: part.slice(1, -1), bold, italics: true, font: 'Times New Roman' }))
    } else if (/^`[^`]+`$/.test(part)) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: 'Consolas', color: 'B91C1C' }))
    } else if (/^\[[^\]]+\]\([^)]+\)$/.test(part)) {
      const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (match) {
        runs.push(new TextRun({ text: `${match[1]}（${match[2]}）`, color: '2563EB', underline: {}, font: 'Times New Roman' }))
      }
    } else {
      runs.push(new TextRun({ text: part, bold, italics: italic, font: 'Times New Roman' }))
    }
  }
  return runs.length ? runs : [new TextRun({ text: '', font: 'Times New Roman' })]
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]+\|[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
}

function tableFromRows(rows: string[][]): Table {
  const columnCount = Math.max(...rows.map((row) => row.length))
  const tableRows = rows.map((row, rowIndex) => {
    const cells: TableCell[] = []
    for (let i = 0; i < columnCount; i++) {
      const value = (row[i] ?? '').replace(/<br\s*\/?>/gi, '\n')
      cells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: inlineRuns(value, rowIndex === 0),
              spacing: { after: 40 }
            })
          ]
        })
      )
    }
    return new TableRow({ children: cells })
  })
  return new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

export function markdownToDocx(markdown: string, title: string, metaLine?: string): Document {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 36, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 }
    })
  ]
  if (metaLine) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: metaLine, size: 20, color: '6B7280', font: 'Times New Roman' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 }
      })
    )
  }

  let index = 0
  let seenFirstHeading = false
  const headingFor = (level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] => {
    const map = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6
    ]
    return map[Math.min(level, 6) - 1]
  }

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index++
      continue
    }

    if (trimmed.startsWith('```')) {
      index++
      const codeLines: string[] = []
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index++
      }
      index++
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: codeLines.join('\n'),
              font: 'Consolas',
              size: 19,
              color: '374151'
            })
          ],
          shading: { fill: 'F3F4F6' },
          spacing: { before: 120, after: 120 }
        })
      )
      continue
    }

    if (trimmed.startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const rows: string[][] = [splitTableRow(trimmed)]
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index].trim()))
        index++
      }
      children.push(tableFromRows(rows))
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const text = heading[2].trim()
      if (!seenFirstHeading) {
        seenFirstHeading = true
        if (level === 1) {
          index++
          continue
        }
      }
      const sizes = [32, 28, 24, 22, 21, 20]
      children.push(
        new Paragraph({
          heading: headingFor(level),
          children: [new TextRun({ text: text.replace(/\*\*/g, ''), bold: true, size: sizes[level - 1], font: 'Times New Roman' })],
          spacing: { before: 260, after: 120 }
        })
      )
      index++
      continue
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      index++
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''))
        index++
      }
      children.push(
        new Paragraph({
          children: inlineRuns(quoteLines.join(' ')),
          indent: { left: 420 },
          spacing: { after: 100 }
        })
      )
      continue
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/)
    if (bullet) {
      children.push(
        new Paragraph({
          children: inlineRuns(bullet[1]),
          bullet: { level: 0 },
          spacing: { after: 60 }
        })
      )
      index++
      continue
    }

    const ordered = trimmed.match(/^(\d+)[.)]\s+(.*)$/)
    if (ordered) {
      children.push(
        new Paragraph({
          children: inlineRuns(`${ordered[1]}. ${ordered[2]}`),
          indent: { left: 420 },
          spacing: { after: 60 }
        })
      )
      index++
      continue
    }

    const paragraphLines = [trimmed]
    index++
    while (index < lines.length) {
      const next = lines[index].trim()
      if (
        !next ||
        next.startsWith('#') ||
        next.startsWith('|') ||
        next.startsWith('>') ||
        next.startsWith('```') ||
        /^[-*+]\s+/.test(next) ||
        /^\d+[.)]\s+/.test(next)
      ) {
        break
      }
      paragraphLines.push(next)
      index++
    }
    children.push(
      new Paragraph({
        children: inlineRuns(paragraphLines.join(' ')),
        spacing: { after: 140, line: 360 }
      })
    )
  }

  return new Document({
    creator: 'Arbor',
    title,
    description: '由 Arbor 根据文献与问答整理生成',
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 22 },
          paragraph: { spacing: { line: 340, after: 100 } }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 }
          }
        },
        children
      }
    ]
  })
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80) || '未命名文档'
}

export async function exportMarkdown(
  markdown: string,
  title: string,
  format: 'docx' | 'md'
): Promise<{ canceled: boolean; filePath?: string }> {
  const extension = format === 'docx' ? 'docx' : 'md'
  const result = await dialog.showSaveDialog({
    title: format === 'docx' ? '导出 Word 文档' : '导出 Markdown',
    defaultPath: path.join(process.env.USERPROFILE || '', 'Documents', `${safeFileName(title)}.${extension}`),
    filters:
      format === 'docx'
        ? [{ name: 'Word 文档', extensions: ['docx'] }]
        : [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  const filePath = await uniqueFileName(result.filePath)

  if (format === 'md') {
    await fs.writeFile(filePath, markdown, 'utf-8')
    return { canceled: false, filePath }
  }

  const metaLine = `生成时间：${new Date().toLocaleString('zh-CN')} · Arbor`
  const doc = markdownToDocx(markdown, title, metaLine)
  const buffer = await Packer.toBuffer(doc)
  await fs.writeFile(filePath, buffer)
  return { canceled: false, filePath }
}

function escapeBib(value: string): string {
  return value
    .replace(/[\\{}&%$#_]/g, (char) => `\\${char}`)
    .replace(/\s+/g, ' ')
    .trim()
}

function bibKey(doc: DocumentMeta, index: number, used: Map<string, number>): string {
  const author = doc.authors.split(/[,，;；]/)[0]?.replace(/[^A-Za-z]/g, '').toLowerCase() ?? ''
  const base = `${author || 'ref'}${doc.year || ''}` || `ref${index + 1}`
  const count = used.get(base) ?? 0
  used.set(base, count + 1)
  return count ? `${base}${count + 1}` : base
}

export function buildBibtex(documents: DocumentMeta[]): string {
  const used = new Map<string, number>()
  return documents
    .map((doc, index) => {
      const fields: [string, string][] = [
        ['title', doc.title],
        ['author', doc.authors],
        ['year', doc.year],
        ['journal', doc.journal],
        ['doi', doc.doi],
        ['url', doc.url],
        ['keywords', doc.tags.join(', ')]
      ].filter(([, value]) => !!value && !!value.trim()) as [string, string][]
      const body = fields.map(([key, value]) => `  ${key} = {${escapeBib(value)}}`).join(',\n')
      return `@article{${bibKey(doc, index, used)},\n${body}\n}`
    })
    .join('\n\n')
}

function collectionNames(data: LibraryData, doc: DocumentMeta): string {
  return doc.collections
    .map((id) => data.collections.find((collection) => collection.id === id)?.name ?? '')
    .filter(Boolean)
    .join('、')
}

function docMetaLines(data: LibraryData, doc: DocumentMeta): string[] {
  return [
    doc.authors ? `- 作者：${doc.authors}` : '',
    doc.year ? `- 年份：${doc.year}` : '',
    doc.journal ? `- 期刊：${doc.journal}` : '',
    doc.doi ? `- DOI：${doc.doi}` : '',
    doc.url ? `- 链接：${doc.url}` : '',
    doc.tags.length ? `- 标签：${doc.tags.join('、')}` : '',
    doc.collections.length ? `- 分类：${collectionNames(data, doc)}` : ''
  ].filter(Boolean)
}

function docNotesMarkdown(data: LibraryData, doc: DocumentMeta): string {
  return [
    `# ${doc.title} · 笔记`,
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    ...docMetaLines(data, doc),
    '',
    '## 摘要',
    '',
    doc.abstract || '（无摘要）',
    '',
    '## 个人笔记',
    '',
    doc.notes || '（无笔记）'
  ].join('\n')
}

function docExcerptsMarkdown(data: LibraryData, doc: DocumentMeta): string {
  const excerpts = data.excerpts.filter((excerpt) => excerpt.docId === doc.id)
  const lines = [`# ${doc.title} · 摘录`, '', `共 ${excerpts.length} 条`, '']
  if (!excerpts.length) lines.push('（无摘录）')
  for (const excerpt of excerpts) {
    lines.push(`## ${excerpt.page ? `第 ${excerpt.page} 页` : '无页码'} · ${excerpt.source}`)
    if (excerpt.question) lines.push(`> 问题：${excerpt.question}`, '')
    lines.push(excerpt.answer || '（无内容）', '')
  }
  return lines.join('\n')
}

function docChatsMarkdown(data: LibraryData, doc: DocumentMeta): string {
  const chats = data.chats.filter((chat) => chat.docIds.includes(doc.id))
  const lines = [`# ${doc.title} · 对话`, '', `共 ${chats.length} 组对话`, '']
  if (!chats.length) lines.push('（无对话）')
  for (const chat of chats) {
    lines.push(`## ${chat.title || '新的对话'}`, '')
    for (const message of chat.messages) {
      const role = message.role === 'user' ? '用户' : message.role === 'assistant' ? 'Arbor' : '系统'
      lines.push(`### ${role}`, '', message.content || '（空）', '')
    }
  }
  return lines.join('\n')
}

export function buildLibraryMarkdown(): string {
  const data = store.data
  const lines = [
    '# Arbor 文献库导出',
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `- 文献：${data.documents.length} 篇`,
    `- 摘录：${data.excerpts.length} 条`,
    `- 对话：${data.chats.length} 组`,
    '',
    '## 文献'
  ]
  for (const doc of data.documents) {
    lines.push('', `### ${doc.title}`, '', ...docMetaLines(data, doc))
    if (doc.abstract) lines.push('', `> ${doc.abstract.replace(/\s+/g, ' ')}`)
    if (doc.notes) lines.push('', '**个人笔记**', '', doc.notes)
  }
  const excerpts = data.excerpts
  lines.push('', '## 摘录与笔记', '')
  if (!excerpts.length) lines.push('（无摘录）')
  for (const excerpt of excerpts) {
    lines.push(
      `### ${excerpt.docTitle}${excerpt.page ? ` · 第 ${excerpt.page} 页` : ''}`,
      '',
      excerpt.question ? `> 问题：${excerpt.question}` : '',
      excerpt.question ? '' : '',
      excerpt.answer || '（无内容）',
      ''
    )
  }
  lines.push('## 对话', '')
  if (!data.chats.length) lines.push('（无对话）')
  for (const chat of data.chats) {
    lines.push(`### ${chat.title || '新的对话'}`, '')
    for (const message of chat.messages) {
      const role = message.role === 'user' ? '用户' : message.role === 'assistant' ? 'Arbor' : '系统'
      lines.push(`**${role}**：${message.content || '（空）'}`, '')
    }
  }
  return lines.join('\n')
}

async function saveAs(defaultName: string, label: string, extensions: string[], data: string | Buffer): Promise<{ canceled: boolean; filePath?: string }> {
  const result = await dialog.showSaveDialog({
    title: label,
    defaultPath: path.join(process.env.USERPROFILE || '', 'Documents', defaultName),
    filters: [{ name: label, extensions }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  const filePath = await uniqueFileName(result.filePath)
  await fs.writeFile(filePath, data)
  return { canceled: false, filePath }
}

export async function exportBibtex(): Promise<{ canceled: boolean; filePath?: string }> {
  return saveAs('arbor-library.bib', 'BibTeX', ['bib'], buildBibtex(store.data.documents))
}

export async function exportLibrary(format: 'md' | 'zip'): Promise<{ canceled: boolean; filePath?: string }> {
  const markdown = buildLibraryMarkdown()
  if (format === 'md') {
    return saveAs(`Arbor-文献库-${new Date().toISOString().slice(0, 10)}.md`, 'Markdown', ['md'], markdown)
  }
  const bibtex = buildBibtex(store.data.documents)
  const zip = createZip([
    { name: 'library.md', data: Buffer.from(markdown, 'utf-8') },
    { name: 'library.bib', data: Buffer.from(bibtex, 'utf-8') }
  ])
  return saveAs(`Arbor-文献库-${new Date().toISOString().slice(0, 10)}.zip`, 'ZIP 压缩包', ['zip'], zip)
}

export async function exportDocumentPackage(docId: string): Promise<{ canceled: boolean; filePath?: string }> {
  const doc = store.getDocument(docId)
  if (!doc) throw new Error('文献不存在')
  const data = store.data
  const entries = [
    { name: 'notes.md', data: Buffer.from(docNotesMarkdown(data, doc), 'utf-8') },
    { name: 'excerpts.md', data: Buffer.from(docExcerptsMarkdown(data, doc), 'utf-8') },
    { name: 'chats.md', data: Buffer.from(docChatsMarkdown(data, doc), 'utf-8') },
    {
      name: 'metadata.json',
      data: Buffer.from(
        JSON.stringify(
          {
            id: doc.id,
            title: doc.title,
            authors: doc.authors,
            year: doc.year,
            journal: doc.journal,
            doi: doc.doi,
            url: doc.url,
            tags: doc.tags,
            collections: doc.collections,
            readingStatus: doc.readingStatus ?? 'unread',
            pageCount: doc.pageCount,
            lastPage: doc.lastPage ?? 1,
            exportedAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf-8'
      )
    }
  ]
  try {
    const original = await fs.readFile(path.join(store.filesDir, doc.fileName))
    const extension = path.extname(doc.fileName) || '.pdf'
    entries.unshift({ name: `${safeFileName(doc.title)}${extension}`, data: original })
  } catch {
    // 原始文件缺失时仍导出笔记与摘录
  }
  return saveAs(`${safeFileName(doc.title)}-文献包.zip`, '文献包', ['zip'], createZip(entries))
}
