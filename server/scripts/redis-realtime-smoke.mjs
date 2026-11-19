import { randomUUID } from 'node:crypto'

const baseA = process.env.ARBOR_A_URL ?? 'http://127.0.0.1:4318'
const baseB = process.env.ARBOR_B_URL ?? 'http://127.0.0.1:4319'
const timeoutMs = Number(process.env.ARBOR_TEST_TIMEOUT_MS ?? 10_000)

function fail(message) {
  throw new Error(message)
}

async function request(base, path, body, accessToken) {
  const response = await fetch(`${base}${path}`, {
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

async function login(base, email, device) {
  const { response, payload } = await request(base, '/v1/auth/dev-login', {
    email,
    displayName: 'Redis Realtime Test',
    device
  })
  if (!response.ok) {
    fail(`login ${base} failed: ${response.status} ${JSON.stringify(payload)}`)
  }
  return payload
}

function openSocket(base, accessToken) {
  return request(base, '/v1/session/socket-ticket', {}, accessToken).then(
    ({ response, payload }) => {
      if (!response.ok) {
        fail(`socket ticket failed: ${response.status} ${JSON.stringify(payload)}`)
      }
      const url = new URL('/v1/session/socket', base)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('ticket', payload.ticket)
      const socket = new WebSocket(url)
      const ready = waitForMessage(socket, (message) => message.type === 'ready')
      return { socket, ready }
    }
  )
}

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out waiting for WebSocket message after ${timeoutMs}ms`))
    }, timeoutMs)
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data))
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const onClose = (event) => {
      cleanup()
      reject(
        new Error(
          `WebSocket closed before expected message: ${event.code} ${event.reason}`
        )
      )
    }
    const onError = () => {
      cleanup()
      reject(new Error('WebSocket failed before expected message'))
    }
    function cleanup() {
      clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
      socket.removeEventListener('error', onError)
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', onClose)
    socket.addEventListener('error', onError)
  })
}

function waitForClose(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for WebSocket close after ${timeoutMs}ms`))
    }, timeoutMs)
    socket.addEventListener(
      'close',
      (event) => {
        clearTimeout(timer)
        resolve(event)
      },
      { once: true }
    )
  })
}

const email = `redis-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`
const deviceA = {
  id: randomUUID(),
  name: 'Redis Test A',
  platform: 'windows',
  appVersion: 'test'
}
const deviceB = {
  id: randomUUID(),
  name: 'Redis Test B',
  platform: 'windows',
  appVersion: 'test'
}

const loginA = await login(baseA, email, deviceA)
const { socket: socketA, ready: readyPromiseA } = await openSocket(
  baseA,
  loginA.accessToken
)
const readyA = await readyPromiseA
if (readyA.sessionEpoch !== loginA.session.epoch) {
  fail('instance A returned an unexpected session epoch')
}

// Register both listeners before the replacement login so the event cannot race.
const revokedEvent = waitForMessage(
  socketA,
  (message) => message.type === 'session.revoked'
)
const closedEvent = waitForClose(socketA)
const loginB = await login(baseB, email, deviceB)

const revoked = await revokedEvent
if (revoked.reason !== 'replaced' || revoked.activeDeviceId !== deviceB.id) {
  fail(`unexpected revoked event: ${JSON.stringify(revoked)}`)
}
const closed = await closedEvent
if (closed.code !== 4001) {
  fail(`expected WebSocket close code 4001, received ${closed.code}`)
}

const oldRefresh = await request(baseA, '/v1/auth/refresh', {
  refreshToken: loginA.refreshToken,
  deviceId: deviceA.id
})
if (oldRefresh.response.status !== 401 || oldRefresh.payload.code !== 'SESSION_REPLACED') {
  fail(
    `old refresh token was not rejected: ${oldRefresh.response.status} ` +
      JSON.stringify(oldRefresh.payload)
  )
}

const oldAccount = await fetch(`${baseA}/v1/account`, {
  headers: { authorization: `Bearer ${loginA.accessToken}` }
})
const oldAccountPayload = await oldAccount.json().catch(() => ({}))
if (
  ![401, 409].includes(oldAccount.status) ||
  oldAccountPayload.code !== 'SESSION_REPLACED'
) {
  fail(
    `old access token was not rejected as replaced: ${oldAccount.status} ` +
      JSON.stringify(oldAccountPayload)
  )
}

const { socket: socketB, ready: readyPromiseB } = await openSocket(
  baseB,
  loginB.accessToken
)
const readyB = await readyPromiseB
if (readyB.sessionEpoch !== loginB.session.epoch) {
  fail('new active device could not establish a WebSocket')
}
socketB.close()

// Commit through instance B while an active-device socket is connected to A.
const { socket: syncSocket, ready: syncReadyPromise } = await openSocket(
  baseA,
  loginB.accessToken
)
await syncReadyPromise
const changedEvent = waitForMessage(
  syncSocket,
  (message) => message.type === 'sync.changed'
)
const entityId = `redis-smoke-${randomUUID()}`
const commit = await request(
  baseB,
  '/v1/sync/commit',
  {
    operations: [
      {
        opId: randomUUID(),
        entityType: 'smoke',
        entityId,
        baseVersion: 0,
        operation: 'put',
        payload: { source: 'redis-realtime-smoke' }
      }
    ]
  },
  loginB.accessToken
)
if (
  !commit.response.ok ||
  commit.payload.accepted?.length !== 1 ||
  commit.payload.latestSeq <= 0
) {
  fail(
    `cross-instance commit failed: ${commit.response.status} ` +
      JSON.stringify(commit.payload)
  )
}
const changed = await changedEvent
if (changed.seq !== commit.payload.latestSeq) {
  fail(
    `unexpected sync.changed sequence: ${JSON.stringify(changed)} ` +
      `expected ${commit.payload.latestSeq}`
  )
}
syncSocket.close()

console.log(
  JSON.stringify(
    {
      ok: true,
      redisEvent: revoked.type,
      closeCode: closed.code,
      oldRefreshStatus: oldRefresh.response.status,
      oldRefreshCode: oldRefresh.payload.code,
      activeDevice: loginB.device.id,
      newSessionEpoch: readyB.sessionEpoch,
      crossInstanceSyncSeq: changed.seq
    },
    null,
    2
  )
)
