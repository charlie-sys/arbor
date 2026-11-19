import { randomUUID } from 'node:crypto'

const baseUrl = process.env.ARBOR_SYNC_URL ?? 'http://127.0.0.1:4318'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function post(path, body, accessToken) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

const login = await post('/v1/auth/dev-login', {
  email: `large-batch-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
  displayName: 'Large Batch Test',
  device: {
    id: randomUUID(),
    name: 'Large Batch Test',
    platform: 'windows',
    appVersion: 'test'
  }
})
check(login.response.ok && login.payload.accessToken, 'login failed')

const operations = Array.from({ length: 24 }, (_, index) => ({
  opId: randomUUID(),
  entityType: 'large_sync_batch',
  entityId: `entity-${index}`,
  baseVersion: 0,
  operation: 'put',
  payload: {
    index,
    text: `${index}:`.padEnd(70_000, 'x')
  }
}))
const bodyBytes = Buffer.byteLength(JSON.stringify({ operations }))
check(bodyBytes > 1024 * 1024, 'test payload is not larger than 1 MB')

const commit = await post(
  '/v1/sync/commit',
  { operations },
  login.payload.accessToken
)
check(
  commit.response.ok && commit.payload.accepted?.length === operations.length,
  `large commit failed: ${commit.response.status} ${JSON.stringify(commit.payload)}`
)

console.log(
  JSON.stringify(
    {
      ok: true,
      operations: operations.length,
      bytes: bodyBytes,
      accepted: commit.payload.accepted.length
    },
    null,
    2
  )
)
