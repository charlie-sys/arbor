import * as pdfjsLib from 'pdfjs-dist'
import type { ExtractedPdf } from '@shared/types'

const assetBase = new URL('pdfjs/', document.baseURI).href
pdfjsLib.GlobalWorkerOptions.workerSrc = `${assetBase}pdf.worker.polyfilled.mjs`

export function pdfOptions(url: string): Record<string, unknown> {
  return {
    url,
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
    iccUrl: `${assetBase}iccs/`
  }
}

export async function extractPdf(
  url: string,
  onProgress?: (page: number, total: number) => void
): Promise<ExtractedPdf> {
  const task = pdfjsLib.getDocument(pdfOptions(url) as never)
  try {
    const pdf = await task.promise
    let title = ''
    let author = ''
    try {
      const metadata = await pdf.getMetadata()
      const info = metadata.info as Record<string, unknown> | undefined
      const rawTitle = typeof info?.Title === 'string' ? info.Title.trim() : ''
      const rawAuthor = typeof info?.Author === 'string' ? info.Author.trim() : ''
      if (rawTitle && !/^untitled/i.test(rawTitle)) title = rawTitle
      if (rawAuthor && !/^unknown/i.test(rawAuthor)) author = rawAuthor
    } catch {
      // metadata is optional
    }

    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        text += item.hasEOL ? '\n' : ' '
      }
      pages.push(text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim())
      page.cleanup()
      onProgress?.(pageNumber, pdf.numPages)
    }

    return { pageCount: pdf.numPages, pages, title: title || undefined, author: author || undefined }
  } finally {
    await task.destroy()
  }
}
