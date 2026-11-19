import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LocalSyncStore } from '../../src/main/localSync.ts'
import type { LibraryData } from '../../src/shared/types.ts'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arbor-blob-binding-'))
const local = new LocalSyncStore()
try {
  await local.init(root)
  const bindingId = 'files/smoke.pdf'
  const binding = {
    path: bindingId,
    sha256: 'a'.repeat(64),
    size: 123,
    mtimeMs: 456,
    mimeType: 'application/pdf'
  }
  local.upsertLocalEntity('blob_binding', bindingId, binding)
  local.acknowledgeOperations(local.pendingOperations().map((operation) => operation.opId))
  local.upsertLocalEntity('blob_binding', bindingId, {
    ...binding,
    mtimeMs: 789
  })
  const metadataOnlyOperation = local.pendingOperations()[0]
  local.recordConflicts([metadataOnlyOperation], [
    {
      opId: metadataOnlyOperation.opId,
      serverVersion: 4,
      serverPayload: binding
    }
  ])
  check(
    local.conflictCount() === 0,
    'mtime-only blob binding difference was reported as a conflict'
  )
  check(
    local.pendingOperations().length === 0,
    'equivalent blob binding operation was not acknowledged'
  )

  const library = {
    version: 1,
    documents: [],
    collections: [],
    chats: [],
    translations: [],
    highlights: [],
    excerpts: [],
    inbox: [],
    tasks: [],
    researchTopics: [],
    canvases: [],
    tags: [],
    properties: [],
    savedViews: [],
    settings: { ali: {} }
  } as unknown as LibraryData

  local.persistLibrary(library)
  const active = local.listLocalEntities('blob_binding')
  check(active.length === 1, 'persisting library data deleted the blob binding')
  check(active[0].entityId === bindingId, 'wrong blob binding was retained')
  check(
    local.pendingOperations().every(
      (operation) => operation.entityId !== bindingId || operation.operation !== 'delete'
    ),
    'persisting library data queued a blob binding deletion'
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        blobBindings: active.length,
        queuedOperations: local.pendingOperations().length,
        equivalentConflicts: local.conflictCount()
      },
      null,
      2
    )
  )
} finally {
  local.close()
  await fs.rm(root, { recursive: true, force: true })
}
