import type { DocumentFormat } from './types'

export const IMPORTABLE_EXTENSIONS = ['pdf', 'docx', 'doc', 'txt', 'md', 'markdown']

const EXTENSION_FORMATS: Record<string, DocumentFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md'
}

export function formatFromFileName(fileName: string): DocumentFormat | null {
  const lower = fileName.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return null
  return EXTENSION_FORMATS[lower.slice(dot)] ?? null
}

export function documentFormatOf(doc: {
  sourceFormat?: DocumentFormat
  fileName?: string
}): DocumentFormat {
  return doc.sourceFormat ?? (doc.fileName ? formatFromFileName(doc.fileName) : null) ?? 'pdf'
}
