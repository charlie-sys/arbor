import { randomUUID } from 'node:crypto'

const base = process.env.ARBOR_SYNC_URL ?? 'http://127.0.0.1:4318'
const email = `heartbeat-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`

async function post(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  })
  return {
    response,
    payload: await response.json().catch(() => ({}))
  }
}

async function login(deviceName) {
  const { response, payload } = await post('/v1/auth/dev-login', {
    email,
    intent: 'cloud-first',
    device: {
      id: randomUUID(),
      name: deviceName,
      platform: 'web',
      appVersion: 'smoke'
    }
  })
  if (!response.ok) {
    throw new Error(`login failed: ${response.status} ${JSON.stringify(payload)}`)
  }
  return payload
}

const first = await login('Heartbeat A')
const active = await post('/v1/session/heartbeat', {}, first.accessToken)
if (!active.response.ok || active.payload.ok !== true) {
  throw new Error(
    `active heartbeat failed: ${active.response.status} ${JSON.stringify(active.payload)}`
  )
}

await login('Heartbeat B')
const replaced = await post('/v1/session/heartbeat', {}, first.accessToken)
if (
  replaced.response.status !== 409 ||
  replaced.payload.code !== 'SESSION_REPLACED'
) {
  throw new Error(
    `replaced heartbeat was not rejected: ${replaced.response.status} ` +
      JSON.stringify(replaced.payload)
  )
}

console.log(
  JSON.stringify(
    {
      ok: true,
      activeHeartbeatStatus: active.response.status,
      replacedHeartbeatStatus: replaced.response.status,
      replacedHeartbeatCode: replaced.payload.code
    },
    null,
    2
  )
)
