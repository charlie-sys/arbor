export interface AppSettings {
  apiBaseUrl: string
  apiKey: string
  chatModel: string
  visionModel: string
  temperature: number
  maxContextChars: number
  systemPrompt: string
}

export interface DocumentMeta {
  id: string
  title: string
  authors: string
  year: string
  journal: string
  abstract: string
  doi: string
  url: string
  tags: string[]
  collections: string[]
  addedAt: number
  updatedAt: number
  fileName: string
  pageCount: number
  starred: boolean
  lastPage: number
  notes: string
}

export type Role = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  error?: boolean
  quotedText?: string
  quotedPage?: number
}

export interface ChatSession {
  id: string
  title: string
  docIds: string[]
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface TranslationRecord {
  id: string
  createdAt: number
  imageFile: string
  translatedImageFile?: string
  structured: string
  plain: string
  model: string
}

export interface RenderBlock {
  id: number
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
}

export interface RenderRequest {
  requestId: string
  imageDataUrl: string
  blocks: RenderBlock[]
}

export interface Collection {
  id: string
  name: string
  createdAt: number
}

export interface LibraryData {
  version: number
  documents: DocumentMeta[]
  collections: Collection[]
  chats: ChatSession[]
  translations: TranslationRecord[]
  settings: AppSettings
}

export interface ImportCandidate {
  filePath: string
  title: string
  fileName: string
}

export interface ExtractedPdf {
  pageCount: number
  pages: string[]
  title?: string
  author?: string
  subject?: string
  keywords?: string
}

export interface ChatRequest {
  requestId: string
  chatId: string
  docIds: string[]
  messages: { role: 'user' | 'assistant'; content: string }[]
  contextMode?: 'auto' | 'none'
}

export interface GenerateDocRequest {
  title: string
  markdown: string
}

export interface TranslationResult {
  id: string
  structured: string
  plain: string
  model: string
  createdAt: number
  imageUrl: string
  translatedImageUrl?: string
}

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
  visionModel: string
  temperature: number
  maxContextChars: number
  systemPrompt: string
}
