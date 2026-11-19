import type { AliMemoryState, AliSession } from '../shared/ali'
import { aliMemory } from './ali/memory'
import { aliStore } from './ali/store'
import { store } from './store'

let applying = false
let watching = false

function activeAliSessions(): AliSession[] {
  return store
    .listSyncBindings('ali_session')
    .map((entity) => entity.payload as { position: number; session: AliSession })
    .filter(
      (item) =>
        Number.isFinite(item?.position) &&
        item?.session &&
        typeof item.session.id === 'string'
    )
    .sort((left, right) => left.position - right.position)
    .map((item) => item.session)
}

function activeAliMemory(): AliMemoryState | null {
  const entity = store.listSyncBindings('ali_memory')[0]
  const state = entity?.payload as AliMemoryState | undefined
  return state && typeof state === 'object' ? state : null
}

function sameMemory(left: AliMemoryState, right: AliMemoryState): boolean {
  return (
    left.self === right.self &&
    left.memory === right.memory &&
    left.archive === right.archive &&
    JSON.stringify(
      [...left.topics].sort((a, b) => a.doc.localeCompare(b.doc))
    ) ===
      JSON.stringify(
        [...right.topics].sort((a, b) => a.doc.localeCompare(b.doc))
      )
  )
}

export async function seedAliSyncFromLocal(): Promise<void> {
  const localSessions = aliStore.list()
  const syncedSessions = activeAliSessions()
  const sessions = new Map(syncedSessions.map((session) => [session.id, session]))
  for (const session of localSessions) sessions.set(session.id, session)
  const mergedSessions = [...sessions.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)

  if (localSessions.length && mergedSessions.length !== syncedSessions.length) {
    await aliStore.replaceAll(mergedSessions)
  }
  for (const [position, session] of mergedSessions.entries()) {
    store.upsertSyncEntity('ali_session', session.id, { position, session })
  }

  const syncedMemory = activeAliMemory()
  if (await aliMemory.hasUserData()) {
    store.upsertSyncEntity('ali_memory', 'default', await aliMemory.getState())
  } else if (!syncedMemory) {
    store.upsertSyncEntity('ali_memory', 'default', await aliMemory.getState())
  }
}

export async function applyAliSyncFromStore(): Promise<void> {
  applying = true
  try {
    const sessions = activeAliSessions()
    const current = aliStore.list()
    if (
      sessions.length !== current.length ||
      sessions.some(
        (session, index) =>
          session.id !== current[index]?.id ||
          session.updatedAt !== current[index]?.updatedAt
      )
    ) {
      await aliStore.replaceAll(sessions)
    }
    const memory = activeAliMemory()
    if (memory) {
      const currentMemory = await aliMemory.getState()
      if (!sameMemory(memory, currentMemory)) {
        await aliMemory.replaceState(memory)
      }
    }
  } finally {
    applying = false
  }
}

async function syncLocalAli(): Promise<void> {
  if (applying) return
  const sessions = aliStore.list()
  for (const [position, session] of sessions.entries()) {
    store.upsertSyncEntity('ali_session', session.id, { position, session })
  }
  const activeIds = new Set(sessions.map((session) => session.id))
  for (const entity of store.listSyncBindings('ali_session')) {
    if (!activeIds.has(entity.entityId)) {
      store.deleteSyncEntity('ali_session', entity.entityId)
    }
  }
  store.upsertSyncEntity('ali_memory', 'default', await aliMemory.getState())
}

export function watchAliSync(onChanged: () => void): () => void {
  if (watching) return () => undefined
  watching = true
  const unsubscribeStore = aliStore.onChanged(() => {
    void syncLocalAli().finally(onChanged)
  })
  const unsubscribeMemory = aliMemory.onChanged(() => {
    void syncLocalAli().finally(onChanged)
  })
  return () => {
    watching = false
    unsubscribeStore()
    unsubscribeMemory()
  }
}
