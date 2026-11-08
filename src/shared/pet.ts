import type { Locale } from './i18n'

export type PetState =
  | 'typing'
  | 'reading'
  | 'thinking'
  | 'active'
  | 'idle'
  | 'away'
  | 'busy'
  | 'happy'

export type PetView =
  | 'library'
  | 'reader'
  | 'chats'
  | 'topics'
  | 'canvas'
  | 'readingPlan'
  | 'inbox'
  | 'translations'
  | 'usage'
  | 'settings'

export type PetSignal =
  | { type: 'keys'; keys: number }
  | { type: 'pointer'; moved: number }
  | { type: 'scroll' }
  | { type: 'context'; view: PetView }
  | { type: 'celebrate' }

export interface PetSnapshot {
  state: PetState
  since: number
  label: string
  view: PetView
}

export interface PetSettings {
  enabled: boolean
  bubbles: boolean
}

export interface PetRuntimeConfig extends PetSettings {
  quietUntil: number
  language: Locale
}

export interface PetWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export type PetMenuAction =
  | 'toggle-bubbles'
  | 'quiet'
  | 'reset-position'
  | 'open-main'
  | 'open-settings'
  | 'hide'

export const PET_STATE_LABEL: Record<PetState, string> = {
  typing: '正在写作',
  reading: '正在阅读',
  thinking: '正在思考',
  active: '四处看看',
  idle: '摸一会儿鱼',
  away: '睡着了',
  busy: 'AI 正在干活',
  happy: '开心'
}

export const PET_VIEWS: PetView[] = [
  'library',
  'reader',
  'chats',
  'topics',
  'canvas',
  'readingPlan',
  'inbox',
  'translations',
  'usage',
  'settings'
]
