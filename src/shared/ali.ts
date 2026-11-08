export interface AliSource {
  title: string
  url: string
  provider: 'web' | 'github'
  snippet?: string
}

export interface AliToolTrace {
  id: string
  name: string
  args: string
  status: 'running' | 'ok' | 'error'
  summary?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

export interface AliMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  error?: boolean
  sources?: AliSource[]
  helpSections?: string[]
  toolTraces?: AliToolTrace[]
}

export interface AliSession {
  id: string
  title: string
  messages: AliMessage[]
  summary: string
  summaryUpTo?: string
  memoryCursor?: string
  createdAt: number
  updatedAt: number
}

export interface AliSettings {
  enabled: boolean
  model: string
  auxModel: string
  baseUrl: string
  apiKey: string
  auxBaseUrl: string
  auxApiKey: string
  temperature: number
  memoryEnabled: boolean
  memoryExtract: boolean
  ttsEnabled: boolean
  ttsAutoSpeak: boolean
  ttsVoice: string
  ttsRate: number
  ttsVolume: number
  searchPolicy: 'auto' | 'off'
  webProvider: 'exa' | 'searxng'
  webEndpoint: string
  webApiKey: string
  githubToken: string
}

export interface AliSessionPatch {
  title?: string
  messages?: AliMessage[]
  summary?: string
  summaryUpTo?: string
  memoryCursor?: string
}

export interface AliState {
  sessions: AliSession[]
  settings: AliSettings
  dataDir: string
}

export interface AliHelpSection {
  id: string
  title: string
  path: string
  keywords: string[]
  body: string
}

export interface AliMemoryTopic {
  doc: string
  title: string
  description: string
  pinned: boolean
  content: string
}

export interface AliMemoryState {
  self: string
  memory: string
  topics: AliMemoryTopic[]
  archive: string
  usage: {
    self: { chars: number; quota: number }
    memory: { chars: number; quota: number }
  }
}

export interface AliSendRequest {
  requestId: string
  sessionId: string
  content: string
}

export interface AliTestResult {
  ok: boolean
  message: string
}

export type AliEventType = 'status' | 'delta' | 'tool' | 'source' | 'memory' | 'done' | 'error'

export interface AliEvent {
  requestId: string
  sessionId: string
  type: AliEventType
  status?: 'thinking' | 'streaming' | 'canceled'
  delta?: string
  content?: string
  error?: string
  sources?: AliSource[]
  helpSections?: string[]
  tool?: AliToolTrace
  memory?: { lines: string[] }
  message?: AliMessage
}

export const DEFAULT_ALI_SETTINGS: AliSettings = {
  enabled: true,
  model: '',
  auxModel: '',
  baseUrl: '',
  apiKey: '',
  auxBaseUrl: '',
  auxApiKey: '',
  temperature: 0.7,
  memoryEnabled: true,
  memoryExtract: true,
  ttsEnabled: false,
  ttsAutoSpeak: false,
  ttsVoice: '',
  ttsRate: 1,
  ttsVolume: 1,
  searchPolicy: 'auto',
  webProvider: 'exa',
  webEndpoint: '',
  webApiKey: '',
  githubToken: ''
}

export function defaultAliSettings(): AliSettings {
  return { ...DEFAULT_ALI_SETTINGS }
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

export function normalizeAliSettings(raw: unknown): AliSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<AliSettings>) : {}
  const defaults = DEFAULT_ALI_SETTINGS
  return {
    enabled: bool(value.enabled, defaults.enabled),
    model: text(value.model, defaults.model),
    auxModel: text(value.auxModel, defaults.auxModel),
    baseUrl: text(value.baseUrl, defaults.baseUrl),
    apiKey: text(value.apiKey, defaults.apiKey),
    auxBaseUrl: text(value.auxBaseUrl, defaults.auxBaseUrl),
    auxApiKey: text(value.auxApiKey, defaults.auxApiKey),
    temperature: clamp(value.temperature, defaults.temperature, 0, 2),
    memoryEnabled: bool(value.memoryEnabled, defaults.memoryEnabled),
    memoryExtract: bool(value.memoryExtract, defaults.memoryExtract),
    ttsEnabled: bool(value.ttsEnabled, defaults.ttsEnabled),
    ttsAutoSpeak: bool(value.ttsAutoSpeak, defaults.ttsAutoSpeak),
    ttsVoice: text(value.ttsVoice, defaults.ttsVoice),
    ttsRate: clamp(value.ttsRate, defaults.ttsRate, 0.5, 2),
    ttsVolume: clamp(value.ttsVolume, defaults.ttsVolume, 0, 1),
    searchPolicy: value.searchPolicy === 'off' ? 'off' : 'auto',
    webProvider: value.webProvider === 'searxng' ? 'searxng' : 'exa',
    webEndpoint: text(value.webEndpoint, defaults.webEndpoint),
    webApiKey: text(value.webApiKey, defaults.webApiKey),
    githubToken: text(value.githubToken, defaults.githubToken)
  }
}
