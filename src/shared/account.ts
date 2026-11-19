export type AccountStatus =
  | 'signedOut'
  | 'signingIn'
  | 'pendingApproval'
  | 'active'
  | 'offline'
  | 'revoked'

export type DeviceLoginIntent = 'cloud-first' | 'merge-local'

export interface AccountUser {
  id: string
  email: string
  displayName: string
}

export interface AccountDevice {
  id: string
  name: string
  platform: string
  appVersion?: string
  lastSeenAt?: string | null
  revokedAt?: string | null
  active: boolean
  current?: boolean
  primary?: boolean
  sessionEpoch?: number | null
}

export interface AccountSession {
  id: string
  epoch: number
  status: 'active' | 'draining' | 'revoked'
  initialSyncMode?: DeviceLoginIntent
}

export interface PendingDeviceApproval {
  requestId: string
  primaryDeviceName: string
  intent: DeviceLoginIntent
  expiresAt: string
}

export interface DeviceEnrollment {
  id: string
  deviceId: string
  deviceName: string
  platform: string
  appVersion?: string
  intent: DeviceLoginIntent
  status: 'pending' | 'approved'
  expiresAt: string
  createdAt: string
}

export interface AccountState {
  status: AccountStatus
  serverUrl: string
  user: AccountUser | null
  device: AccountDevice | null
  session: AccountSession | null
  isPrimary?: boolean
  pendingApproval?: PendingDeviceApproval | null
  lastError?: string
}

export interface DevLoginInput {
  serverUrl: string
  email: string
  displayName?: string
  intent?: DeviceLoginIntent
}

export function hasAccountAccess(state: AccountState | null | undefined): boolean {
  return Boolean(
    state?.user &&
      (state.status === 'active' || state.status === 'offline')
  )
}
