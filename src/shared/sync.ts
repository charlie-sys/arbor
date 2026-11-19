import type { AliSettings } from './ali'
import type { AppSettings } from './types'

export const LIBRARY_ENTITY_TYPES = [
  'document',
  'collection',
  'translation',
  'highlight',
  'excerpt',
  'inbox',
  'task',
  'research_topic',
  'canvas',
  'tag',
  'property',
  'saved_view',
  'reading_plan',
  'chat',
  'chat_message',
  'settings'
] as const

export const SYNC_ENTITY_TYPES = [
  ...LIBRARY_ENTITY_TYPES,
  'usage_record',
  'ali_session',
  'ali_memory',
  'blob_binding'
] as const

export const LOCAL_MODEL_SETTING_KEYS = [
  'apiBaseUrl',
  'apiKey',
  'chatModel',
  'visionModel',
  'temperature',
  'maxContextChars',
  'systemPrompt'
] as const

export const LOCAL_ALI_SETTING_KEYS = [
  'model',
  'auxModel',
  'baseUrl',
  'apiKey',
  'auxBaseUrl',
  'auxApiKey',
  'temperature',
  'webEndpoint',
  'webApiKey',
  'githubToken'
] as const

export type SyncedAppSettings = Omit<
  AppSettings,
  (typeof LOCAL_MODEL_SETTING_KEYS)[number] | 'ali'
> & {
  ali: Omit<AliSettings, (typeof LOCAL_ALI_SETTING_KEYS)[number]>
}

export function syncedSettings(settings: AppSettings): SyncedAppSettings {
  return {
    language: settings.language,
    uiFontSize: settings.uiFontSize,
    updateDownloadSource: settings.updateDownloadSource,
    usagePricing: settings.usagePricing,
    petEnabled: settings.petEnabled,
    petBubbles: settings.petBubbles,
    ali: {
      enabled: settings.ali.enabled,
      memoryEnabled: settings.ali.memoryEnabled,
      memoryExtract: settings.ali.memoryExtract,
      ttsEnabled: settings.ali.ttsEnabled,
      ttsAutoSpeak: settings.ali.ttsAutoSpeak,
      ttsVoice: settings.ali.ttsVoice,
      ttsRate: settings.ali.ttsRate,
      ttsVolume: settings.ali.ttsVolume,
      searchPolicy: settings.ali.searchPolicy,
      webProvider: settings.ali.webProvider
    }
  }
}

export function mergeSyncedSettings(
  remote: Partial<AppSettings> | undefined,
  local: AppSettings
): AppSettings {
  if (!remote) return local
  const ali = remote.ali ?? {}
  return {
    ...local,
    ...remote,
    apiBaseUrl: local.apiBaseUrl,
    apiKey: local.apiKey,
    chatModel: local.chatModel,
    visionModel: local.visionModel,
    temperature: local.temperature,
    maxContextChars: local.maxContextChars,
    systemPrompt: local.systemPrompt,
    ali: {
      ...local.ali,
      ...ali,
      model: local.ali.model,
      auxModel: local.ali.auxModel,
      baseUrl: local.ali.baseUrl,
      apiKey: local.ali.apiKey,
      auxBaseUrl: local.ali.auxBaseUrl,
      auxApiKey: local.ali.auxApiKey,
      temperature: local.ali.temperature,
      webEndpoint: local.ali.webEndpoint,
      webApiKey: local.ali.webApiKey,
      githubToken: local.ali.githubToken
    }
  }
}

export interface SyncEntity {
  entityType: string
  entityId: string
  version: number
  payload: unknown
  deleted?: boolean
}

export interface SyncOperation extends SyncEntity {
  opId: string
  baseVersion: number
  operation: 'put' | 'delete'
  basePayload?: unknown
}

export interface SyncChange extends SyncEntity {
  serverSeq: number
  deleted: boolean
}

export interface SyncConflict {
  opId: string
  entityType: string
  entityId: string
  basePayload: unknown
  localPayload: unknown
  serverPayload: unknown
  localDeleted?: boolean
  serverDeleted?: boolean
  baseVersion: number
  serverVersion: number
  createdAt: number
  mergeable?: boolean
  mergedPayload?: unknown
  mergeFields?: string[]
}

export interface InitialMergePreview {
  localTotal: number
  remoteTotal: number
  localOnly: number
  remoteOnly: number
  identical: number
  conflicts: number
  snapshotSeq: number
  createdAt: number
}

export interface SyncSnapshot {
  id: string
  reason: 'pre_commit' | 'pre_restore'
  entityCount: number
  deviceName: string
  createdAt: string
}

export interface SyncSnapshotChange {
  entityType: string
  entityId: string
  change: 'added' | 'updated' | 'removed'
}

export interface SyncSnapshotDetail {
  files: SyncSnapshotChange[]
  changes: SyncSnapshotChange[]
  totalChanges: number
  hasMore: boolean
}

export interface SyncStatus {
  status: 'signedOut' | 'idle' | 'syncing' | 'error'
  pending: number
  conflicts: number
  initialMerge: InitialMergePreview | null
  initialSyncReady: boolean
  lastSyncedAt: number | null
  lastError: string
}
