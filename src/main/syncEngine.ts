import { accountService } from './accountService'
import { store } from './store'
import { BrowserWindow } from 'electron'
import type { AccountState } from '../shared/account'
import type { SyncChange, SyncConflict, SyncEntity, SyncStatus } from '../shared/sync'
import { downloadMissingBlobs, prepareBlobBindings, uploadLocalBlobs } from './blobSync'
import { equivalentBlobBindingPayload } from './localSync'
import { usage } from './usage'
import { applyAliSyncFromStore } from './aliSync'

interface CommitResult {
  accepted: string[]
  conflicts: Array<{
    opId: string
    code: string
    serverVersion: number
    serverPayload?: unknown
    serverDeleted?: boolean
  }>
  latestSeq: number
}

const MAX_COMMIT_BATCH_BYTES = 512 * 1024

function commitBatch(
  operations: ReturnType<typeof store.pendingSyncOperations>
): ReturnType<typeof store.pendingSyncOperations> {
  const selected: typeof operations = []
  let bytes = 0
  for (const operation of operations) {
    const size = Buffer.byteLength(JSON.stringify(operation))
    if (selected.length > 0 && bytes + size > MAX_COMMIT_BATCH_BYTES) break
    selected.push(operation)
    bytes += size
  }
  return selected
}

class SyncEngine {
  private running: Promise<void> | null = null
  private scheduled: NodeJS.Timeout | null = null
  private rerun = false
  private initialized = false
  private readySessionId = ''
  private lastError = ''
  private lastSyncedAt: number | null = null
  private statusListeners = new Set<(status: SyncStatus) => void>()

  init(): void {
    if (this.initialized) return
    this.initialized = true
    store.onChanged(() => this.schedule(300))
    accountService.onStateChange((state) => {
      if (state.session?.id !== this.readySessionId) {
        this.readySessionId = ''
      }
      if (state.status === 'active') this.schedule(0)
      else this.broadcastStatus()
    })
    accountService.onSocketEvent((event) => {
      const message = event as { type?: string; seq?: number }
      if (message.type === 'sync.changed') this.schedule(50)
    })
    if (accountService.state().status === 'active') this.schedule(0)
  }

  status(): { syncing: boolean; lastError: string } {
    return { syncing: Boolean(this.running), lastError: this.lastError }
  }

  getStatus(): SyncStatus {
    const account = accountService.state()
    store.reconcileEquivalentBlobConflicts()
    const conflicts = store.syncConflictCount()
    const initialMerge = account.user
      ? store.initialMergePreview(account.user.id)
      : null
    const initialSyncReady =
      account.status === 'active' &&
      Boolean(account.session?.id) &&
      account.session?.id === this.readySessionId
    const lastError =
      this.lastError ||
      (initialMerge
        ? '本地与云端都有数据，需要确认首次合并'
        : conflicts > 0
          ? `同步发现 ${conflicts} 个版本冲突`
          : '')
    return {
      status:
        account.status !== 'active'
          ? 'signedOut'
          : this.running
            ? 'syncing'
            : lastError
              ? 'error'
              : 'idle',
      pending: store.localSyncStatus().pendingOperations,
      conflicts,
      initialMerge,
      initialSyncReady,
      lastSyncedAt: this.lastSyncedAt,
      lastError
    }
  }

  conflicts(): SyncConflict[] {
    store.reconcileEquivalentBlobConflicts()
    return store.syncConflicts()
  }

  resolveConflict(
    opId: string,
    strategy: 'local' | 'server' | 'merge' | 'custom',
    payload?: unknown
  ): void {
    store.resolveSyncConflict(opId, strategy, payload)
    this.lastError = ''
    this.broadcastStatus()
    this.schedule(strategy === 'local' ? 0 : 100)
  }

  applyInitialMerge(): void {
    const state = accountService.state()
    if (state.status !== 'active' || !state.user) {
      throw new Error('请先登录活动设备')
    }
    store.applyInitialMerge(state.user.id)
    this.lastError = ''
    this.broadcastStatus()
    this.schedule(0)
  }

  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  syncNow(): Promise<void> {
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.running = this.run()
      .then(() => {
        this.lastSyncedAt = Date.now()
      })
      .catch((error: Error) => {
        this.lastError = error.message
        console.warn('[sync]', error.message)
      })
      .finally(() => {
        this.running = null
        this.broadcastStatus()
        if (this.rerun) {
          this.rerun = false
          this.schedule(100)
        }
      })
    this.broadcastStatus()
    return this.running
  }

  private schedule(delay: number): void {
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = setTimeout(() => {
      this.scheduled = null
      void this.syncNow()
    }, delay)
    this.scheduled.unref?.()
  }

  private async run(): Promise<void> {
    const state = accountService.state()
    if (state.status !== 'active' || !state.user) return
    this.lastError = ''
    await prepareBlobBindings()
    await this.ensureRemoteReady(state)
    await uploadLocalBlobs()
    await downloadMissingBlobs()
    await this.pushPending(state.user.id)
    await this.pullChanges(state.user.id)
    await applyAliSyncFromStore()
    usage.applySyncedRecords(
      store
        .listSyncBindings('usage_record')
        .map((entity) => entity.payload as import('../shared/types').UsageRecord)
    )
    store.clearSyncConflicts()
    store.discardInitialMerge()
    if (state.session?.id) {
      this.readySessionId = state.session.id
      this.broadcastStatus()
    }
  }

  private async ensureRemoteReady(state: AccountState): Promise<void> {
    if (!state.user) return
    const localUser = store.syncServerUserId()
    if (localUser === state.user.id) return
    const pendingMerge = store.initialMergePreview(state.user.id)
    if (pendingMerge) {
      if (state.session?.initialSyncMode === 'cloud-first') {
        store.discardInitialMerge()
      } else {
        const remote = await this.fetchRemoteSnapshot()
        store.stageInitialMerge(remote.entities, state.user.id, remote.snapshotSeq)
        throw new Error('本地与云端都有数据，需要确认首次合并')
      }
    }

    const remoteBeforeBootstrap = await this.fetchRemoteSnapshot()
    if (remoteBeforeBootstrap.entities.length > 0) {
      if (
        state.session?.initialSyncMode === 'merge-local' &&
        store.userDataEntityCount() > 0
      ) {
        store.stageInitialMerge(
          remoteBeforeBootstrap.entities,
          state.user.id,
          remoteBeforeBootstrap.snapshotSeq
        )
        throw new Error('本地与云端都有数据，需要确认首次合并')
      }
      store.replaceFromSyncSnapshot(
        remoteBeforeBootstrap.entities,
        state.user.id,
        remoteBeforeBootstrap.snapshotSeq
      )
      return
    }

    const snapshot = store.exportSyncSnapshot()
    let snapshotExists = false
    let uploadId = ''
    try {
      const begin = await accountService.request('/v1/sync/bootstrap/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      if (!begin.ok) throw await responseError(begin)
      uploadId = ((await begin.json()) as { uploadId: string }).uploadId
      for (let offset = 0; offset < snapshot.length; offset += 400) {
        const chunk = snapshot.slice(offset, offset + 400)
        const response = await accountService.request('/v1/sync/bootstrap/chunk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ uploadId, entities: chunk })
        })
        if (!response.ok) throw await responseError(response)
      }
      const complete = await accountService.request('/v1/sync/bootstrap/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadId })
      })
      if (!complete.ok) throw await responseError(complete)
      store.clearPendingSyncOperations()
      store.setSyncCursor(state.user.id, 0)
      return
    } catch (error) {
      if (uploadId) {
        await accountService
          .request(`/v1/sync/bootstrap/${encodeURIComponent(uploadId)}`, {
            method: 'DELETE'
          })
          .catch(() => undefined)
      }
      if ((error as Error & { code?: string }).code !== 'SNAPSHOT_EXISTS') throw error
      snapshotExists = true
    }
    if (!snapshotExists) return
    const localCount = store.userDataEntityCount()
    if (localCount > 0) {
      const remote = await this.fetchRemoteSnapshot()
      store.stageInitialMerge(remote.entities, state.user.id, remote.snapshotSeq)
      throw new Error(
        '该账号云端已有数据，而本机也有本地数据。请确认首次合并。'
      )
    }

    const remote = await this.fetchRemoteSnapshot()
    store.replaceFromSyncSnapshot(remote.entities, state.user.id, remote.snapshotSeq)
  }

  private async fetchRemoteSnapshot(): Promise<{
    entities: SyncEntity[]
    snapshotSeq: number
  }> {
    const entities: SyncEntity[] = []
    let cursorType = ''
    let cursorId = ''
    let snapshotSeq = 0
    for (let page = 0; page < 1000; page++) {
      const params = new URLSearchParams({ limit: '200' })
      if (cursorType) params.set('cursorType', cursorType)
      if (cursorId) params.set('cursorId', cursorId)
      if (snapshotSeq) params.set('afterSeq', String(snapshotSeq))
      const response = await accountService.request(`/v1/sync/snapshot?${params}`)
      if (!response.ok) throw await responseError(response)
      const data = (await response.json()) as {
        entities: SyncEntity[]
        snapshotSeq: number
        hasMore: boolean
        nextCursor: { entityType: string; entityId: string } | null
      }
      entities.push(...data.entities)
      snapshotSeq = data.snapshotSeq
      if (!data.hasMore || !data.nextCursor) break
      cursorType = data.nextCursor.entityType
      cursorId = data.nextCursor.entityId
    }
    return { entities, snapshotSeq }
  }

  private async pushPending(userId: string): Promise<void> {
    for (let batch = 0; batch < 20; batch++) {
      const operations = commitBatch(store.pendingSyncOperations(200))
      if (!operations.length) return
      const response = await accountService.request('/v1/sync/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations })
      })
      if (!response.ok) throw await responseError(response)
      const result = (await response.json()) as CommitResult
      if (result.accepted.length) store.acknowledgeSyncOperations(result.accepted)
      const operationMap = new Map(
        operations.map((operation) => [operation.opId, operation])
      )
      const remainingConflicts = result.conflicts.filter((conflict) => {
        const operation = operationMap.get(conflict.opId)
        if (
          operation?.entityType === 'blob_binding' &&
          !operation.deleted &&
          equivalentBlobBindingPayload(
            operation.payload,
            conflict.serverPayload
          )
        ) {
          store.acknowledgeSyncOperations([operation.opId])
          return false
        }
        return true
      })
      if (remainingConflicts.length) {
        store.recordSyncConflicts(operations, remainingConflicts)
        await this.pullChanges(userId)
        const localConversationWins = remainingConflicts.filter((conflict) => {
          const operation = operationMap.get(conflict.opId)
          return (
            operation?.entityType === 'ali_session' ||
            operation?.entityType === 'ali_memory'
          )
        })
        for (const conflict of localConversationWins) {
          store.resolveSyncConflict(conflict.opId, 'local')
        }
        const unresolved =
          remainingConflicts.length - localConversationWins.length
        if (unresolved > 0) {
          throw new Error(`同步发现 ${unresolved} 个版本冲突`)
        }
        continue
      }
      if (!result.accepted.length && operations.length) {
        throw new Error('同步服务没有确认任何操作')
      }
    }
  }

  private async pullChanges(userId: string): Promise<void> {
    let cursor = store.syncCursor(userId)
    for (let page = 0; page < 20; page++) {
      const response = await accountService.request(
        `/v1/sync/changes?after=${cursor}&limit=200`
      )
      if (!response.ok) throw await responseError(response)
      const data = (await response.json()) as {
        changes: SyncChange[]
        latestSeq: number
        hasMore: boolean
      }
      if (data.changes.length) {
        store.applySyncChanges(data.changes)
        cursor = data.changes.at(-1)?.serverSeq ?? cursor
        store.setSyncCursor(userId, cursor)
      } else if (data.latestSeq > cursor) {
        store.setSyncCursor(userId, data.latestSeq)
        cursor = data.latestSeq
      }
      if (!data.hasMore) return
    }
  }

  private broadcastStatus(): void {
    const status = this.getStatus()
    for (const listener of this.statusListeners) listener(status)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('sync:status', status)
      }
    }
  }
}

async function responseError(response: Response): Promise<Error & { code?: string }> {
  let code: string | undefined
  let message = `同步请求失败 (${response.status})`
  try {
    const data = (await response.json()) as { code?: string; message?: string }
    code = data.code
    if (data.message) message = data.message
  } catch {
    /* Keep the generic message. */
  }
  return Object.assign(new Error(message), { code })
}

export const syncEngine = new SyncEngine()
