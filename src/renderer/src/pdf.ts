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
    iccUrl: `${assetBase}iccs/`,
    useSystemFonts: true
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
    let subject = ''
    let journal = ''
    let year = ''
    let doi = ''
    let abstract = ''
    let keywords = ''
    try {
      const metadata = await pdf.getMetadata()
      const info = metadata.info as Record<string, unknown> | undefined
      const xmp = metadata.metadata as { get?: (name: string) => string } | null
      const xmpGet = (name: string): string => {
        try {
          return String(xmp?.get?.(name) ?? '').trim()
        } catch {
          return ''
        }
      }
      const clean = (value: string): string => value.replace(/\s+/g, ' ').trim()
      const infoTitle = typeof info?.Title === 'string' ? clean(info.Title) : ''
      const infoAuthor = typeof info?.Author === 'string' ? clean(info.Author) : ''
      const xmpTitle = clean(xmpGet('dc:title'))
      const xmpAuthor = clean(xmpGet('dc:creator'))
      title = [infoTitle, xmpTitle].find((value) => value && !/^untitled/i.test(value)) ?? ''
      author = [infoAuthor, xmpAuthor].find((value) => value && !/^unknown/i.test(value)) ?? ''
      subject = clean(typeof info?.Subject === 'string' ? info.Subject : '')
      journal = clean(xmpGet('prism:publicationName')) || clean(xmpGet('dc:source'))
      keywords = clean(typeof info?.Keywords === 'string' ? info.Keywords : '') || clean(xmpGet('pdf:Keywords'))
      abstract = clean(xmpGet('dc:description'))
      if (!journal && subject && subject.length < 80 && !subject.includes(',')) journal = subject
      if (!abstract && subject.length > 120) abstract = subject
      const date =
        clean(xmpGet('prism:coverDate')) ||
        clean(xmpGet('xmp:CreateDate')) ||
        clean(typeof info?.CreationDate === 'string' ? info.CreationDate : '')
      const yearMatch = date.match(/(?:19|20)\d{2}/)
      if (yearMatch) year = yearMatch[0]
      doi = clean(xmpGet('prism:doi'))
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

    if (!doi) {
      const head = pages.slice(0, 3).join(' ')
      const doiMatch = head.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)
      if (doiMatch) doi = doiMatch[0].replace(/[.,;]+$/, '')
    }

    return {
      pageCount: pdf.numPages,
      pages,
      title: title || undefined,
      author: author || undefined,
      subject: subject || undefined,
      keywords: keywords || undefined,
      journal: journal || undefined,
      year: year || undefined,
      doi: doi || undefined,
      abstract: abstract || undefined
    }
  } finally {
    await task.destroy()
  }
}
