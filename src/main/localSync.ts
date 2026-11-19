import { DatabaseSync } from 'node:sqlite'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type { AppSettings, ChatMessage, ChatSession, LibraryData } from '../shared/types'
import type {
  InitialMergePreview,
  SyncChange,
  SyncConflict,
  SyncEntity,
  SyncOperation
} from '../shared/sync'
import {
  LIBRARY_ENTITY_TYPES,
  mergeSyncedSettings,
  syncedSettings
} from '../shared/sync'

const LIBRARY_ENTITY_TYPE_SET = new Set<string>(LIBRARY_ENTITY_TYPES)

interface EntityRecord {
  type: string
  id: string
  payload: unknown
}

interface StoredEntityRow {
  entity_type: string
  entity_id: string
  version: number
  payload: string
  deleted: number
}

interface MetaRow {
  value: string
}

interface OutboxRow {
  op_id: string
  entity_type: string
  entity_id: string
  base_version: number
  operation: 'put' | 'delete'
  payload: string | null
  base_payload: string | null
}

interface ConflictRow {
  op_id: string
  entity_type: string
  entity_id: string
  base_payload: string
  local_payload: string
  server_payload: string
  base_version: number
  server_version: number
  local_deleted: number
  server_deleted: number
  created_at: number
}

interface InitialMergeRow {
  entity_type: string
  entity_id: string
  version: number
  payload: string
  deleted: number
}

interface OutboxConflictRow {
  operation: 'put' | 'delete'
}

export interface LocalSyncStatus {
  databasePath: string
  entityCount: number
  pendingOperations: number
  importedAt: number | null
  lastMutationAt: number | null
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  )
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function entityKey(entityType: string, entityId: string): string {
  return `${entityType}\u0000${entityId}`
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right)
}

export function equivalentBlobBindingPayload(
  left: unknown,
  right: unknown
): boolean {
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return false
  }
  const local = left as Record<string, unknown>
  const server = right as Record<string, unknown>
  return (
    typeof local.path === 'string' &&
    local.path === server.path &&
    typeof local.sha256 === 'string' &&
    local.sha256 === server.sha256 &&
    Number(local.size) === Number(server.size) &&
    String(local.mimeType ?? '') === String(server.mimeType ?? '')
  )
}

interface MergeResult {
  mergeable: boolean
  merged: unknown
  fields: string[]
}

function mergeThreeWay(base: unknown, local: unknown, server: unknown): MergeResult {
  const conflicts: string[] = []
  const merge = (baseValue: unknown, localValue: unknown, serverValue: unknown, prefix: string): unknown => {
    if (valuesEqual(localValue, baseValue)) return serverValue
    if (valuesEqual(serverValue, baseValue)) return localValue
    if (valuesEqual(localValue, serverValue)) return localValue
    const plainBase = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
    const plainLocal = localValue && typeof localValue === 'object' && !Array.isArray(localValue)
    const plainServer = serverValue && typeof serverValue === 'object' && !Array.isArray(serverValue)
    if (plainBase && plainLocal && plainServer) {
      const result: Record<string, unknown> = {}
      const keys = new Set([
        ...Object.keys(baseValue as Record<string, unknown>),
        ...Object.keys(localValue as Record<string, unknown>),
        ...Object.keys(serverValue as Record<string, unknown>)
      ])
      for (const key of keys) {
        result[key] = merge(
          (baseValue as Record<string, unknown>)[key],
          (localValue as Record<string, unknown>)[key],
          (serverValue as Record<string, unknown>)[key],
          prefix ? `${prefix}.${key}` : key
        )
      }
      return result
    }
    conflicts.push(prefix || 'payload')
    return serverValue
  }
  const merged = merge(base, local, server, '')
  return { mergeable: conflicts.length === 0, merged, fields: conflicts }
}

function wrapped(position: number, value: unknown): unknown {
  return { position, value }
}

function chatMetadata(chat: ChatSession): Omit<ChatSession, 'messages'> {
  const { messages: _messages, ...metadata } = chat
  return metadata
}

function recordsFromLibrary(data: LibraryData): EntityRecord[] {
  const records: EntityRecord[] = []
  const addArray = <T extends { id: string }>(type: string, items: T[]): void => {
    items.forEach((item, position) => {
      records.push({ type, id: item.id, payload: wrapped(position, item) })
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
    records.push({
      type: 'chat',
      id: chat.id,
      payload: wrapped(position, chatMetadata(chat))
    })
    chat.messages.forEach((message, messagePosition) => {
      records.push({
        type: 'chat_message',
        id: `${chat.id}:${message.id}`,
        payload: {
          chatId: chat.id,
          position: messagePosition,
          message
        }
      })
    })
  })

  records.push({
    type: 'settings',
    id: 'default',
    payload: syncedSettings(data.settings)
  })
  return records
}

function decodeWrapped<T>(raw: string): { position: number; value: T } | null {
  try {
    const parsed = JSON.parse(raw) as { position?: unknown; value?: T }
    if (!Number.isFinite(parsed.position) || !parsed.value || typeof parsed.value !== 'object') return null
    return { position: parsed.position as number, value: parsed.value }
  } catch {
    return null
  }
}

function decodeMessage(raw: string): { chatId: string; position: number; message: ChatMessage } | null {
  try {
    const parsed = JSON.parse(raw) as {
      chatId?: unknown
      position?: unknown
      message?: ChatMessage
    }
    if (
      typeof parsed.chatId !== 'string' ||
      !Number.isFinite(parsed.position) ||
      !parsed.message ||
      typeof parsed.message !== 'object'
    ) {
      return null
    }
    return {
      chatId: parsed.chatId,
      position: parsed.position as number,
      message: parsed.message
    }
  } catch {
    return null
  }
}

export class LocalSyncStore {
  databasePath = ''
  private db: DatabaseSync | null = null
  private importedAt: number | null = null
  private lastMutationAt: number | null = null

  async init(root: string): Promise<void> {
    this.databasePath = path.join(root, 'arbor.db')
    await fs.mkdir(root, { recursive: true })
    await this.openWithRecovery()
  }

  async reload(root: string): Promise<void> {
    this.close()
    await this.init(root)
  }

  private async openWithRecovery(): Promise<void> {
    try {
      this.open()
      return
    } catch (error) {
      console.error('[local-sync] database open failed, preserving corrupt copy', error)
      this.close()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      for (const suffix of ['', '-wal', '-shm']) {
        const source = `${this.databasePath}${suffix}`
        await fs.rename(source, `${source}.corrupt-${stamp}`).catch(() => undefined)
      }
      this.open()
    }
  }

  private open(): void {
    const db = new DatabaseSync(this.databasePath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(entity_type, entity_id)
      );

      CREATE TABLE IF NOT EXISTS outbox (
        op_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT,
        base_payload TEXT,
        created_at INTEGER NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS outbox_pending_idx
      ON outbox(state, created_at);

      CREATE TABLE IF NOT EXISTS applied_ops (
        op_id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_conflicts (
        op_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        base_payload TEXT NOT NULL,
        local_payload TEXT NOT NULL,
        server_payload TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        server_version INTEGER NOT NULL,
        local_deleted INTEGER NOT NULL DEFAULT 0,
        server_deleted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS initial_merge_entities (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(entity_type, entity_id)
      );
    `)
    const ensureColumn = (table: string, column: string, definition: string): void => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (!columns.some((item) => item.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      }
    }
    ensureColumn('outbox', 'base_payload', 'TEXT')
    ensureColumn('sync_conflicts', 'base_payload', "TEXT NOT NULL DEFAULT 'null'")
    ensureColumn('sync_conflicts', 'server_payload', "TEXT NOT NULL DEFAULT 'null'")
    ensureColumn('sync_conflicts', 'local_deleted', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn('sync_conflicts', 'server_deleted', 'INTEGER NOT NULL DEFAULT 0')
    db.exec('PRAGMA user_version = 2')
    this.db = db
    this.importedAt = this.readMetaNumber('library_imported_at')
    this.lastMutationAt = this.readMetaNumber('last_mutation_at')
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw new Error('Local sync database is not initialized')
    return this.db
  }

  private readMetaNumber(key: string): number | null {
    const row = this.requireDb()
      .prepare('SELECT value FROM sync_meta WHERE key = ?')
      .get(key) as MetaRow | undefined
    const value = Number(row?.value)
    return Number.isFinite(value) ? value : null
  }

  private setMeta(key: string, value: string | number): void {
    this.requireDb()
      .prepare(
        `INSERT INTO sync_meta(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, String(value))
  }

  hasLibrarySnapshot(): boolean {
    const row = this.requireDb()
      .prepare('SELECT value FROM sync_meta WHERE key = ?')
      .get('library_imported') as MetaRow | undefined
    return row?.value === '1'
  }

  async importLibrary(data: LibraryData, sourceFile?: string): Promise<void> {
    if (sourceFile) {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        await fs.copyFile(sourceFile, `${sourceFile}.pre-sqlite-${stamp}.bak`)
      } catch {
        /* The source JSON may not exist on first launch. */
      }
    }

    const db = this.requireDb()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM entities')
      db.exec('DELETE FROM outbox')
      db.exec('DELETE FROM applied_ops')
      const insert = db.prepare(
        'INSERT INTO entities(entity_type, entity_id, version, payload, deleted, updated_at) VALUES (?, ?, ?, ?, 0, ?)'
      )
      const now = Date.now()
      for (const record of recordsFromLibrary(data)) {
        insert.run(record.type, record.id, 1, stableJson(record.payload), now)
      }
      this.importedAt = now
      this.lastMutationAt = null
      this.setMeta('library_imported', '1')
      this.setMeta('library_imported_at', now)
      this.setMeta('last_mutation_at', '')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  loadLibrary(fallbackSettings: AppSettings): LibraryData | null {
    if (!this.hasLibrarySnapshot()) return null
    const rows = this.requireDb()
      .prepare(
        `SELECT entity_type, entity_id, version, payload, deleted
         FROM entities WHERE deleted = 0`
      )
      .all() as unknown as StoredEntityRow[]

    const byType = new Map<string, StoredEntityRow[]>()
    for (const row of rows) {
      const list = byType.get(row.entity_type) ?? []
      list.push(row)
      byType.set(row.entity_type, list)
    }

    const readWrapped = <T,>(type: string): T[] => {
      const decoded = (byType.get(type) ?? [])
        .map((row) => decodeWrapped<T>(row.payload))
        .filter((item): item is { position: number; value: T } => Boolean(item))
        .sort((left, right) => left.position - right.position)
      return decoded.map((item) => item.value)
    }

    const chats = readWrapped<Omit<ChatSession, 'messages'>>('chat').map((chat) => ({
      ...chat,
      messages: [] as ChatMessage[]
    }))
    const chatMap = new Map(chats.map((chat) => [chat.id, chat]))
    const messages = (byType.get('chat_message') ?? [])
      .map((row) => decodeMessage(row.payload))
      .filter((item): item is { chatId: string; position: number; message: ChatMessage } => Boolean(item))
      .sort((left, right) => left.position - right.position)
    for (const item of messages) chatMap.get(item.chatId)?.messages.push(item.message)

    const settingsRow = (byType.get('settings') ?? [])[0]
    let settings = fallbackSettings
    if (settingsRow) {
      try {
        const stored = JSON.parse(settingsRow.payload) as Partial<AppSettings>
        settings = mergeSyncedSettings(stored, fallbackSettings)
      } catch {
        /* Keep the encrypted JSON settings as the fallback. */
      }
    }

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
      settings
    }
  }

  persistLibrary(data: LibraryData): void {
    const db = this.requireDb()
    const now = Date.now()
    const next = new Map(
      recordsFromLibrary(data).map((record) => [
        `${record.type}\u0000${record.id}`,
        record
      ])
    )
    const existingRows = db
      .prepare('SELECT entity_type, entity_id, version, payload, deleted FROM entities')
      .all() as unknown as StoredEntityRow[]
    const existing = new Map(existingRows.map((row) => [`${row.entity_type}\u0000${row.entity_id}`, row]))
    const put = db.prepare(
      `INSERT INTO entities(entity_type, entity_id, version, payload, deleted, updated_at)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         version = excluded.version,
         payload = excluded.payload,
         deleted = 0,
         updated_at = excluded.updated_at`
    )
    const remove = db.prepare(
      'UPDATE entities SET version = ?, deleted = 1, updated_at = ? WHERE entity_type = ? AND entity_id = ?'
    )
    const enqueue = db.prepare(
      `INSERT INTO outbox(
         op_id, entity_type, entity_id, base_version, operation, payload, base_payload, created_at, state
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )

    let mutations = 0
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const [key, record] of next) {
        const previous = existing.get(key)
        const payload = stableJson(record.payload)
        if (previous && previous.deleted === 0 && previous.payload === payload) continue
        const baseVersion = previous?.version ?? 0
        const version = baseVersion + 1
        put.run(record.type, record.id, version, payload, now)
        enqueue.run(
          crypto.randomUUID(),
          record.type,
          record.id,
          baseVersion,
          'put',
          payload,
          previous?.payload ?? null,
          now
        )
        mutations++
      }

      for (const [key, row] of existing) {
        if (
          next.has(key) ||
          row.deleted === 1 ||
          !LIBRARY_ENTITY_TYPE_SET.has(row.entity_type)
        ) {
          continue
        }
        const version = row.version + 1
        remove.run(version, now, row.entity_type, row.entity_id)
        enqueue.run(
          crypto.randomUUID(),
          row.entity_type,
          row.entity_id,
          row.version,
          'delete',
          null,
          row.payload,
          now
        )
        mutations++
      }

      if (mutations) {
        this.lastMutationAt = now
        this.setMeta('last_mutation_at', now)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  checkpoint(): void {
    this.requireDb().exec('PRAGMA wal_checkpoint(FULL)')
  }

  exportSnapshot(): SyncEntity[] {
    const rows = this.requireDb()
      .prepare(
        `SELECT entity_type, entity_id, version, payload, deleted
         FROM entities WHERE deleted = 0
         ORDER BY entity_type, entity_id`
      )
      .all() as unknown as StoredEntityRow[]
    return rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      version: Number(row.version),
      payload: JSON.parse(row.payload) as unknown,
      deleted: false
    }))
  }

  pendingOperations(limit = 200): SyncOperation[] {
    const rows = this.requireDb()
      .prepare(
        `SELECT op_id, entity_type, entity_id, base_version, operation, payload, base_payload
         FROM outbox WHERE state = 'pending'
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(Math.max(1, Math.min(500, limit))) as unknown as OutboxRow[]
    return rows.map((row) => ({
      opId: row.op_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      baseVersion: Number(row.base_version),
      operation: row.operation,
      version: Number(row.base_version) + 1,
      payload: row.payload ? JSON.parse(row.payload) as unknown : null,
      basePayload: row.base_payload ? JSON.parse(row.base_payload) as unknown : null,
      deleted: row.operation === 'delete'
    }))
  }

  acknowledgeOperations(opIds: string[]): void {
    if (!opIds.length) return
    const db = this.requireDb()
    const statement = db.prepare('DELETE FROM outbox WHERE op_id = ?')
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of opIds) statement.run(id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  clearPendingOperations(): void {
    this.requireDb().prepare("DELETE FROM outbox WHERE state = 'pending'").run()
  }

  markOperationsConflict(opIds: string[]): void {
    if (!opIds.length) return
    const statement = this.requireDb().prepare(
      "UPDATE outbox SET state = 'conflict', retry_count = retry_count + 1 WHERE op_id = ?"
    )
    for (const id of opIds) statement.run(id)
  }

  recordConflicts(
    operations: SyncOperation[],
    conflicts: Array<{
      opId: string
      serverVersion: number
      serverPayload?: unknown
      serverDeleted?: boolean
    }>
  ): void {
    const operationMap = new Map(operations.map((operation) => [operation.opId, operation]))
    const db = this.requireDb()
    const insert = db.prepare(
      `INSERT INTO sync_conflicts(
         op_id, entity_type, entity_id, base_payload, local_payload, server_payload,
         base_version, server_version, local_deleted, server_deleted, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(op_id) DO UPDATE SET
         base_payload = excluded.base_payload,
         local_payload = excluded.local_payload,
         server_payload = excluded.server_payload,
         base_version = excluded.base_version,
         server_version = excluded.server_version,
         local_deleted = excluded.local_deleted,
         server_deleted = excluded.server_deleted,
         created_at = excluded.created_at`
    )
    const mark = db.prepare(
      "UPDATE outbox SET state = 'conflict', retry_count = retry_count + 1 WHERE op_id = ?"
    )
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const conflict of conflicts) {
        const operation = operationMap.get(conflict.opId)
        if (!operation) continue
        if (
          operation.entityType === 'blob_binding' &&
          !operation.deleted &&
          equivalentBlobBindingPayload(
            operation.payload,
            conflict.serverPayload
          )
        ) {
          db.prepare('DELETE FROM outbox WHERE op_id = ?').run(operation.opId)
          continue
        }
        insert.run(
          operation.opId,
          operation.entityType,
          operation.entityId,
          stableJson(operation.basePayload ?? null),
          stableJson(operation.payload),
          stableJson(conflict.serverPayload ?? null),
          operation.baseVersion,
          conflict.serverVersion,
          operation.deleted ? 1 : 0,
          conflict.serverDeleted ? 1 : 0,
          Date.now()
        )
        mark.run(operation.opId)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  listConflicts(): SyncConflict[] {
    const rows = this.requireDb()
      .prepare(
        `SELECT op_id, entity_type, entity_id, local_payload, base_version, server_version, created_at
                , base_payload, server_payload, local_deleted, server_deleted
         FROM sync_conflicts ORDER BY created_at ASC`
      )
      .all() as unknown as ConflictRow[]
    return rows.map((row) => {
      const basePayload = JSON.parse(row.base_payload) as unknown
      const localPayload = JSON.parse(row.local_payload) as unknown
      const serverPayload = JSON.parse(row.server_payload) as unknown
      const merge =
        row.local_deleted === 1 || row.server_deleted === 1
          ? {
              mergeable: false,
              merged: serverPayload,
              fields: ['deleted']
            }
          : mergeThreeWay(basePayload, localPayload, serverPayload)
      return {
        opId: row.op_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        basePayload,
        localPayload,
        serverPayload,
        localDeleted: row.local_deleted === 1,
        serverDeleted: row.server_deleted === 1,
        baseVersion: Number(row.base_version),
        serverVersion: Number(row.server_version),
        createdAt: Number(row.created_at),
        mergeable: merge.mergeable,
        mergedPayload: merge.merged,
        mergeFields: merge.fields
      }
    })
  }

  reconcileEquivalentBlobConflicts(): number {
    const db = this.requireDb()
    const rows = db
      .prepare(
        `SELECT op_id, local_payload, server_payload, local_deleted, server_deleted
         FROM sync_conflicts WHERE entity_type = 'blob_binding'`
      )
      .all() as unknown as Array<{
        op_id: string
        local_payload: string
        server_payload: string
        local_deleted: number
        server_deleted: number
      }>
    const equivalent = rows.filter((row) => {
      if (row.local_deleted === 1 || row.server_deleted === 1) return false
      try {
        return equivalentBlobBindingPayload(
          JSON.parse(row.local_payload) as unknown,
          JSON.parse(row.server_payload) as unknown
        )
      } catch {
        return false
      }
    })
    if (!equivalent.length) return 0
    const removeOutbox = db.prepare('DELETE FROM outbox WHERE op_id = ?')
    const removeConflict = db.prepare('DELETE FROM sync_conflicts WHERE op_id = ?')
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of equivalent) {
        removeOutbox.run(row.op_id)
        removeConflict.run(row.op_id)
      }
      db.exec('COMMIT')
      return equivalent.length
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  resolveConflict(
    opId: string,
    strategy: 'local' | 'server' | 'merge' | 'custom',
    customPayload?: unknown
  ): void {
    const db = this.requireDb()
    const conflict = db
      .prepare(
        `SELECT op_id, entity_type, entity_id, base_payload, local_payload, server_payload,
                base_version, server_version, local_deleted, server_deleted, created_at
         FROM sync_conflicts WHERE op_id = ?`
      )
      .get(opId) as ConflictRow | undefined
    if (!conflict) throw new Error('同步冲突不存在或已解决')
    const entity = db
      .prepare(
        `SELECT entity_type, entity_id, version, payload, deleted
         FROM entities WHERE entity_type = ? AND entity_id = ?`
      )
      .get(conflict.entity_type, conflict.entity_id) as StoredEntityRow | undefined

    db.exec('BEGIN IMMEDIATE')
    try {
      if (strategy === 'server') {
        db.prepare(
          `INSERT INTO entities(entity_type, entity_id, version, payload, deleted, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             version = excluded.version,
             payload = excluded.payload,
             deleted = excluded.deleted,
             updated_at = excluded.updated_at`
        ).run(
          conflict.entity_type,
          conflict.entity_id,
          Number(conflict.server_version),
          conflict.server_payload,
          conflict.server_deleted === 1 ? 1 : 0,
          Date.now()
        )
        db.prepare('DELETE FROM outbox WHERE op_id = ?').run(opId)
      } else {
        const baseVersion = entity?.version ?? Number(conflict.server_version)
        const nextVersion = baseVersion + 1
        const payload =
          strategy === 'merge'
            ? mergeThreeWay(
                JSON.parse(conflict.base_payload) as unknown,
                JSON.parse(conflict.local_payload) as unknown,
                JSON.parse(conflict.server_payload) as unknown
              )
            : null
        if (
          strategy === 'merge' &&
          (conflict.local_deleted === 1 ||
            conflict.server_deleted === 1 ||
            !payload?.mergeable)
        ) {
          throw new Error('该冲突包含同一字段的不同修改，不能自动合并')
        }
        const keepDeleted = strategy === 'local' && conflict.local_deleted === 1
        const serialized = keepDeleted
          ? conflict.server_payload
          : strategy === 'merge'
          ? stableJson(payload?.merged)
          : strategy === 'custom'
            ? stableJson(customPayload)
            : conflict.local_payload
        db.prepare(
          `INSERT INTO entities(entity_type, entity_id, version, payload, deleted, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             version = excluded.version,
             payload = excluded.payload,
             deleted = excluded.deleted,
             updated_at = excluded.updated_at`
        ).run(
          conflict.entity_type,
          conflict.entity_id,
          nextVersion,
          serialized,
          keepDeleted ? 1 : 0,
          Date.now()
        )
        db.prepare(
          `UPDATE outbox SET
             operation = ?,
             base_version = ?,
             payload = ?,
             base_payload = ?,
             state = 'pending',
             retry_count = 0,
             created_at = ?
           WHERE op_id = ?`
        ).run(
          keepDeleted ? 'delete' : 'put',
          baseVersion,
          keepDeleted ? null : serialized,
          conflict.server_payload,
          Date.now(),
          opId
        )
      }
      db.prepare('DELETE FROM sync_conflicts WHERE op_id = ?').run(opId)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  conflictCount(): number {
    const row = this.requireDb()
      .prepare('SELECT COUNT(*) AS count FROM sync_conflicts')
      .get() as { count: number }
    return Number(row.count)
  }

  clearConflicts(): number {
    const db = this.requireDb()
    const count = this.conflictCount()
    if (!count) return 0
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM sync_conflicts')
      db.exec("DELETE FROM outbox WHERE state = 'conflict'")
      db.exec('COMMIT')
      return count
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  stageInitialMerge(
    entities: SyncEntity[],
    userId: string,
    snapshotSeq: number
  ): InitialMergePreview {
    const db = this.requireDb()
    const insert = db.prepare(
      `INSERT INTO initial_merge_entities(
         entity_type, entity_id, version, payload, deleted
       ) VALUES (?, ?, ?, ?, ?)`
    )
    const now = Date.now()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM initial_merge_entities')
      for (const entity of entities) {
        insert.run(
          entity.entityType,
          entity.entityId,
          entity.version,
          stableJson(entity.payload),
          entity.deleted ? 1 : 0
        )
      }
      this.setMeta('initial_merge_pending', '1')
      this.setMeta('initial_merge_user_id', userId)
      this.setMeta('initial_merge_snapshot_seq', Math.max(0, Math.floor(snapshotSeq)))
      this.setMeta('initial_merge_created_at', now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    const preview = this.initialMergePreview(userId)
    if (!preview) throw new Error('首次合并预览创建失败')
    return preview
  }

  initialMergePreview(userId?: string): InitialMergePreview | null {
    const db = this.requireDb()
    const pending = db
      .prepare('SELECT value FROM sync_meta WHERE key = ?')
      .get('initial_merge_pending') as MetaRow | undefined
    if (pending?.value !== '1') return null
    const storedUserId = db
      .prepare('SELECT value FROM sync_meta WHERE key = ?')
      .get('initial_merge_user_id') as MetaRow | undefined
    if (userId && storedUserId?.value !== userId) return null

    const localRows = db
      .prepare(
        `SELECT entity_type, entity_id, version, payload, deleted
         FROM entities`
      )
      .all() as unknown as StoredEntityRow[]
    const remoteRows = db
      .prepare(
        `SELECT entity_type, entity_id, version, payload, deleted
         FROM initial_merge_entities`
      )
      .all() as unknown as InitialMergeRow[]
    const local = new Map(
      localRows.map((row) => [entityKey(row.entity_type, row.entity_id), row])
    )
    const remote = new Map(
      remoteRows.map((row) => [entityKey(row.entity_type, row.entity_id), row])
    )
    let localTotal = 0
    let remoteTotal = 0
    let localOnly = 0
    let remoteOnly = 0
    let identical = 0
    let conflicts = 0

    for (const row of local.values()) {
      if (row.deleted === 0) localTotal++
    }
    for (const row of remote.values()) {
      if (row.deleted === 0) remoteTotal++
    }
    for (const key of new Set([...local.keys(), ...remote.keys()])) {
      const localRow = local.get(key)
      const remoteRow = remote.get(key)
      const localActive = localRow?.deleted === 0
      const remoteActive = remoteRow?.deleted === 0
      if (localRow && remoteRow) {
        if (!localActive && !remoteActive) continue
        if (
          localActive &&
          remoteActive &&
          localRow.payload === remoteRow.payload
        ) {
          identical++
        } else {
          conflicts++
        }
      } else if (localActive) {
        localOnly++
      } else if (remoteActive) {
        remoteOnly++
      }
    }

    const seq = Number(
      (
        db
          .prepare('SELECT value FROM sync_meta WHERE key = ?')
          .get('initial_merge_snapshot_seq') as MetaRow | undefined
      )?.value ?? 0
    )
    const createdAt = Number(
      (
        db
          .prepare('SELECT value FROM sync_meta WHERE key = ?')
          .get('initial_merge_created_at') as MetaRow | undefined
      )?.value ?? Date.now()
    )
    return {
      localTotal,
      remoteTotal,
      localOnly,
      remoteOnly,
      identical,
      conflicts,
      snapshotSeq: Number.isFinite(seq) ? seq : 0,
      createdAt
    }
  }

  applyInitialMerge(userId: string): void {
    const preview = this.initialMergePreview(userId)
    if (!preview) throw new Error('首次合并预览不存在或属于其他账号')
    const db = this.requireDb()
    const now = Date.now()
    const upsert = db.prepare(
      `INSERT INTO entities(entity_type, entity_id, version, payload, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         version = excluded.version,
         payload = excluded.payload,
         deleted = excluded.deleted,
         updated_at = excluded.updated_at`
    )
    const enqueue = db.prepare(
      `INSERT INTO outbox(
         op_id, entity_type, entity_id, base_version, operation, payload,
         base_payload, created_at, state
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const recordConflict = db.prepare(
      `INSERT INTO sync_conflicts(
         op_id, entity_type, entity_id, base_payload, local_payload, server_payload,
         base_version, server_version, local_deleted, server_deleted, created_at
       ) VALUES (?, ?, ?, 'null', ?, ?, ?, ?, ?, ?, ?)`
    )

    db.exec('BEGIN IMMEDIATE')
    try {
      const localRows = db
        .prepare(
          `SELECT entity_type, entity_id, version, payload, deleted
           FROM entities`
        )
        .all() as unknown as StoredEntityRow[]
      const remoteRows = db
        .prepare(
          `SELECT entity_type, entity_id, version, payload, deleted
           FROM initial_merge_entities`
        )
        .all() as unknown as InitialMergeRow[]
      const local = new Map(
        localRows.map((row) => [entityKey(row.entity_type, row.entity_id), row])
      )
      const remote = new Map(
        remoteRows.map((row) => [entityKey(row.entity_type, row.entity_id), row])
      )

      // Rebuild the sync queue from the final local state before merging remote data.
      db.exec('DELETE FROM outbox')
      db.exec('DELETE FROM sync_conflicts')

      for (const [key, remoteRow] of remote) {
        const localRow = local.get(key)
        const sameContent =
          localRow &&
          localRow.deleted === remoteRow.deleted &&
          localRow.payload === remoteRow.payload
        upsert.run(
          remoteRow.entity_type,
          remoteRow.entity_id,
          remoteRow.version,
          remoteRow.payload,
          remoteRow.deleted,
          now
        )
        if (!localRow || sameContent) continue

        const opId = crypto.randomUUID()
        enqueue.run(
          opId,
          localRow.entity_type,
          localRow.entity_id,
          remoteRow.version,
          localRow.deleted === 1 ? 'delete' : 'put',
          localRow.deleted === 1 ? null : localRow.payload,
          remoteRow.payload,
          now,
          'conflict'
        )
        recordConflict.run(
          opId,
          localRow.entity_type,
          localRow.entity_id,
          localRow.payload,
          remoteRow.payload,
          remoteRow.version,
          remoteRow.version,
          localRow.deleted,
          remoteRow.deleted,
          now
        )
      }

      for (const [key, localRow] of local) {
        if (remote.has(key) || localRow.deleted === 1) continue
        enqueue.run(
          crypto.randomUUID(),
          localRow.entity_type,
          localRow.entity_id,
          0,
          'put',
          localRow.payload,
          null,
          now,
          'pending'
        )
      }

      this.setMeta('server_user_id', userId)
      this.setMeta(`server_cursor:${userId}`, preview.snapshotSeq)
      this.setMeta('library_imported', '1')
      db.exec('DELETE FROM initial_merge_entities')
      db.exec("DELETE FROM sync_meta WHERE key LIKE 'initial_merge_%'")
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  discardInitialMerge(): void {
    const db = this.requireDb()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM initial_merge_entities')
      db.exec("DELETE FROM sync_meta WHERE key LIKE 'initial_merge_%'")
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  serverUserId(): string | null {
    const row = this.requireDb()
      .prepare('SELECT value FROM sync_meta WHERE key = ?')
      .get('server_user_id') as MetaRow | undefined
    return row?.value || null
  }

  serverCursor(userId: string): number {
    const row = this.requireDb()
      .prepare('SELECT value FROM sync_meta WHERE key = ?')
      .get(`server_cursor:${userId}`) as MetaRow | undefined
    const value = Number(row?.value)
    return Number.isFinite(value) ? value : 0
  }

  setServerCursor(userId: string, seq: number): void {
    this.requireDb().exec('BEGIN IMMEDIATE')
    try {
      this.setMeta('server_user_id', userId)
      this.setMeta(`server_cursor:${userId}`, Math.max(0, Math.floor(seq)))
      this.requireDb().exec('COMMIT')
    } catch (error) {
      this.requireDb().exec('ROLLBACK')
      throw error
    }
  }

  replaceFromSnapshot(entities: SyncEntity[], userId: string, seq: number): void {
    const db = this.requireDb()
    const now = Date.now()
    const insert = db.prepare(
      `INSERT INTO entities(entity_type, entity_id, version, payload, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM entities')
      db.exec('DELETE FROM outbox')
      for (const entity of entities) {
        insert.run(
          entity.entityType,
          entity.entityId,
          entity.version,
          stableJson(entity.payload),
          entity.deleted ? 1 : 0,
          now
        )
      }
      this.setMeta('server_user_id', userId)
      this.setMeta(`server_cursor:${userId}`, seq)
      this.setMeta('library_imported', '1')
      this.setMeta('library_imported_at', now)
      this.importedAt = now
      this.lastMutationAt = null
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  applyChanges(changes: SyncChange[]): void {
    if (!changes.length) return
    const db = this.requireDb()
    const upsert = db.prepare(
      `INSERT INTO entities(entity_type, entity_id, version, payload, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         version = excluded.version,
         payload = excluded.payload,
         deleted = excluded.deleted,
         updated_at = excluded.updated_at
       WHERE excluded.version >= entities.version`
    )
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const change of changes) {
        upsert.run(
          change.entityType,
          change.entityId,
          change.version,
          stableJson(change.payload),
          change.deleted ? 1 : 0,
          Date.now()
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  upsertLocalEntity(entityType: string, entityId: string, payload: unknown): void {
    const db = this.requireDb()
    const previous = db
      .prepare(
        'SELECT entity_type, entity_id, version, payload, deleted FROM entities WHERE entity_type = ? AND entity_id = ?'
      )
      .get(entityType, entityId) as StoredEntityRow | undefined
    const serialized = stableJson(payload)
    if (
      previous &&
      previous.deleted === 0 &&
      previous.payload === serialized
    ) {
      return
    }
    const now = Date.now()
    const baseVersion = previous?.version ?? 0
    const nextVersion = baseVersion + 1
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(
        `INSERT INTO entities(entity_type, entity_id, version, payload, deleted, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           version = excluded.version,
           payload = excluded.payload,
           deleted = 0,
           updated_at = excluded.updated_at`
      ).run(entityType, entityId, nextVersion, serialized, now)
      db.prepare(
        `INSERT INTO outbox(
           op_id, entity_type, entity_id, base_version, operation, payload, base_payload, created_at, state
         ) VALUES (?, ?, ?, ?, 'put', ?, ?, ?, 'pending')`
      ).run(
        crypto.randomUUID(),
        entityType,
        entityId,
        baseVersion,
        serialized,
        previous?.payload ?? null,
        now
      )
      this.lastMutationAt = now
      this.setMeta('last_mutation_at', now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  deleteLocalEntity(entityType: string, entityId: string): void {
    const db = this.requireDb()
    const previous = db
      .prepare(
        'SELECT entity_type, entity_id, version, payload, deleted FROM entities WHERE entity_type = ? AND entity_id = ?'
      )
      .get(entityType, entityId) as StoredEntityRow | undefined
    if (!previous || previous.deleted === 1) return
    const now = Date.now()
    const version = previous.version + 1
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(
        `UPDATE entities SET version = ?, deleted = 1, updated_at = ?
         WHERE entity_type = ? AND entity_id = ?`
      ).run(version, now, entityType, entityId)
      db.prepare(
        `INSERT INTO outbox(
           op_id, entity_type, entity_id, base_version, operation, payload, base_payload, created_at, state
         ) VALUES (?, ?, ?, ?, 'delete', NULL, ?, ?, 'pending')`
      ).run(
        crypto.randomUUID(),
        entityType,
        entityId,
        previous.version,
        previous.payload,
        now
      )
      this.lastMutationAt = now
      this.setMeta('last_mutation_at', now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  getLocalEntity(entityType: string, entityId: string): unknown | null {
    const row = this.requireDb()
      .prepare(
        `SELECT entity_type, entity_id, version, payload, deleted
         FROM entities WHERE entity_type = ? AND entity_id = ? AND deleted = 0`
      )
      .get(entityType, entityId) as StoredEntityRow | undefined
    if (!row) return null
    try {
      return JSON.parse(row.payload) as unknown
    } catch {
      return null
    }
  }

  listLocalEntities(entityType: string): SyncEntity[] {
    const rows = this.requireDb()
      .prepare(
        `SELECT entity_type, entity_id, version, payload, deleted
         FROM entities
         WHERE entity_type = ? AND deleted = 0
         ORDER BY entity_id`
      )
      .all(entityType) as unknown as StoredEntityRow[]
    return rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      version: Number(row.version),
      payload: JSON.parse(row.payload) as unknown,
      deleted: false
    }))
  }

  status(): LocalSyncStatus {
    const db = this.requireDb()
    const entityCount = Number(
      (db.prepare('SELECT COUNT(*) AS count FROM entities WHERE deleted = 0').get() as { count: number }).count
    )
    const pendingOperations = Number(
      (
        db.prepare("SELECT COUNT(*) AS count FROM outbox WHERE state = 'pending'").get() as {
          count: number
        }
      ).count
    )
    return {
      databasePath: this.databasePath,
      entityCount,
      pendingOperations,
      importedAt: this.importedAt,
      lastMutationAt: this.lastMutationAt
    }
  }

  userDataEntityCount(): number {
    const row = this.requireDb()
      .prepare(
        `SELECT COUNT(*) AS count FROM entities
         WHERE deleted = 0 AND entity_type NOT IN ('settings', 'blob_binding')`
      )
      .get() as { count: number }
    return Number(row.count)
  }
}
