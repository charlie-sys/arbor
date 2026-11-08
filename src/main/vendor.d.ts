declare module 'mammoth' {
  export function extractRawText(input: { path: string }): Promise<{
    value: string
    messages: { type: string; message: string }[]
  }>
}

declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string
    getFootnotes(): string
    getHeaders(): string
    getEndnotes(): string
  }

  export default class WordExtractor {
    extract(filePath: string): Promise<WordDocument>
  }
}
