export interface TokenPrice {
  // 每百万 token 单价
  input: number
  output: number
}

export interface UsagePricing {
  currency: 'CNY' | 'USD'
  models: Record<string, TokenPrice>
  defaultPrice: TokenPrice
}

export interface AppSettings {
  apiBaseUrl: string
  apiKey: string
  chatModel: string
  visionModel: string
  temperature: number
  // 0 表示不限制注入的文献上下文字符数
  maxContextChars: number
  systemPrompt: string
  usagePricing: UsagePricing
}

export type UsageKind = 'chat' | 'compose' | 'translate' | 'action' | 'plan' | 'topic' | 'inbox' | 'test'

export interface UsageRecord {
  id: string
  createdAt: number
  kind: UsageKind
  model: string
  promptTokens: number
  completionTokens: number
  // 关联的对话，用于按会话聚合用量
  chatId?: string
  // 首 token 延迟（毫秒），仅流式对话可精确获得
  firstTokenMs?: number
  // 首 token 到生成结束的耗时（毫秒），用于计算输出速度
  generationMs?: number
  // 输入 token 中命中缓存的 token 数；服务端未提供时缺省
  cachedTokens?: number
  // 服务端未返回 usage 时为本地估算值
  estimated?: boolean
}

export interface ActiveUsage {
  id: string
  kind: UsageKind
  model: string
  startedAt: number
  promptTokens: number
  completionTokens: number
}

export interface Tag {
  id: string
  name: string
  parentId?: string
  color?: string
}

export type PropertyType = 'text' | 'number' | 'select' | 'multiselect' | 'date' | 'checkbox' | 'url'

export interface PropertyOption {
  id: string
  name: string
  color?: string
}

export interface Property {
  id: string
  name: string
  type: PropertyType
  options?: PropertyOption[]
}

export type PropertyValue = string | number | boolean | string[] | null

export interface SavedViewConfig {
  query?: string
  starredOnly?: boolean
  status?: ReadingStatus | 'all'
  year?: string
  tag?: string
  collectionId?: string
  propertyFilters?: Record<string, string>
  viewMode?: 'cards' | 'table'
  sorts?: { key: string; dir: 'asc' | 'desc' }[]
  columns?: string[]
}

export interface SavedView {
  id: string
  name: string
  config: SavedViewConfig
  createdAt: number
  updatedAt: number
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
  sourceFormat?: DocumentFormat
  pageCount: number
  starred: boolean
  readingStatus: ReadingStatus
  lastPage: number
  notes: string
  propertyValues?: Record<string, PropertyValue>
}

export type ReadingStatus = 'unread' | 'reading' | 'read'

export type DocumentFormat = 'pdf' | 'docx' | 'doc' | 'txt' | 'md'

export type Role = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  error?: boolean
  quotedText?: string
  quotedPage?: number
  attachments?: InboxAttachment[]
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
  parentId?: string
  includeChildren?: boolean
  createdAt: number
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

export interface HighlightRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Highlight {
  id: string
  docId: string
  page: number
  color: HighlightColor
  text: string
  note: string
  rects: HighlightRect[]
  createdAt: number
  updatedAt: number
}

export interface Excerpt {
  id: string
  docId: string | null
  docTitle: string
  page?: number
  source: string
  question: string
  answer: string
  attachments?: InboxAttachment[]
  createdAt: number
  updatedAt: number
  docMissing?: boolean
}

export type CanvasNodeKind = 'document' | 'excerpt' | 'chat' | 'section'

export interface CanvasNode {
  id: string
  kind: CanvasNodeKind
  x: number
  y: number
  width: number
  height: number
  title: string
  text?: string
  docId?: string
  excerptId?: string
  chatId?: string
  messageId?: string
  color?: string
  createdAt: number
}

export interface CanvasEdge {
  id: string
  from: string
  to: string
  label?: string
}

export interface CanvasBoard {
  id: string
  name: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  createdAt: number
  updatedAt: number
}

export interface BackupInfo {
  name: string
  createdAt: number
  size: number
}

export interface ImportSummary {
  kind: 'bibtex' | 'readwise'
  documentsAdded: number
  documentsMerged: number
  excerptsAdded: number
  skipped: number
}

export interface ImportResult {
  canceled: boolean
  summary?: ImportSummary
}

export interface ReadingPlanItem {
  docId: string
  order: number
  focus: string
  questions: string[]
}

export interface ReadingPlan {
  id: string
  goal: string
  items: ReadingPlanItem[]
  model?: string
  createdAt: number
}

export type InboxKind = 'text' | 'link' | 'excerpt' | 'todo'

export interface InboxAttachment {
  id: string
  name: string
  file: string
  kind: 'image' | 'file'
  size: number
  createdAt: number
}

export interface InboxItem {
  id: string
  kind: InboxKind
  content: string
  title: string
  url: string
  docId?: string
  page?: number
  tags?: string[]
  attachments?: InboxAttachment[]
  archived: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskItem {
  id: string
  title: string
  due?: string
  done: boolean
  docId?: string
  excerptId?: string
  inboxId?: string
  createdAt: number
  updatedAt: number
}

export interface ResearchTopic {
  id: string
  name: string
  docIds: string[]
  questions: string[]
  chatId?: string
  createdAt: number
  updatedAt: number
}

export type InboxSuggestionType = 'tag' | 'collection' | 'excerpt' | 'task'

export interface InboxSuggestion {
  inboxId: string
  type: InboxSuggestionType
  value: string
  reason?: string
}

export type SearchResultType = 'document' | 'note' | 'chat' | 'message' | 'excerpt' | 'collection'

export interface SearchResult {
  id: string
  type: SearchResultType
  title: string
  snippet: string
  docId?: string
  chatId?: string
  collectionId?: string
  page?: number
  docMissing?: boolean
  updatedAt?: number
}

export interface LibraryData {
  version: number
  documents: DocumentMeta[]
  collections: Collection[]
  chats: ChatSession[]
  translations: TranslationRecord[]
  highlights: Highlight[]
  excerpts: Excerpt[]
  inbox: InboxItem[]
  tasks: TaskItem[]
  researchTopics: ResearchTopic[]
  canvases: CanvasBoard[]
  tags: Tag[]
  properties: Property[]
  savedViews: SavedView[]
  settings: AppSettings
}

export interface ImportCandidate {
  filePath: string
  title: string
  fileName: string
  format: DocumentFormat
}

export interface ExtractedDocument {
  pageCount: number
  pages: string[]
}

export interface ExtractedPdf {
  pageCount: number
  pages: string[]
  title?: string
  author?: string
  subject?: string
  keywords?: string
  journal?: string
  year?: string
  doi?: string
  abstract?: string
}

export interface ChatContext {
  contextMode: 'auto' | 'none' | 'page' | 'selection'
  page?: number
  selection?: string
  includeNotes?: boolean
}

export interface ChatRequest {
  requestId: string
  chatId: string
  docIds: string[]
  messages: { role: 'user' | 'assistant'; content: string; attachments?: InboxAttachment[] }[]
  context?: ChatContext
}

export type AiActionId = 'translate' | 'summarize' | 'explain-formula' | 'compare'

export interface AiActionOutput {
  action: AiActionId
  content: string
  model: string
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
