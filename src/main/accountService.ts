import { app, BrowserWindow, safeStorage, shell } from 'electron'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type {
  AccountDevice,
  DeviceEnrollment,
  DeviceLoginIntent,
  AccountSession,
  AccountState,
  AccountUser,
  DevLoginInput
} from '../shared/account'
import type { SyncSnapshot, SyncSnapshotDetail } from '../shared/sync'

interface StoredAccount {
  version: 1
  serverUrl: string
  deviceId: string
  deviceName: string
  refreshTokenEnc?: string
  accountEmail?: string
  user?: AccountUser
  session?: AccountSession
  isPrimary?: boolean
  pendingRequestId?: string
  pendingRequestEnc?: string
  pendingPrimaryDeviceName?: string
  pendingIntent?: DeviceLoginIntent
  pendingExpiresAt?: string
}

interface LoginResponse {
  accessToken: string
  refreshToken: string
  accessExpiresIn: number
  user: AccountUser
  device: {
    id: string
    name: string
    platform?: string
    appVersion?: string
  }
  session: AccountSession
  isPrimary: boolean
}

interface PendingApprovalResponse {
  approvalRequired: true
  requestId: string
  requestToken: string
  expiresAt: string
  primaryDeviceName: string
  intent: DeviceLoginIntent
  user: AccountUser
  device: {
    id: string
    name: string
    platform: string
    appVersion: string
  }
}

const DEFAULT_SERVER_URL = process.env.ARBOR_SYNC_URL ?? 'http://127.0.0.1:4318'
const RETRY_BASE_MS = 3000
const SESSION_HEARTBEAT_MS = 5000

class AccountService {
  private stateValue: AccountState = {
    status: 'signedOut',
    serverUrl: DEFAULT_SERVER_URL,
    user: null,
    device: null,
    session: null,
    isPrimary: false,
    pendingApproval: null
  }
  private file = ''
  private stored: StoredAccount | null = null
  private refreshToken = ''
  private accessToken = ''
  private accessExpiresAt = 0
  private refreshPromise: Promise<void> | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private heartbeatRunning = false
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private manualSocketClose = false
  private pendingRequestId = ''
  private pendingRequestToken = ''
  private pendingPollTimer: NodeJS.Timeout | null = null
  private initialized = false
  private stateListeners = new Set<(state: AccountState) => void>()
  private socketListeners = new Set<(event: unknown) => void>()

  async init(userDataDir: string): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    this.file = path.join(userDataDir, 'account.json')
    await this.loadStored()
    if (this.pendingRequestToken && this.pendingRequestId) {
      this.startPendingPoll()
      return
    }
    if (this.refreshToken) {
      this.stateValue.status = 'offline'
      void this.refresh()
        .then(() => this.connectSocket())
        .catch((error: Error) => {
          if (this.stateValue.status !== 'revoked') {
            this.update({ status: 'offline', lastError: error.message })
          }
        })
    }
  }

  state(): AccountState {
    return structuredClone(this.stateValue)
  }

  onStateChange(listener: (state: AccountState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onSocketEvent(listener: (event: unknown) => void): () => void {
    this.socketListeners.add(listener)
    return () => this.socketListeners.delete(listener)
  }

  async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    return this.authorized(pathname, init)
  }

  async signInDev(input: DevLoginInput): Promise<AccountState> {
    const serverUrl = normalizeServerUrl(input.serverUrl)
    const email = input.email.trim()
    if (!email) throw new Error('请输入邮箱')
    this.update({ status: 'signingIn', serverUrl, lastError: undefined })
    try {
      let deviceId =
        this.stored?.accountEmail?.toLowerCase() === email.toLowerCase()
          ? this.stored.deviceId
          : crypto.randomUUID()
      const login = (id: string): Promise<Response> =>
        fetch(`${serverUrl}/v1/auth/dev-login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            displayName: input.displayName?.trim() || undefined,
            intent: input.intent ?? 'cloud-first',
            device: {
              id,
              name: this.stored?.deviceName ?? defaultDeviceName(),
              platform: process.platform,
              appVersion: app.getVersion()
            }
          })
        })
      let response = await login(deviceId)
      if (response.status === 409) {
        const conflict = (await response.clone().json().catch(() => ({}))) as {
          code?: string
        }
        if (conflict.code === 'DEVICE_CONFLICT') {
          deviceId = crypto.randomUUID()
          if (this.stored) {
            this.stored.deviceId = deviceId
            this.stored.accountEmail = email
            await this.persist()
          }
          response = await login(deviceId)
        }
      }
      await this.handleLoginResponse(response, serverUrl)
      return this.state()
    } catch (error) {
      this.update({
        status: this.stateValue.user ? 'offline' : 'signedOut',
        lastError: (error as Error).message
      })
      throw error
    }
  }

  async signInOidc(
    serverUrlInput: string,
    intent: DeviceLoginIntent = 'cloud-first'
  ): Promise<AccountState> {
    const serverUrl = normalizeServerUrl(serverUrlInput)
    this.update({ status: 'signingIn', serverUrl, lastError: undefined })
    const verifier = crypto.randomBytes(48).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const state = crypto.randomBytes(24).toString('base64url')
    let callbackServer: http.Server | null = null
    try {
      const callback = await createLoopbackCallback()
      callbackServer = callback.server
      const start = await fetch(`${serverUrl}/v1/auth/oidc/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirectUri: callback.redirectUri,
          state,
          codeChallenge: challenge
        })
      })
      const started = await parseResponse<{ authorizeUrl: string }>(start)
      await shell.openExternal(started.authorizeUrl)
      const result = await callback.wait()
      if (result.error) throw new Error(result.error)
      if (!result.code || result.state !== state) throw new Error('OIDC 登录状态校验失败')

      let deviceId = this.stored?.deviceId ?? crypto.randomUUID()
      const exchangeRequest = (id: string): Promise<Response> =>
        fetch(`${serverUrl}/v1/auth/oidc/exchange`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: result.code,
            codeVerifier: verifier,
            intent,
            device: {
              id,
              name: this.stored?.deviceName ?? defaultDeviceName(),
              platform: process.platform,
              appVersion: app.getVersion()
            }
          })
        })
      let exchangeResponse = await exchangeRequest(deviceId)
      if (exchangeResponse.status === 409) {
        const conflict = (await exchangeResponse
          .clone()
          .json()
          .catch(() => ({}))) as {
          code?: string
        }
        if (conflict.code === 'DEVICE_CONFLICT') {
          deviceId = crypto.randomUUID()
          if (this.stored) {
            this.stored.deviceId = deviceId
            await this.persist()
          }
          exchangeResponse = await exchangeRequest(deviceId)
        }
      }
      await this.handleLoginResponse(exchangeResponse, serverUrl)
      return this.state()
    } catch (error) {
      this.update({
        status: this.stateValue.user ? 'offline' : 'signedOut',
        lastError: (error as Error).message
      })
      throw error
    } finally {
      callbackServer?.close()
    }
  }

  async logout(): Promise<AccountState> {
    this.clearPendingRequest()
    this.manualSocketClose = true
    this.socket?.close(1000, 'Logout')
    this.socket = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const serverUrl = this.stateValue.serverUrl
    const accessToken = this.accessToken
    this.accessToken = ''
    this.accessExpiresAt = 0
    this.refreshToken = ''
    const state = this.update({
      status: 'signedOut',
      user: null,
      device: null,
      session: null,
      isPrimary: false,
      pendingApproval: null,
      lastError: undefined
    })
    void fetch(`${serverUrl}/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
      },
      body: '{}'
    }).catch(() => undefined)
    if (this.stored) {
      this.stored.refreshTokenEnc = undefined
      this.stored.user = undefined
      this.stored.session = undefined
      await this.persist()
    }
    return state
  }

  async devices(): Promise<AccountDevice[]> {
    const response = await this.authorized('/v1/devices')
    const data = await parseResponse<{ devices: AccountDevice[] }>(response)
    return data.devices
  }

  async revokeDevice(id: string): Promise<AccountDevice[]> {
    const response = await this.authorized(`/v1/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
    await parseResponse<{ ok: boolean }>(response)
    return this.devices()
  }

  async deviceRequests(): Promise<DeviceEnrollment[]> {
    const response = await this.authorized('/v1/device-requests')
    const data = await parseResponse<{ requests: DeviceEnrollment[] }>(response)
    return data.requests
  }

  async approveDeviceRequest(id: string): Promise<DeviceEnrollment[]> {
    const response = await this.authorized(
      `/v1/device-requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST' }
    )
    await parseResponse<{ ok: boolean }>(response)
    return this.deviceRequests()
  }

  async rejectDeviceRequest(id: string): Promise<DeviceEnrollment[]> {
    const response = await this.authorized(
      `/v1/device-requests/${encodeURIComponent(id)}/reject`,
      { method: 'POST' }
    )
    await parseResponse<{ ok: boolean }>(response)
    return this.deviceRequests()
  }

  async transferPrimary(id: string): Promise<AccountDevice[]> {
    const response = await this.authorized(
      `/v1/devices/${encodeURIComponent(id)}/primary`,
      { method: 'POST' }
    )
    await parseResponse<{ ok: boolean }>(response)
    if (this.stored) {
      this.stored.isPrimary = false
      await this.persist()
    }
    this.update({
      isPrimary: false,
      device: this.stateValue.device
        ? { ...this.stateValue.device, primary: false }
        : null
    })
    return this.devices()
  }

  async snapshots(): Promise<{
    retentionDays: number
    snapshots: SyncSnapshot[]
  }> {
    const response = await this.authorized('/v1/snapshots')
    return parseResponse<{
      retentionDays: number
      snapshots: SyncSnapshot[]
    }>(response)
  }

  async restoreSnapshot(id: string): Promise<{ ok: boolean; latestSeq: number }> {
    const response = await this.authorized(
      `/v1/snapshots/${encodeURIComponent(id)}/restore`,
      { method: 'POST' }
    )
    return parseResponse<{ ok: boolean; latestSeq: number }>(response)
  }

  async snapshotChanges(id: string): Promise<SyncSnapshotDetail> {
    const response = await this.authorized(
      `/v1/snapshots/${encodeURIComponent(id)}/changes`
    )
    return parseResponse<SyncSnapshotDetail>(response)
  }

  private async loadStored(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<StoredAccount>
      const deviceId =
        typeof parsed.deviceId === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.deviceId)
          ? parsed.deviceId
          : crypto.randomUUID()
      this.stored = {
        version: 1,
        serverUrl: normalizeServerUrl(parsed.serverUrl ?? DEFAULT_SERVER_URL),
        deviceId,
        deviceName:
          typeof parsed.deviceName === 'string' && parsed.deviceName.trim()
            ? parsed.deviceName.trim()
            : defaultDeviceName(),
        accountEmail:
          typeof parsed.accountEmail === 'string'
            ? parsed.accountEmail
            : parsed.user?.email,
        user: parsed.user,
        session: parsed.session,
        pendingRequestId:
          typeof parsed.pendingRequestId === 'string'
            ? parsed.pendingRequestId
            : undefined,
        pendingPrimaryDeviceName:
          typeof parsed.pendingPrimaryDeviceName === 'string'
            ? parsed.pendingPrimaryDeviceName
            : undefined,
        pendingIntent:
          parsed.pendingIntent === 'merge-local' ? 'merge-local' : 'cloud-first',
        pendingExpiresAt:
          typeof parsed.pendingExpiresAt === 'string'
            ? parsed.pendingExpiresAt
            : undefined
      }
      if (
        parsed.refreshTokenEnc &&
        safeStorage.isEncryptionAvailable()
      ) {
        try {
          this.refreshToken = safeStorage.decryptString(
            Buffer.from(parsed.refreshTokenEnc, 'base64')
          )
        } catch {
          this.refreshToken = ''
        }
      }
      if (
        parsed.pendingRequestEnc &&
        safeStorage.isEncryptionAvailable()
      ) {
        try {
          this.pendingRequestToken = safeStorage.decryptString(
            Buffer.from(parsed.pendingRequestEnc, 'base64')
          )
          this.pendingRequestId = this.stored.pendingRequestId ?? ''
        } catch {
          this.pendingRequestToken = ''
          this.pendingRequestId = ''
        }
      }
      this.stateValue = {
        status: this.pendingRequestToken
          ? 'pendingApproval'
          : this.refreshToken
            ? 'offline'
            : 'signedOut',
        serverUrl: this.stored.serverUrl,
        user: parsed.user ?? null,
        device: {
          id: this.stored.deviceId,
          name: this.stored.deviceName,
          platform: process.platform,
          active: Boolean(this.refreshToken),
          current: true
        },
        session: parsed.session ?? null,
        isPrimary: Boolean(parsed.isPrimary),
        pendingApproval:
          this.pendingRequestToken && this.stored.pendingRequestId
            ? {
                requestId: this.stored.pendingRequestId,
                primaryDeviceName:
                  this.stored.pendingPrimaryDeviceName ?? '主设备',
                intent: this.stored.pendingIntent ?? 'cloud-first',
                expiresAt: this.stored.pendingExpiresAt ?? ''
              }
            : null
      }
    } catch {
      this.stored = {
        version: 1,
        serverUrl: normalizeServerUrl(DEFAULT_SERVER_URL),
        deviceId: crypto.randomUUID(),
        deviceName: defaultDeviceName()
      }
      await this.persist()
      this.stateValue.serverUrl = this.stored.serverUrl
    }
  }

  private async persist(): Promise<void> {
    if (!this.stored) return
    const data: StoredAccount = {
      ...this.stored,
      refreshTokenEnc:
        this.refreshToken && safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(this.refreshToken).toString('base64')
          : undefined,
      pendingRequestId: this.pendingRequestId || undefined,
      pendingRequestEnc:
        this.pendingRequestToken && safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(this.pendingRequestToken).toString('base64')
          : undefined
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
    await fs.rename(temp, this.file)
    this.stored = data
  }

  private async applyLogin(data: LoginResponse, serverUrl: string): Promise<void> {
    this.clearPendingRequest()
    this.accessToken = data.accessToken
    this.accessExpiresAt = Date.now() + data.accessExpiresIn * 1000
    this.refreshToken = data.refreshToken
    this.stored = {
      version: 1,
      serverUrl,
      deviceId: data.device.id,
      deviceName: this.stored?.deviceName ?? data.device.name,
      accountEmail: data.user.email,
      user: data.user,
      session: data.session,
      isPrimary: data.isPrimary
    }
    await this.persist()
    this.update({
      status: 'active',
      serverUrl,
      user: data.user,
      device: {
        id: data.device.id,
        name: data.device.name,
        platform: data.device.platform ?? process.platform,
        appVersion: data.device.appVersion,
        active: true,
        current: true,
        sessionEpoch: data.session.epoch,
        primary: data.isPrimary
      },
      session: data.session,
      isPrimary: data.isPrimary,
      pendingApproval: null,
      lastError: undefined
    })
  }

  private async handleLoginResponse(
    response: Response,
    serverUrl: string
  ): Promise<void> {
    const payload = (await response.json()) as
      | LoginResponse
      | PendingApprovalResponse
      | { code?: string; message?: string }
    if (!response.ok) {
      throw Object.assign(
        new Error(
          'message' in payload && payload.message
            ? payload.message
            : `请求失败 (${response.status})`
        ),
        { code: 'code' in payload ? payload.code : undefined }
      )
    }
    if (
      response.status === 202 &&
      'approvalRequired' in payload &&
      payload.approvalRequired
    ) {
      this.pendingRequestId = payload.requestId
      this.pendingRequestToken = payload.requestToken
      this.stored = {
        version: 1,
        serverUrl,
        deviceId: payload.device.id,
        deviceName: payload.device.name,
        accountEmail: payload.user.email,
        user: payload.user,
        pendingRequestId: payload.requestId,
        pendingPrimaryDeviceName: payload.primaryDeviceName,
        pendingIntent: payload.intent,
        pendingExpiresAt: payload.expiresAt
      }
      await this.persist()
      this.update({
        status: 'pendingApproval',
        serverUrl,
        user: payload.user,
        device: {
          id: payload.device.id,
          name: payload.device.name,
          platform: payload.device.platform,
          appVersion: payload.device.appVersion,
          active: false,
          current: true,
          primary: false
        },
        session: null,
        pendingApproval: {
          requestId: payload.requestId,
          primaryDeviceName: payload.primaryDeviceName,
          intent: payload.intent,
          expiresAt: payload.expiresAt
        },
        lastError: undefined
      })
      this.startPendingPoll()
      return
    }
    await this.applyLogin(payload as LoginResponse, serverUrl)
    this.connectSocket()
  }

  private startPendingPoll(): void {
    if (
      !this.pendingRequestId ||
      !this.pendingRequestToken ||
      this.pendingPollTimer
    ) {
      return
    }
    const poll = async (): Promise<void> => {
      this.pendingPollTimer = null
      if (!this.pendingRequestId || !this.pendingRequestToken) return
      try {
        const response = await fetch(
          `${this.stateValue.serverUrl}/v1/auth/device-requests/${encodeURIComponent(this.pendingRequestId)}/claim`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ requestToken: this.pendingRequestToken })
          }
        )
        if (response.status === 202) {
          const data = (await response.json()) as {
            primaryDeviceName?: string
            expiresAt?: string
          }
          this.update({
            status: 'pendingApproval',
            pendingApproval: this.stateValue.pendingApproval
              ? {
                  ...this.stateValue.pendingApproval,
                  primaryDeviceName:
                    data.primaryDeviceName ??
                    this.stateValue.pendingApproval.primaryDeviceName,
                  expiresAt:
                    data.expiresAt ?? this.stateValue.pendingApproval.expiresAt
                }
              : null,
            lastError: undefined
          })
        } else {
          const data = (await response.json()) as
            | LoginResponse
            | { message?: string; code?: string }
          if (!response.ok) {
            this.clearPendingRequest()
            await this.persist().catch(() => undefined)
            this.update({
              status: 'signedOut',
              user: null,
              device: null,
              session: null,
              pendingApproval: null,
              lastError:
                ('message' in data && data.message) || '主设备未批准登录'
            })
            return
          }
          await this.applyLogin(data as LoginResponse, this.stateValue.serverUrl)
          this.connectSocket()
          return
        }
      } catch (error) {
        this.update({
          status: 'pendingApproval',
          lastError: (error as Error).message
        })
      }
      this.pendingPollTimer = setTimeout(() => void poll(), 2500)
      this.pendingPollTimer.unref?.()
    }
    void poll()
  }

  private clearPendingRequest(): void {
    if (this.pendingPollTimer) clearTimeout(this.pendingPollTimer)
    this.pendingPollTimer = null
    this.pendingRequestId = ''
    this.pendingRequestToken = ''
    if (this.stored) {
      this.stored.pendingRequestId = undefined
      this.stored.pendingRequestEnc = undefined
      this.stored.pendingPrimaryDeviceName = undefined
      this.stored.pendingIntent = undefined
      this.stored.pendingExpiresAt = undefined
    }
  }

  private syncSessionHeartbeat(): void {
    const shouldRun = Boolean(
      this.stateValue.user &&
        this.refreshToken &&
        (this.stateValue.status === 'active' ||
          this.stateValue.status === 'offline')
    )
    if (!shouldRun) {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
      return
    }
    if (this.heartbeatTimer) return
    void this.runSessionHeartbeat()
    this.heartbeatTimer = setInterval(
      () => void this.runSessionHeartbeat(),
      SESSION_HEARTBEAT_MS
    )
    this.heartbeatTimer.unref?.()
  }

  async checkSessionNow(): Promise<void> {
    await this.runSessionHeartbeat()
  }

  private async runSessionHeartbeat(): Promise<void> {
    if (this.heartbeatRunning) return
    if (
      !this.stateValue.user ||
      !this.refreshToken ||
      (this.stateValue.status !== 'active' &&
        this.stateValue.status !== 'offline')
    ) {
      return
    }
    this.heartbeatRunning = true
    try {
      await this.authorized('/v1/session/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
    } catch {
      // A transient network error must not revoke a still-valid local session.
    } finally {
      this.heartbeatRunning = false
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    if (!this.stored || !this.refreshToken) throw new Error('登录已失效')
    const refreshToken = this.refreshToken
    const serverUrl = this.stateValue.serverUrl
    this.refreshPromise = (async () => {
      const response = await fetch(`${serverUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refreshToken,
          deviceId: this.stored?.deviceId
        })
      })
      if (!response.ok) {
        const error = await apiError(response)
        if (response.status === 401 || response.status === 409) {
          await this.handleSessionRevoked(error.message)
        }
        throw error
      }
      const data = (await response.json()) as LoginResponse
      await this.applyLogin(data, serverUrl)
    })().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && this.accessExpiresAt > Date.now() + 20_000) return
    await this.refresh()
  }

  private async authorized(pathname: string, init: RequestInit = {}): Promise<Response> {
    await this.ensureAccessToken()
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${this.accessToken}`)
    const response = await fetch(`${this.stateValue.serverUrl}${pathname}`, {
      ...init,
      headers
    })
    if (response.ok) return response
    const error = await apiError(response)
    const code = (error as Error & { code?: string }).code
    if (response.status === 401 || code === 'SESSION_REPLACED') {
      await this.handleSessionRevoked(error.message)
    }
    throw error
  }

  private async connectSocket(): Promise<void> {
    if (this.stateValue.status !== 'active') return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.manualSocketClose = true
    this.socket?.close(1000, 'Reconnect')
    this.socket = null
    this.manualSocketClose = false
    try {
      const ticketResponse = await this.authorized('/v1/session/socket-ticket', {
        method: 'POST'
      })
      const { ticket } = await parseResponse<{ ticket: string }>(ticketResponse)
      const wsBase = this.stateValue.serverUrl.replace(/^http/i, 'ws')
      const socket = new WebSocket(
        `${wsBase}/v1/session/socket?ticket=${encodeURIComponent(ticket)}`
      )
      this.socket = socket
      socket.onopen = () => {
        this.reconnectAttempt = 0
      }
      socket.onmessage = (event) => {
        if (socket !== this.socket) return
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; reason?: string }
          for (const listener of this.socketListeners) listener(message)
          if (message.type === 'session.revoked') {
            void this.handleSessionRevoked('账号已在另一台设备登录')
          }
        } catch {
          /* Ignore malformed server events. */
        }
      }
      socket.onclose = (event) => {
        if (socket !== this.socket || this.manualSocketClose) return
        this.socket = null
        if (event.code === 4001 || event.code === 4003) {
          void this.handleSessionRevoked('账号已在另一台设备登录')
          return
        }
        if (this.stateValue.status === 'active') {
          this.update({ status: 'offline', lastError: '实时连接已断开' })
          this.scheduleReconnect()
        }
      }
    } catch (error) {
      if (this.stateValue.status === 'active') {
        this.update({ status: 'offline', lastError: (error as Error).message })
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stateValue.status === 'revoked') return
    const delay = Math.min(30_000, RETRY_BASE_MS * 2 ** this.reconnectAttempt)
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.refresh()
        .then(() => this.connectSocket())
        .catch(() => this.scheduleReconnect())
    }, delay)
    this.reconnectTimer.unref?.()
  }

  private async handleSessionRevoked(message: string): Promise<void> {
    this.manualSocketClose = true
    this.socket?.close(4001, 'Session replaced')
    this.socket = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.accessToken = ''
    this.accessExpiresAt = 0
    this.refreshToken = ''
    const revokedState = this.update({
      status: 'revoked',
      session: this.stateValue.session
        ? { ...this.stateValue.session, status: 'revoked' }
        : null,
      lastError: message
    })
    if (this.stored) {
      this.stored.refreshTokenEnc = undefined
      await this.persist().catch(() => undefined)
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('account:session-replaced', revokedState)
      }
    }
  }

  private update(patch: Partial<AccountState>): AccountState {
    this.stateValue = { ...this.stateValue, ...patch }
    const snapshot = this.state()
    this.syncSessionHeartbeat()
    for (const listener of this.stateListeners) listener(snapshot)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('account:changed', snapshot)
      }
    }
    return snapshot
  }
}

function defaultDeviceName(): string {
  return `${os.hostname()} · Arbor`
}

async function createLoopbackCallback(): Promise<{
  server: http.Server
  redirectUri: string
  wait(): Promise<{ code?: string; state?: string; error?: string }>
}> {
  let resolveResult:
    | ((value: { code?: string; state?: string; error?: string }) => void)
    | null = null
  const result = new Promise<{ code?: string; state?: string; error?: string }>((resolve) => {
    resolveResult = resolve
  })
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      response.writeHead(404).end('Not found')
      return
    }
    const payload = {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      error:
        url.searchParams.get('error_description') ??
        url.searchParams.get('error') ??
        undefined
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><meta charset="utf-8"><title>Arbor</title>' +
        '<body style="font-family:Segoe UI,sans-serif;padding:40px">' +
        '<h2>登录已完成</h2><p>可以返回 Arbor。</p></body>'
    )
    resolveResult?.(payload)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('无法启动本机 OIDC 回调服务')
  }
  const timeout = setTimeout(() => {
    resolveResult?.({ error: 'OIDC 登录超时' })
  }, 5 * 60 * 1000)
  timeout.unref?.()
  return {
    server,
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    wait: () => result.finally(() => clearTimeout(timeout))
  }
}

function normalizeServerUrl(value: string): string {
  let url: URL
  try {
    url = new URL(String(value).trim())
  } catch {
    throw new Error('同步服务器地址无效')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('同步服务器必须使用 HTTPS')
  }
  if (
    url.protocol === 'http:' &&
    !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  ) {
    throw new Error('非本机同步服务器必须使用 HTTPS')
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function apiError(response: Response): Promise<Error & { code?: string }> {
  let code: string | undefined
  let message = `请求失败 (${response.status})`
  try {
    const data = (await response.json()) as { code?: string; message?: string }
    code = data.code
    if (data.message) message = data.message
  } catch {
    /* Keep the HTTP fallback message. */
  }
  return Object.assign(new Error(message), { code })
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await apiError(response)
  return (await response.json()) as T
}

export const accountService = new AccountService()
