import { promises as fs } from 'fs'
import * as XLSX from 'xlsx'

const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods'])
const MAX_FILE_BYTES = 30 * 1024 * 1024
const MAX_ROWS = 200
const MAX_COLUMNS = 30
const MAX_SHEETS = 8

export function isSpreadsheetFile(file: string): boolean {
  const lower = file.toLowerCase()
  const index = lower.lastIndexOf('.')
  return index >= 0 && SPREADSHEET_EXTENSIONS.has(lower.slice(index))
}

function cellText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

export async function spreadsheetToText(filePath: string, maxChars = 12000): Promise<string> {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_FILE_BYTES) throw new Error('表格文件超过 30MB')
  const workbook = XLSX.readFile(filePath, { cellDates: true })
  const parts: string[] = []

  for (const sheetName of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false
    })
    if (!rows.length) continue
    const trimmed = rows.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLUMNS).map(cellText))
    const columnCount = Math.max(1, ...trimmed.map((row) => row.length))
    const normalize = (row: string[]): string[] => {
      const next = [...row]
      while (next.length < columnCount) next.push('')
      return next
    }
    const header = normalize(trimmed[0]).map((value, index) => value || `列${index + 1}`)
    const body = trimmed.slice(1).map(normalize)
    const lines = [
      `【工作表：${sheetName}】`,
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...body.map((row) => `| ${row.join(' | ')} |`)
    ]
    if (rows.length > MAX_ROWS + 1) lines.push(`（仅展示前 ${MAX_ROWS + 1} 行）`)
    if ((rows[0]?.length ?? 0) > MAX_COLUMNS) lines.push(`（仅展示前 ${MAX_COLUMNS} 列）`)
    const block = lines.join('\n')
    if (parts.join('\n\n').length + block.length > maxChars) {
      parts.push(block.slice(0, Math.max(0, maxChars - parts.join('\n\n').length)))
      parts.push('（表格内容已截断）')
      break
    }
    parts.push(block)
  }

  return parts.join('\n\n').trim() || '（表格为空）'
}
