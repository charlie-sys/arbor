import { promises as fs } from 'fs'
import path from 'path'
import { dialog } from 'electron'
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
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/
  const parts = text.split(pattern).filter((part) => part !== '')
  for (const part of parts) {
    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
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
    creator: 'ZotAgent',
    title,
    description: '由 ZotAgent 根据文献与问答整理生成',
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

  if (format === 'md') {
    await fs.writeFile(result.filePath, markdown, 'utf-8')
    return { canceled: false, filePath: result.filePath }
  }

  const metaLine = `生成时间：${new Date().toLocaleString('zh-CN')} · ZotAgent`
  const doc = markdownToDocx(markdown, title, metaLine)
  const buffer = await Packer.toBuffer(doc)
  await fs.writeFile(result.filePath, buffer)
  return { canceled: false, filePath: result.filePath }
}
