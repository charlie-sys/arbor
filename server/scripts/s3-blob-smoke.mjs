import { createHash, randomUUID } from 'node:crypto'

const baseUrl = process.env.ARBOR_SYNC_URL ?? 'http://127.0.0.1:4319'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, init = {}, accessToken) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers
    }
  })
}

const health = await fetch(`${baseUrl}/healthz`)
check(health.ok, `sync server is not healthy: ${health.status}`)

const loginResponse = await request('/v1/auth/dev-login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: `s3-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
    displayName: 'S3 Blob Test',
    device: {
      id: randomUUID(),
      name: 'S3 Blob Test',
      platform: 'windows',
      appVersion: 'test'
    }
  })
})
const login = await loginResponse.json()
check(
  loginResponse.ok && login.accessToken,
  `login failed: ${JSON.stringify(login)}`
)

const source = Buffer.from(
  `%PDF-1.7\nArbor S3 blob smoke ${Date.now()}\n${'x'.repeat(8192)}\n%%EOF\n`
)
const sha256 = createHash('sha256').update(source).digest('hex')
const mimeType = 'application/pdf'
const prepareResponse = await request(
  '/v1/blobs/prepare',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha256, size: source.length, mimeType })
  },
  login.accessToken
)
const prepare = await prepareResponse.json()
check(
  prepareResponse.ok && !prepare.exists && prepare.uploadId,
  `prepare failed: ${JSON.stringify(prepare)}`
)

const form = new FormData()
form.append('file', new Blob([source], { type: mimeType }), 's3-smoke.pdf')
const uploadResponse = await request(
  `/v1/blobs/upload/${prepare.uploadId}`,
  { method: 'PUT', body: form },
  login.accessToken
)
const upload = await uploadResponse.json()
check(
  uploadResponse.status === 201 && upload.sha256 === sha256,
  `upload failed: ${uploadResponse.status} ${JSON.stringify(upload)}`
)

const downloadResponse = await request(
  `/v1/blobs/${sha256}`,
  {},
  login.accessToken
)
const downloaded = Buffer.from(await downloadResponse.arrayBuffer())
check(downloadResponse.ok, `download failed: ${downloadResponse.status}`)
check(
  downloadResponse.headers.get('content-type')?.startsWith(mimeType),
  'downloaded content type does not match'
)
check(
  createHash('sha256').update(downloaded).digest('hex') === sha256,
  'downloaded SHA-256 does not match'
)

const repeatedResponse = await request(
  '/v1/blobs/prepare',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha256, size: source.length, mimeType })
  },
  login.accessToken
)
const repeated = await repeatedResponse.json()
check(
  repeatedResponse.ok && repeated.exists === true,
  'content-addressed blob was not deduplicated'
)

console.log(
  JSON.stringify(
    {
      ok: true,
      sha256,
      size: downloaded.length,
      mimeType,
      deduplicated: repeated.exists
    },
    null,
    2
  )
)
