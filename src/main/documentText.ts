import { promises as fs } from 'fs'
import path from 'path'
import { extractRawText } from 'mammoth'
import WordExtractor from 'word-extractor'
import { store } from './store'
import { documentFormatOf } from '../shared/documents'
import type { DocumentFormat, ExtractedDocument } from '../shared/types'
import { t } from '../shared/i18n'

import { splitIntoPages } from './documentPages'
export { splitIntoPages } from './documentPages'

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
  if (!doc) throw new Error(t("文献不存在"))
  if (!doc.fileName) throw new Error(t("该文献没有关联文件"))
  const format = documentFormatOf(doc)
  if (format === 'web') throw new Error(t('网页直接读取当前页面，无需提取分页正文'))
  if (format === 'pdf') throw new Error(t("PDF 文本请在阅读器中提取"))
  const filePath = path.join(store.filesDir, doc.fileName)
  let body = ''
  try {
    body = await readDocumentBody(filePath, format)
  } catch (err) {
    if (format === 'doc') {
      throw new Error(t("无法解析 Word 97-2003 文档：{0}", [(err as Error).message]))
    }
    throw err
  }
  const pages = splitIntoPages(body)
  if (!pages.length) throw new Error(t("未从文件中提取到正文"))
  return { pageCount: pages.length, pages }
}
