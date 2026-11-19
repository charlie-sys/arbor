import { randomUUID } from 'node:crypto'

const baseUrl = process.env.ARBOR_SYNC_URL ?? 'http://127.0.0.1:4319'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, body, accessToken, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

async function login(email, device) {
  return request('/v1/auth/dev-login', {
    email,
    displayName: 'Snapshot Restore Test',
    intent: 'cloud-first',
    device
  })
}

async function commit(token, entityId, payload, baseVersion) {
  return request(
    '/v1/sync/commit',
    {
      operations: [
        {
          opId: randomUUID(),
          entityType: 'snapshot_smoke',
          entityId,
          baseVersion,
          operation: 'put',
          payload
        }
      ]
    },
    token
  )
}

async function snapshot(token) {
  const response = await fetch(`${baseUrl}/v1/sync/snapshot?limit=500`, {
    headers: { authorization: `Bearer ${token}` }
  })
  return response.json()
}

const email = `snapshot-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`
const primaryDevice = {
  id: randomUUID(),
  name: 'Snapshot Primary',
  platform: 'windows',
  appVersion: 'test'
}
const otherDevice = {
  id: randomUUID(),
  name: 'Snapshot Other',
  platform: 'windows',
  appVersion: 'test'
}

const first = await login(email, primaryDevice)
check(first.response.ok && first.payload.isPrimary, 'primary login failed')
const token = first.payload.accessToken
const entityId = randomUUID()
const v1 = { title: 'Version one' }
const v2 = { title: 'Version two' }

const created = await commit(token, entityId, v1, 0)
check(created.response.ok && created.payload.conflicts.length === 0, 'initial commit failed')
const overwritten = await commit(token, entityId, v2, 0)
check(
  overwritten.response.ok &&
    overwritten.payload.conflicts.length === 0 &&
    overwritten.payload.accepted.length === 1,
  'stale last-write-wins commit was not accepted'
)

const afterCommit = await snapshot(token)
const current = afterCommit.entities.find(
  (entity) => entity.entityId === entityId
)
check(current?.payload?.title === v2.title, 'latest cloud payload is wrong')
check(current?.version === 2, 'last-write-wins did not increment version')

const list = await request('/v1/snapshots', undefined, token, 'GET')
check(
  list.response.ok && list.payload.retentionDays >= 7 && list.payload.snapshots.length >= 2,
  'snapshot list is incomplete'
)
const beforeSecondCommit = list.payload.snapshots[0]
const detail = await request(
  `/v1/snapshots/${beforeSecondCommit.id}/changes`,
  undefined,
  token,
  'GET'
)
check(
  detail.response.ok &&
    detail.payload.totalChanges >= 1 &&
    detail.payload.changes.some(
      (item) =>
        item.entityType === 'snapshot_smoke' &&
        item.entityId === entityId &&
        item.change === 'updated'
    ),
  `snapshot detail did not report the changed entity: ${detail.response.status} ${JSON.stringify(detail.payload)}`
)

const other = await login(email, otherDevice)
check(other.response.ok && other.payload.isPrimary === false, 'other device login failed')
const forbidden = await request('/v1/snapshots', undefined, other.payload.accessToken, 'GET')
check(forbidden.response.status === 403, 'non-primary device could list snapshots')

const primaryReturn = await login(email, primaryDevice)
const primaryToken = primaryReturn.payload.accessToken
const restore = await request(
  `/v1/snapshots/${beforeSecondCommit.id}/restore`,
  {},
  primaryToken
)
check(restore.response.ok, 'snapshot restore failed')

const restored = await snapshot(primaryToken)
const restoredEntity = restored.entities.find(
  (entity) => entity.entityId === entityId
)
check(restoredEntity?.payload?.title === v1.title, 'snapshot payload was not restored')
check(restoredEntity?.version === 3, 'restored entity did not receive a new version')
const restoredList = await request('/v1/snapshots', undefined, primaryToken, 'GET')
check(
  restoredList.payload.snapshots.some((item) => item.reason === 'pre_restore'),
  'restore did not preserve current data as a pre-restore snapshot'
)

console.log(
  JSON.stringify(
    {
      ok: true,
      latestVersionBeforeRestore: current.version,
      restoredVersion: restoredEntity.version,
      snapshots: restoredList.payload.snapshots.length,
      retentionDays: restoredList.payload.retentionDays,
      nonPrimaryListStatus: forbidden.response.status,
      reportedChanges: detail.payload.totalChanges
    },
    null,
    2
  )
)
