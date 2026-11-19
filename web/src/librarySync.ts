import {
  LIBRARY_ENTITY_TYPES,
  SYNC_ENTITY_TYPES,
  mergeSyncedSettings,
  syncedSettings,
  type SyncEntity
} from '@shared/sync'
import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  LibraryData
} from '@shared/types'

interface WrappedValue<T> {
  position: number
  value: T
}

export { LIBRARY_ENTITY_TYPES }

export function syncEntityKey(entityType: string, entityId: string): string {
  return `${entityType}\u0000${entityId}`
}

export function stableJson(value: unknown): string {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)])
    )
  }
  return JSON.stringify(stable(value))
}

function wrapped<T>(position: number, value: T): WrappedValue<T> {
  return { position, value }
}

function chatMetadata(chat: ChatSession): Omit<ChatSession, 'messages'> {
  const { messages: _messages, ...metadata } = chat
  return metadata
}

export function libraryToSyncEntities(data: LibraryData): SyncEntity[] {
  const entities: SyncEntity[] = []
  const addArray = <T extends { id: string }>(
    entityType: string,
    items: T[]
  ): void => {
    items.forEach((item, position) => {
      entities.push({
        entityType,
        entityId: item.id,
        version: 1,
        payload: wrapped(position, item),
        deleted: false
      })
    })
  }

  addArray('document', data.documents)
  addArray('collection', data.collections)
  addArray('translation', data.translations)
  addArray('highlight', data.highlights)
  addArray('excerpt', data.excerpts)
  addArray('inbox', data.inbox)
  addArray('task', data.tasks)
  addArray('research_topic', data.researchTopics)
  addArray('canvas', data.canvases)
  addArray('tag', data.tags)
  addArray('property', data.properties)
  addArray('saved_view', data.savedViews)
  addArray('reading_plan', data.readingPlans)

  data.chats.forEach((chat, position) => {
    entities.push({
      entityType: 'chat',
      entityId: chat.id,
      version: 1,
      payload: wrapped(position, chatMetadata(chat)),
      deleted: false
    })
    chat.messages.forEach((message, messagePosition) => {
      entities.push({
        entityType: 'chat_message',
        entityId: `${chat.id}:${message.id}`,
        version: 1,
        payload: {
          chatId: chat.id,
          position: messagePosition,
          message
        },
        deleted: false
      })
    })
  })

  entities.push({
    entityType: 'settings',
    entityId: 'default',
    version: 1,
    payload: syncedSettings(data.settings),
    deleted: false
  })
  return entities
}

function activeEntities(entities: SyncEntity[]): Map<string, SyncEntity> {
  return new Map(
    entities
      .filter((entity) => !entity.deleted)
      .map((entity) => [
        syncEntityKey(entity.entityType, entity.entityId),
        entity
      ])
  )
}

function decodeWrapped<T>(entity: SyncEntity): WrappedValue<T> | null {
  const payload = entity.payload as Partial<WrappedValue<T>> | null
  if (
    !payload ||
    !Number.isFinite(payload.position) ||
    !payload.value ||
    typeof payload.value !== 'object'
  ) {
    return null
  }
  return {
    position: Number(payload.position),
    value: payload.value
  }
}

function decodeMessage(
  entity: SyncEntity
): { chatId: string; position: number; message: ChatMessage } | null {
  const payload = entity.payload as {
    chatId?: unknown
    position?: unknown
    message?: ChatMessage
  } | null
  if (
    !payload ||
    typeof payload.chatId !== 'string' ||
    !Number.isFinite(payload.position) ||
    !payload.message ||
    typeof payload.message !== 'object'
  ) {
    return null
  }
  return {
    chatId: payload.chatId,
    position: Number(payload.position),
    message: payload.message
  }
}

function mergeSettings(
  remote: Partial<AppSettings> | undefined,
  local: AppSettings
): AppSettings {
  return mergeSyncedSettings(remote, local)
}

export function syncEntitiesToLibrary(
  entities: SyncEntity[],
  local: LibraryData
): LibraryData {
  const byKey = activeEntities(entities)
  const byType = new Map<string, SyncEntity[]>()
  for (const entity of byKey.values()) {
    const list = byType.get(entity.entityType) ?? []
    list.push(entity)
    byType.set(entity.entityType, list)
  }

  const readWrapped = <T,>(entityType: string): T[] =>
    (byType.get(entityType) ?? [])
      .map((entity) => decodeWrapped<T>(entity))
      .filter((item): item is WrappedValue<T> => Boolean(item))
      .sort((left, right) => left.position - right.position)
      .map((item) => item.value)

  const legacy = byKey.get(syncEntityKey('web_library', 'default'))
  if (
    !byType.has('document') &&
    !byType.has('settings') &&
    legacy?.payload &&
    typeof legacy.payload === 'object'
  ) {
    return legacy.payload as LibraryData
  }

  const chats = readWrapped<Omit<ChatSession, 'messages'>>('chat').map(
    (chat) => ({
      ...chat,
      messages: [] as ChatMessage[]
    })
  )
  const chatById = new Map(chats.map((chat) => [chat.id, chat]))
  const messages = (byType.get('chat_message') ?? [])
    .map(decodeMessage)
    .filter(
      (
        item
      ): item is {
        chatId: string
        position: number
        message: ChatMessage
      } => Boolean(item)
    )
    .sort((left, right) => left.position - right.position)
  for (const item of messages) {
    chatById.get(item.chatId)?.messages.push(item.message)
  }

  const settingsEntity = (byType.get('settings') ?? [])[0]
  const remoteSettings =
    settingsEntity?.payload &&
    typeof settingsEntity.payload === 'object'
      ? (settingsEntity.payload as Partial<AppSettings>)
      : undefined

  return {
    version: 1,
    documents: readWrapped('document'),
    collections: readWrapped('collection'),
    chats,
    translations: readWrapped('translation'),
    highlights: readWrapped('highlight'),
    excerpts: readWrapped('excerpt'),
    inbox: readWrapped('inbox'),
    tasks: readWrapped('task'),
    researchTopics: readWrapped('research_topic'),
    canvases: readWrapped('canvas'),
    tags: readWrapped('tag'),
    properties: readWrapped('property'),
    savedViews: readWrapped('saved_view'),
    readingPlans: readWrapped('reading_plan'),
    settings: mergeSettings(remoteSettings, local.settings)
  }
}
