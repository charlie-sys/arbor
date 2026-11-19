import { randomUUID } from 'node:crypto'

const baseUrl = process.env.ARBOR_SYNC_URL ?? 'http://127.0.0.1:4319'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, body, accessToken) {
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

async function login(email, device, intent = 'cloud-first') {
  return request('/v1/auth/dev-login', {
    email,
    displayName: 'Device Enrollment Test',
    intent,
    device
  })
}

const email = `device-approval-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`
const primaryDevice = {
  id: randomUUID(),
  name: 'Primary Device',
  platform: 'windows',
  appVersion: 'test'
}
const cloudDevice = {
  id: randomUUID(),
  name: 'Cloud First Device',
  platform: 'windows',
  appVersion: 'test'
}
const uploadDevice = {
  id: randomUUID(),
  name: 'Local Upload Device',
  platform: 'windows',
  appVersion: 'test'
}

const first = await login(email, primaryDevice)
check(first.response.ok && first.payload.isPrimary === true, 'first device is not primary')

const second = await login(email, cloudDevice)
check(second.response.ok, 'cloud-first device should sign in without approval')
check(second.payload.isPrimary === false, 'cloud-first device must not become primary')

const upload = await login(email, uploadDevice, 'merge-local')
check(
  upload.response.status === 202 &&
    upload.payload.approvalRequired === true &&
    upload.payload.requestId,
  'local upload did not create an approval request'
)

const pendingClaim = await request(
  `/v1/auth/device-requests/${upload.payload.requestId}/claim`,
  { requestToken: upload.payload.requestToken }
)
check(pendingClaim.response.status === 202, 'pending request should not issue tokens')

const primaryAgain = await login(email, primaryDevice)
check(
  primaryAgain.response.ok && primaryAgain.payload.isPrimary === true,
  'primary device could not sign back in'
)
const primaryToken = primaryAgain.payload.accessToken

const requestsResponse = await fetch(`${baseUrl}/v1/device-requests`, {
  headers: { authorization: `Bearer ${primaryToken}` }
})
const requests = await requestsResponse.json()
check(
  requestsResponse.ok &&
    requests.requests?.some((item) => item.id === upload.payload.requestId),
  'primary device did not see the upload request'
)

const approve = await request(
  `/v1/device-requests/${upload.payload.requestId}/approve`,
  {},
  primaryToken
)
check(approve.response.ok, 'primary device failed to approve upload')

const claimed = await request(
  `/v1/auth/device-requests/${upload.payload.requestId}/claim`,
  { requestToken: upload.payload.requestToken }
)
check(claimed.response.ok && claimed.payload.accessToken, 'approved device could not claim session')
check(claimed.payload.isPrimary === false, 'approved upload device became primary automatically')

const unauthorizedTransfer = await request(
  `/v1/devices/${primaryDevice.id}/primary`,
  {},
  claimed.payload.accessToken
)
check(
  unauthorizedTransfer.response.status === 403,
  'non-primary device should not transfer primary status'
)

const primaryReturn = await login(email, primaryDevice)
check(primaryReturn.response.ok && primaryReturn.payload.isPrimary === true, 'primary login failed')
const transfer = await request(
  `/v1/devices/${cloudDevice.id}/primary`,
  {},
  primaryReturn.payload.accessToken
)
check(transfer.response.ok, 'primary device could not transfer primary status')

const devicesResponse = await fetch(`${baseUrl}/v1/devices`, {
  headers: { authorization: `Bearer ${primaryReturn.payload.accessToken}` }
})
const devices = await devicesResponse.json()
const transferred = devices.devices?.find((device) => device.id === cloudDevice.id)
check(devicesResponse.ok && transferred?.primary === true, 'primary status was not transferred')

console.log(
  JSON.stringify(
    {
      ok: true,
      primaryAutoPromotedOnCloudLogin: second.payload.isPrimary,
      uploadApprovalStatus: upload.response.status,
      approvedDevicePrimary: claimed.payload.isPrimary,
      nonPrimaryTransferStatus: unauthorizedTransfer.response.status,
      transferredPrimaryDevice: transferred.id
    },
    null,
    2
  )
)
