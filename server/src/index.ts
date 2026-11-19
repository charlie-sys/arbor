import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import compress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import cors from '@fastify/cors'
import pg from 'pg'
import crypto from 'crypto'
import path from 'path'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { createWriteStream } from 'fs'
import { promises as fs } from 'fs'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { isDeepStrictEqual } from 'util'
import { createBlobStorage } from './blobStorage.js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createClient } from 'redis'

const { Pool } = pg

const PORT = Number(process.env.PORT ?? 4318)
const HOST = process.env.HOST ?? '127.0.0.1'
const DEV_MODE = process.env.AUTH_DEV_MODE === 'true'
const JWT_SECRET =
  process.env.JWT_SECRET ??
  (DEV_MODE ? 'arbor-local-development-secret-change-before-deploying' : '')
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://arbor:arbor@127.0.0.1:55432/arbor_sync'
const ACCESS_TTL_SECONDS = 15 * 60
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TICKET_TTL_MS = 30 * 1000
const MAX_BLOB_SIZE = 250 * 1024 * 1024
const BLOB_USER_QUOTA = Number(process.env.BLOB_USER_QUOTA ?? 5 * 1024 * 1024 * 1024)
const BLOB_GC_GRACE_MS =
  Number(process.env.BLOB_GC_GRACE_HOURS ?? 24) * 60 * 60 * 1000
const MAX_WEB_PAGE_BYTES = 5 * 1024 * 1024
const SNAPSHOT_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.SNAPSHOT_RETENTION_DAYS ?? 7)
)
const UPLOAD_TEMP_DIR = path.resolve(process.env.UPLOAD_TEMP_DIR ?? 'data/uploads')
const blobStorage = createBlobStorage()
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''
const OIDC_ISSUER = process.env.OIDC_ISSUER ?? ''
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? ''
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? ''
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI ?? ''
const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? '').replace(/\/+$/, '')
const OIDC_ENABLED = Boolean(
  OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET && OIDC_REDIRECT_URI
)
const REDIS_URL = process.env.REDIS_URL ?? ''
const EVENT_CHANNEL = 'arbor:sync-events'

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters')
}
if (DEV_MODE && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  throw new Error('AUTH_DEV_MODE may only be enabled on a loopback interface')
}

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

interface AccessTokenPayload {
  sub: string
  deviceId: string
  sessionId: string
  sessionEpoch: number
  iat: number
  exp: number
}

interface SessionContext {
  userId: string
  email: string
  displayName: string
  deviceId: string
  deviceName: string
  sessionId: string
  sessionEpoch: number
  sessionStatus: 'active' | 'draining'
  isPrimary: boolean
}

interface LoginBody {
  email?: unknown
  displayName?: unknown
  intent?: unknown
  device?: {
    id?: unknown
    name?: unknown
    platform?: unknown
    appVersion?: unknown
  }
}

type InitialSyncMode = 'cloud-first' | 'merge-local'

interface LoginResult {
  accessToken: string
  refreshToken: string
  accessExpiresIn: number
  user: { id: string; email: string; displayName: string }
  device: { id: string; name: string; platform: string; appVersion: string }
  session: {
    id: string
    epoch: number
    status: 'active'
    initialSyncMode: InitialSyncMode
  }
  isPrimary: boolean
}

interface SnapshotEntity {
  entityType?: unknown
  entityId?: unknown
  version?: unknown
  payload?: unknown
}

interface OidcDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000
})
const app = Fastify({
  logger: true,
  bodyLimit: 8 * 1024 * 1024
})
const sockets = new Map<string, Set<any>>()
let oidcDiscoveryCache: OidcDiscovery | null = null
let redisPublisher: ReturnType<typeof createClient> | null = null
let redisSubscriber: ReturnType<typeof createClient> | null = null
await app.register(websocket)
await app.register(compress, {
  global: true,
  threshold: 1024,
  encodings: ['br', 'gzip', 'deflate']
})
if (WEB_ORIGIN) {
  await app.register(cors, {
    origin: WEB_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    exposedHeaders: ['content-length', 'content-type'],
    maxAge: 3600
  })
}
await app.register(multipart, {
  limits: {
    files: 1,
    fileSize: MAX_BLOB_SIZE,
    fields: 4
  }
})
const WEB_DIST_DIR = path.resolve(
  process.env.WEB_DIST_DIR ?? path.join(process.cwd(), '..', 'web', 'dist')
)
const WEB_DIST_AVAILABLE = await fs
  .access(path.join(WEB_DIST_DIR, 'index.html'))
  .then(() => true)
  .catch(() => false)
if (WEB_DIST_AVAILABLE) {
  await app.register(fastifyStatic, {
    root: WEB_DIST_DIR,
    prefix: '/'
  })
  app.get('/', (_request, reply) => reply.sendFile('index.html'))
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

async function oidcDiscovery(): Promise<OidcDiscovery> {
  if (oidcDiscoveryCache) return oidcDiscoveryCache
  if (!OIDC_ENABLED) throw new ApiError(404, 'NOT_FOUND', 'OIDC 登录未配置')
  const issuer = OIDC_ISSUER.replace(/\/$/, '')
  const response = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!response.ok) throw new ApiError(502, 'OIDC_DISCOVERY_FAILED', 'OIDC Discovery 请求失败')
  const discovery = (await response.json()) as OidcDiscovery
  if (
    discovery.issuer !== issuer ||
    !discovery.authorization_endpoint ||
    !discovery.token_endpoint ||
    !discovery.jwks_uri
  ) {
    throw new ApiError(502, 'OIDC_DISCOVERY_INVALID', 'OIDC Discovery 返回内容无效')
  }
  oidcDiscoveryCache = discovery
  return discovery
}

function isLoopbackCallback(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    )
  } catch {
    return false
  }
}

function isAllowedOidcAppRedirect(value: string): boolean {
  if (isLoopbackCallback(value)) return true
  if (!WEB_ORIGIN) return false
  try {
    const url = new URL(value)
    const allowed = new URL(WEB_ORIGIN)
    return (
      url.origin === allowed.origin &&
      ['/', '/oidc/callback'].includes(url.pathname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function pkceChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function signToken(payload: AccessTokenPayload): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

function verifyAccessToken(token: string): AccessTokenPayload {
  const [header, body, signature] = token.split('.')
  if (!header || !body || !signature) {
    throw new ApiError(401, 'INVALID_TOKEN', '登录凭据无效')
  }
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest()
  const received = Buffer.from(signature, 'base64url')
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new ApiError(401, 'INVALID_TOKEN', '登录凭据无效')
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessTokenPayload
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.deviceId !== 'string' ||
    typeof payload.sessionId !== 'string' ||
    !Number.isInteger(payload.sessionEpoch) ||
    typeof payload.exp !== 'number' ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new ApiError(401, 'INVALID_TOKEN', '登录凭据已失效')
  }
  return payload
}

function accessToken(context: {
  userId: string
  deviceId: string
  sessionId: string
  sessionEpoch: number
}): string {
  const now = Math.floor(Date.now() / 1000)
  return signToken({
    sub: context.userId,
    deviceId: context.deviceId,
    sessionId: context.sessionId,
    sessionEpoch: context.sessionEpoch,
    iat: now,
    exp: now + ACCESS_TTL_SECONDS
  })
}

async function authenticate(request: FastifyRequest): Promise<SessionContext> {
  const authorization = request.headers.authorization ?? ''
  if (!authorization.startsWith('Bearer ')) {
    throw new ApiError(401, 'UNAUTHORIZED', '请先登录')
  }
  const token = verifyAccessToken(authorization.slice(7))
  const result = await pool.query<{
    user_id: string
    email: string
    display_name: string
    device_id: string
    device_name: string
    device_revoked_at: Date | null
    device_is_primary: boolean
    session_id: string
    session_status: 'active' | 'draining' | 'revoked'
    session_epoch: number
    user_epoch: number
  }>(
    `SELECT
       u.id AS user_id, u.email, u.display_name, u.session_epoch AS user_epoch,
       d.id AS device_id, d.name AS device_name, d.revoked_at AS device_revoked_at,
       d.is_primary AS device_is_primary,
       s.id AS session_id, s.status AS session_status, s.epoch AS session_epoch
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN devices d ON d.id = s.device_id
     WHERE s.id = $1 AND s.device_id = $2 AND s.user_id = $3`,
    [token.sessionId, token.deviceId, token.sub]
  )
  const row = result.rows[0]
  const sessionEpoch = row ? Number(row.session_epoch) : 0
  const userEpoch = row ? Number(row.user_epoch) : 0
  if (
    !row ||
    row.device_revoked_at ||
    row.session_status === 'revoked' ||
    sessionEpoch !== token.sessionEpoch ||
    userEpoch !== token.sessionEpoch
  ) {
    throw new ApiError(409, 'SESSION_REPLACED', '账号已在另一台设备登录')
  }
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    deviceId: row.device_id,
    deviceName: row.device_name,
    sessionId: row.session_id,
    sessionEpoch,
    sessionStatus: row.session_status,
    isPrimary: row.device_is_primary
  }
}

function requiredString(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ApiError(400, 'INVALID_REQUEST', `${field} 无效`)
  }
  return value.trim()
}

function normalizeEmail(value: unknown): string {
  const email = requiredString(value, 'email', 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, 'INVALID_REQUEST', '邮箱格式无效')
  }
  return email
}

function parseDevice(body: LoginBody): {
  id: string
  name: string
  platform: string
  appVersion: string
} {
  return {
    id: requiredString(body.device?.id, 'device.id', 80),
    name: requiredString(body.device?.name, 'device.name', 120),
    platform: requiredString(body.device?.platform, 'device.platform', 40),
    appVersion:
      typeof body.device?.appVersion === 'string'
        ? body.device.appVersion.slice(0, 40)
        : ''
  }
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number)
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      parts[0] >= 224
    )
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
  }
  return true
}

async function assertPublicWebUrl(value: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiError(400, 'INVALID_URL', '网页地址无效')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ApiError(400, 'INVALID_URL', '只允许公开的 HTTP/HTTPS 网页地址')
  }
  const hostname = url.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new ApiError(400, 'PRIVATE_URL_BLOCKED', '不能导入本机或局域网地址')
  }
  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new ApiError(400, 'PRIVATE_URL_BLOCKED', '不能导入内网地址')
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => [])
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new ApiError(400, 'PRIVATE_URL_BLOCKED', '目标网页没有可用的公网地址')
  }
  return url
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number(decimal))
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
}

function readableWebPage(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = decodeHtmlEntities(titleMatch?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const text = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, 1_500_000)
  return { title, text }
}

function parseSnapshotEntity(raw: SnapshotEntity): {
  entityType: string
  entityId: string
  version: number
  payload: unknown
} {
  const entityType = requiredString(raw.entityType, 'entityType', 80)
  const entityId = requiredString(raw.entityId, 'entityId', 500)
  const version = Number(raw.version)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApiError(400, 'INVALID_REQUEST', '实体版本无效')
  }
  return { entityType, entityId, version, payload: raw.payload ?? null }
}

function pushLocalUserEvent(userId: string, event: unknown): void {
  const connections = sockets.get(userId)
  if (!connections) return
  const message = JSON.stringify(event)
  for (const socket of connections) {
    try {
      socket.send(message)
      if ((event as { type?: string }).type === 'session.revoked') {
        setTimeout(() => socket.close(4001, 'Session replaced'), 30)
      }
    } catch {
      connections.delete(socket)
    }
  }
}

function pushUserEvent(userId: string, event: unknown): void {
  if (redisPublisher?.isReady) {
    void redisPublisher
      .publish(EVENT_CHANNEL, JSON.stringify({ userId, event }))
      .catch(() => pushLocalUserEvent(userId, event))
    return
  }
  pushLocalUserEvent(userId, event)
}

async function initRedis(): Promise<void> {
  if (!REDIS_URL) return
  redisPublisher = createClient({ url: REDIS_URL })
  redisSubscriber = createClient({ url: REDIS_URL })
  redisPublisher.on('error', (error) =>
    app.log.warn({ err: error }, 'redis publisher error')
  )
  redisSubscriber.on('error', (error) =>
    app.log.warn({ err: error }, 'redis subscriber error')
  )
  await Promise.all([redisPublisher.connect(), redisSubscriber.connect()])
  await redisSubscriber.subscribe(EVENT_CHANNEL, (message) => {
    try {
      const payload = JSON.parse(message) as { userId?: string; event?: unknown }
      if (payload.userId) pushLocalUserEvent(payload.userId, payload.event)
    } catch {
      app.log.warn('discarded malformed redis event')
    }
  })
}

async function issueRefreshToken(
  queryable: pg.Pool | pg.PoolClient,
  userId: string,
  deviceId: string,
  sessionId: string
): Promise<string> {
  const token = randomToken()
  await queryable.query(
    `INSERT INTO refresh_tokens(id, user_id, device_id, session_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      crypto.randomUUID(),
      userId,
      deviceId,
      sessionId,
      sha256(token),
      new Date(Date.now() + REFRESH_TTL_MS)
    ]
  )
  return token
}

async function saveUserSnapshot(
  client: pg.PoolClient,
  userId: string,
  deviceId: string,
  reason: 'pre_commit' | 'pre_restore'
): Promise<string> {
  const result = await client.query<{ payload: unknown; entity_count: string }>(
    `SELECT
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'entityType', entity_type,
             'entityId', entity_id,
             'version', version,
             'payload', payload,
             'deleted', deleted
           )
           ORDER BY entity_type, entity_id
         ),
         '[]'::jsonb
       ) AS payload,
       count(*)::text AS entity_count
     FROM entities WHERE user_id = $1`,
    [userId]
  )
  const snapshotId = crypto.randomUUID()
  await client.query(
    `INSERT INTO sync_snapshots(
       id, user_id, created_by_device, reason, entity_count, payload
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      snapshotId,
      userId,
      deviceId,
      reason,
      Number(result.rows[0]?.entity_count ?? 0),
      JSON.stringify(result.rows[0]?.payload ?? [])
    ]
  )
  const cutoff = new Date(
    Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )
  await client.query(
    'DELETE FROM sync_snapshots WHERE user_id = $1 AND created_at < $2',
    [userId, cutoff]
  )
  return snapshotId
}

async function activateDeviceSession(
  client: pg.PoolClient,
  user: { id: string; email: string; displayName: string },
  device: { id: string; name: string; platform: string; appVersion: string },
  options: {
    makePrimary: boolean
    initialSyncMode: InitialSyncMode
  }
): Promise<LoginResult> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    user.id
  ])
  const current = await client.query<{ session_epoch: string }>(
    'SELECT session_epoch FROM users WHERE id = $1 FOR UPDATE',
    [user.id]
  )
  if (!current.rows[0]) throw new ApiError(404, 'USER_NOT_FOUND', '用户不存在')

  const existingDevice = await client.query<{ user_id: string }>(
    'SELECT user_id FROM devices WHERE id = $1',
    [device.id]
  )
  if (existingDevice.rows[0] && existingDevice.rows[0].user_id !== user.id) {
    throw new ApiError(409, 'DEVICE_CONFLICT', '该设备已经绑定到其他账号')
  }
  await client.query(
    `INSERT INTO devices(id, user_id, name, platform, app_version, last_seen_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, now(), NULL)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       platform = excluded.platform,
       app_version = excluded.app_version,
       last_seen_at = now(),
       revoked_at = NULL`,
    [device.id, user.id, device.name, device.platform, device.appVersion]
  )
  await client.query(
    `UPDATE sessions
     SET status = 'revoked', revoked_at = now(), revoke_reason = 'replaced'
     WHERE user_id = $1 AND status <> 'revoked'`,
    [user.id]
  )
  await client.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id]
  )
  const epoch = Number(current.rows[0].session_epoch) + 1
  await client.query('UPDATE users SET session_epoch = $2 WHERE id = $1', [
    user.id,
    epoch
  ])
  const sessionId = crypto.randomUUID()
  await client.query(
    `INSERT INTO sessions(
       id, user_id, device_id, epoch, status, heartbeat_at, initial_sync_mode
     ) VALUES ($1, $2, $3, $4, 'active', now(), $5)`,
    [sessionId, user.id, device.id, epoch, options.initialSyncMode]
  )
  if (options.makePrimary) {
    await client.query(
      'UPDATE devices SET is_primary = (id = $2), trusted_at = COALESCE(trusted_at, now()) WHERE user_id = $1',
      [user.id, device.id]
    )
  }
  const refreshToken = await issueRefreshToken(client, user.id, device.id, sessionId)
  return {
    accessToken: accessToken({
      userId: user.id,
      deviceId: device.id,
      sessionId,
      sessionEpoch: epoch
    }),
    refreshToken,
    accessExpiresIn: ACCESS_TTL_SECONDS,
    user,
    device,
    session: {
      id: sessionId,
      epoch,
      status: 'active',
      initialSyncMode: options.initialSyncMode
    },
    isPrimary: options.makePrimary
      ? true
      : Boolean(
          (
            await client.query<{ is_primary: boolean }>(
              'SELECT is_primary FROM devices WHERE id = $1',
              [device.id]
            )
          ).rows[0]?.is_primary
        )
  }
}

function loginIntent(value: unknown): InitialSyncMode {
  return value === 'merge-local' ? 'merge-local' : 'cloud-first'
}

async function beginDeviceLogin(
  client: pg.PoolClient,
  user: { id: string; email: string; displayName: string },
  device: { id: string; name: string; platform: string; appVersion: string },
  intent: InitialSyncMode
): Promise<
  | LoginResult
  | {
      approvalRequired: true
      requestId: string
      requestToken: string
      expiresAt: string
      primaryDeviceName: string
      intent: InitialSyncMode
      user: { id: string; email: string; displayName: string }
      device: { id: string; name: string; platform: string; appVersion: string }
    }
> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    user.id
  ])
  const existing = await client.query<{
    user_id: string
    trusted_at: Date | null
    is_primary: boolean
  }>(
    'SELECT user_id, trusted_at, is_primary FROM devices WHERE id = $1',
    [device.id]
  )
  if (existing.rows[0] && existing.rows[0].user_id !== user.id) {
    throw new ApiError(409, 'DEVICE_CONFLICT', '该设备已经绑定到其他账号')
  }
  const primary = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM devices
     WHERE user_id = $1 AND is_primary = true AND revoked_at IS NULL
     LIMIT 1`,
    [user.id]
  )
  const existingDevice = existing.rows[0]
  const requiresUploadApproval =
    Boolean(primary.rows[0]) &&
    intent === 'merge-local' &&
    !existingDevice?.is_primary
  if (!requiresUploadApproval) {
    const makePrimary =
      !primary.rows[0] || Boolean(existingDevice?.is_primary)
    await client.query(
      `INSERT INTO devices(
         id, user_id, name, platform, app_version, last_seen_at,
         revoked_at, is_primary, trusted_at
       ) VALUES ($1, $2, $3, $4, $5, now(), NULL, $6, now())
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         platform = excluded.platform,
         app_version = excluded.app_version,
         last_seen_at = now(),
         revoked_at = NULL,
         trusted_at = COALESCE(devices.trusted_at, now())`,
      [
        device.id,
        user.id,
        device.name,
        device.platform,
        device.appVersion,
        makePrimary
      ]
    )
    return activateDeviceSession(client, user, device, {
      makePrimary,
      initialSyncMode: intent
    })
  }

  await client.query(
    `INSERT INTO devices(
       id, user_id, name, platform, app_version, last_seen_at,
       revoked_at, is_primary, trusted_at
     ) VALUES ($1, $2, $3, $4, $5, now(), NULL, false, NULL)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       platform = excluded.platform,
       app_version = excluded.app_version,
       last_seen_at = now()`,
    [device.id, user.id, device.name, device.platform, device.appVersion]
  )
  await client.query(
    `UPDATE device_enrollments
     SET status = 'expired'
     WHERE user_id = $1 AND device_id = $2 AND status IN ('pending', 'approved')`,
    [user.id, device.id]
  )
  const requestId = crypto.randomUUID()
  const requestToken = randomToken()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await client.query(
    `INSERT INTO device_enrollments(
       id, user_id, device_id, device_name, platform, app_version,
       intent, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
    [
      requestId,
      user.id,
      device.id,
      device.name,
      device.platform,
      device.appVersion,
      intent,
      sha256(requestToken),
      expiresAt
    ]
  )
  return {
    approvalRequired: true,
    requestId,
    requestToken,
    expiresAt: expiresAt.toISOString(),
    primaryDeviceName: primary.rows[0].name,
    intent,
    user,
    device
  }
}

async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      session_epoch BIGINT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS devices (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_version TEXT NOT NULL DEFAULT '',
      last_seen_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      trusted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      epoch BIGINT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'draining', 'revoked')),
      initial_sync_mode TEXT NOT NULL DEFAULT 'cloud-first',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      heartbeat_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      revoke_reason TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_user
    ON sessions(user_id)
    WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS session_tickets (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ticket_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      version BIGINT NOT NULL,
      payload JSONB NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT false,
      updated_by_device UUID NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS changes (
      server_seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      op_id UUID NOT NULL,
      device_id UUID NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      base_version BIGINT NOT NULL,
      version BIGINT NOT NULL,
      operation TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, op_id)
    );

    CREATE INDEX IF NOT EXISTS changes_user_seq_idx
    ON changes(user_id, server_seq);

    CREATE TABLE IF NOT EXISTS blob_uploads (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sha256 TEXT NOT NULL,
      size BIGINT NOT NULL,
      mime_type TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blobs (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sha256 TEXT NOT NULL,
      size BIGINT NOT NULL,
      mime_type TEXT NOT NULL,
      object_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, sha256)
    );

    CREATE TABLE IF NOT EXISTS snapshot_uploads (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS snapshot_upload_entities (
      upload_id UUID NOT NULL REFERENCES snapshot_uploads(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      version BIGINT NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY(upload_id, entity_type, entity_id)
    );

    CREATE INDEX IF NOT EXISTS snapshot_uploads_user_idx
    ON snapshot_uploads(user_id, created_at);

    CREATE TABLE IF NOT EXISTS oidc_identities (
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(issuer, subject)
    );

    CREATE TABLE IF NOT EXISTS oidc_flows (
      id UUID PRIMARY KEY,
      state_hash TEXT NOT NULL UNIQUE,
      nonce TEXT NOT NULL,
      app_redirect TEXT NOT NULL,
      app_state TEXT NOT NULL,
      app_challenge TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oidc_auth_codes (
      code_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      app_challenge TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS device_enrollments (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_version TEXT NOT NULL DEFAULT '',
      intent TEXT NOT NULL CHECK (intent IN ('cloud-first', 'merge-local')),
      request_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'claimed', 'expired')),
      approved_by_device UUID REFERENCES devices(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      approved_at TIMESTAMPTZ,
      claimed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS device_enrollments_user_status_idx
    ON device_enrollments(user_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS sync_snapshots (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by_device UUID REFERENCES devices(id) ON DELETE SET NULL,
      reason TEXT NOT NULL CHECK (reason IN ('pre_commit', 'pre_restore')),
      entity_count INTEGER NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS sync_snapshots_user_created_idx
    ON sync_snapshots(user_id, created_at DESC);
  `)
  await pool.query(`
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS trusted_at TIMESTAMPTZ;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS initial_sync_mode TEXT NOT NULL DEFAULT 'cloud-first';

    UPDATE devices SET trusted_at = COALESCE(trusted_at, created_at)
    WHERE trusted_at IS NULL;

    WITH candidates AS (
      SELECT DISTINCT ON (d.user_id) d.user_id, d.id
      FROM devices d
      LEFT JOIN sessions s ON s.device_id = d.id
      WHERE d.revoked_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM devices p
          WHERE p.user_id = d.user_id AND p.is_primary = true
        )
      ORDER BY d.user_id,
               CASE WHEN s.status = 'active' THEN 0 ELSE 1 END,
               s.created_at DESC NULLS LAST,
               d.created_at DESC
    )
    UPDATE devices d SET is_primary = true
    FROM candidates c WHERE d.id = c.id;

    CREATE UNIQUE INDEX IF NOT EXISTS one_primary_device_per_user
    ON devices(user_id) WHERE is_primary = true;
  `)
  await blobStorage.init()
  await fs.mkdir(UPLOAD_TEMP_DIR, { recursive: true })
}

async function garbageCollectBlobs(): Promise<{
  removed: number
  expiredUploads: number
  staleSnapshots: number
}> {
  const references = await pool.query<{ user_id: string; sha256: string }>(
    `SELECT user_id, payload->>'sha256' AS sha256
     FROM entities
     WHERE entity_type = 'blob_binding'
       AND deleted = false
       AND payload->>'sha256' IS NOT NULL
     UNION
     SELECT s.user_id, item->'payload'->>'sha256' AS sha256
     FROM sync_snapshots s
     CROSS JOIN LATERAL jsonb_array_elements(s.payload) item
     WHERE item->>'entityType' = 'blob_binding'
       AND COALESCE((item->>'deleted')::boolean, false) = false
       AND item->'payload'->>'sha256' IS NOT NULL`
  )
  const referencedByUser = new Map<string, Set<string>>()
  for (const row of references.rows) {
    const set = referencedByUser.get(row.user_id) ?? new Set<string>()
    set.add(row.sha256)
    referencedByUser.set(row.user_id, set)
  }

  const blobs = await pool.query<{
    user_id: string
    sha256: string
    object_key: string
    created_at: Date
  }>('SELECT user_id, sha256, object_key, created_at FROM blobs')
  const cutoff = Date.now() - BLOB_GC_GRACE_MS
  let removed = 0
  for (const blob of blobs.rows) {
    const referencesForUser = referencedByUser.get(blob.user_id)
    if (
      !referencesForUser ||
      referencesForUser.has(blob.sha256) ||
      blob.created_at.getTime() > cutoff
    ) {
      continue
    }
    await blobStorage.remove(blob.object_key).catch(() => undefined)
    await pool.query(
      'DELETE FROM blobs WHERE user_id = $1 AND sha256 = $2',
      [blob.user_id, blob.sha256]
    )
    removed++
  }

  const expired = await pool.query(
    `WITH deleted AS (
       DELETE FROM blob_uploads WHERE expires_at < now() RETURNING id
     ) SELECT COUNT(*)::text AS count FROM deleted`
  )
  const stale = await pool.query(
    `WITH deleted AS (
       DELETE FROM snapshot_uploads
       WHERE created_at < now() - interval '24 hours'
       RETURNING id
     ) SELECT COUNT(*)::text AS count FROM deleted`
  )
  return {
    removed,
    expiredUploads: Number((expired.rows[0] as { count?: string } | undefined)?.count ?? 0),
    staleSnapshots: Number((stale.rows[0] as { count?: string } | undefined)?.count ?? 0)
  }
}

app.setErrorHandler((error, _request, reply: FastifyReply) => {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({ code: error.code, message: error.message })
  }
  const reportedStatus = (error as { statusCode?: unknown }).statusCode
  const statusCode =
    typeof reportedStatus === 'number' &&
    reportedStatus >= 400 &&
    reportedStatus < 500
      ? reportedStatus
      : 500
  if (statusCode === 413) {
    return reply.status(413).send({
      code: 'PAYLOAD_TOO_LARGE',
      message: '同步批次过大，请重试'
    })
  }
  app.log.error(error)
  return reply.status(statusCode).send({
    code: statusCode === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
    message: statusCode === 500 ? '服务器内部错误' : '请求无效'
  })
})

app.get('/healthz', async () => ({
  ok: true,
  devAuth: DEV_MODE,
  oidcEnabled: OIDC_ENABLED
}))

app.post('/v1/admin/blobs/gc', async (request) => {
  if (!ADMIN_TOKEN) throw new ApiError(404, 'NOT_FOUND', '接口不存在')
  if (request.headers['x-admin-token'] !== ADMIN_TOKEN) {
    throw new ApiError(403, 'FORBIDDEN', '管理员凭据无效')
  }
  return garbageCollectBlobs()
})

app.post('/v1/auth/oidc/start', async (request) => {
  if (!OIDC_ENABLED) throw new ApiError(404, 'NOT_FOUND', 'OIDC 登录未配置')
  const body = (request.body ?? {}) as {
    redirectUri?: unknown
    state?: unknown
    codeChallenge?: unknown
  }
  const appRedirect = requiredString(body.redirectUri, 'redirectUri', 1000)
  if (!isAllowedOidcAppRedirect(appRedirect)) {
    throw new ApiError(400, 'INVALID_REDIRECT', 'OIDC 登录回调地址未获授权')
  }
  const appState = requiredString(body.state, 'state', 256)
  const appChallenge = requiredString(body.codeChallenge, 'codeChallenge', 128)
  const discovery = await oidcDiscovery()
  const providerState = randomToken()
  const nonce = randomToken()
  await pool.query(
    `INSERT INTO oidc_flows(
       id, state_hash, nonce, app_redirect, app_state, app_challenge, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      sha256(providerState),
      nonce,
      appRedirect,
      appState,
      appChallenge,
      new Date(Date.now() + 10 * 60 * 1000)
    ]
  )
  const authorization = new URL(discovery.authorization_endpoint)
  authorization.searchParams.set('response_type', 'code')
  authorization.searchParams.set('client_id', OIDC_CLIENT_ID)
  authorization.searchParams.set('redirect_uri', OIDC_REDIRECT_URI)
  authorization.searchParams.set('scope', 'openid profile email')
  authorization.searchParams.set('state', providerState)
  authorization.searchParams.set('nonce', nonce)
  return { authorizeUrl: authorization.toString() }
})

app.get('/v1/auth/oidc/callback', async (request, reply) => {
  if (!OIDC_ENABLED) throw new ApiError(404, 'NOT_FOUND', 'OIDC 登录未配置')
  const query = request.query as {
    code?: string
    state?: string
    error?: string
    error_description?: string
  }
  const providerState = requiredString(query.state, 'state', 256)
  const flowResult = await pool.query<{
    nonce: string
    app_redirect: string
    app_state: string
    app_challenge: string
  }>(
    `DELETE FROM oidc_flows
     WHERE state_hash = $1 AND expires_at > now()
     RETURNING nonce, app_redirect, app_state, app_challenge`,
    [sha256(providerState)]
  )
  const flow = flowResult.rows[0]
  if (!flow) throw new ApiError(400, 'OIDC_STATE_INVALID', 'OIDC 登录状态无效或已过期')
  const redirect = new URL(flow.app_redirect)
  if (query.error) {
    redirect.searchParams.set('error', query.error)
    redirect.searchParams.set('error_description', query.error_description ?? 'OIDC 登录失败')
    redirect.searchParams.set('state', flow.app_state)
    return reply.redirect(redirect.toString())
  }
  const code = requiredString(query.code, 'code', 2048)
  const discovery = await oidcDiscovery()
  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: OIDC_REDIRECT_URI,
      client_id: OIDC_CLIENT_ID,
      client_secret: OIDC_CLIENT_SECRET
    })
  })
  if (!tokenResponse.ok) {
    throw new ApiError(502, 'OIDC_TOKEN_FAILED', 'OIDC Token 交换失败')
  }
  const tokenData = (await tokenResponse.json()) as { id_token?: string }
  if (!tokenData.id_token) throw new ApiError(502, 'OIDC_TOKEN_INVALID', 'OIDC 未返回 ID Token')
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri))
  const verified = await jwtVerify(tokenData.id_token, jwks, {
    issuer: discovery.issuer,
    audience: OIDC_CLIENT_ID
  })
  const claims = verified.payload as {
    sub?: string
    email?: string
    email_verified?: boolean
    name?: string
    preferred_username?: string
    nonce?: string
  }
  if (
    !claims.sub ||
    !claims.email ||
    claims.email_verified === false ||
    claims.nonce !== flow.nonce
  ) {
    throw new ApiError(403, 'OIDC_CLAIMS_INVALID', 'OIDC 身份信息无效')
  }
  const email = normalizeEmail(claims.email)
  const displayName = String(
    claims.name || claims.preferred_username || email.split('@')[0]
  ).slice(0, 120)

  const identityClient = await pool.connect()
  let userId = ''
  try {
    await identityClient.query('BEGIN')
    const identity = await identityClient.query<{ user_id: string }>(
      'SELECT user_id FROM oidc_identities WHERE issuer = $1 AND subject = $2',
      [discovery.issuer, claims.sub]
    )
    if (identity.rows[0]) {
      userId = identity.rows[0].user_id
      await identityClient.query(
        'UPDATE users SET display_name = $2 WHERE id = $1',
        [userId, displayName]
      )
    } else {
      const user = await identityClient.query<{ id: string }>(
        `INSERT INTO users(id, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name
         RETURNING id`,
        [crypto.randomUUID(), email, displayName]
      )
      userId = user.rows[0].id
      await identityClient.query(
        `INSERT INTO oidc_identities(issuer, subject, user_id, email)
         VALUES ($1, $2, $3, $4)`,
        [discovery.issuer, claims.sub, userId, email]
      )
    }
    await identityClient.query('COMMIT')
  } catch (error) {
    await identityClient.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    identityClient.release()
  }

  const authCode = randomToken()
  await pool.query(
    `INSERT INTO oidc_auth_codes(
       code_hash, user_id, email, display_name, app_challenge, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sha256(authCode),
      userId,
      email,
      displayName,
      flow.app_challenge,
      new Date(Date.now() + 2 * 60 * 1000)
    ]
  )
  redirect.searchParams.set('code', authCode)
  redirect.searchParams.set('state', flow.app_state)
  return reply.redirect(redirect.toString())
})

app.post('/v1/auth/oidc/exchange', async (request, reply) => {
  if (!OIDC_ENABLED) throw new ApiError(404, 'NOT_FOUND', 'OIDC 登录未配置')
  const body = (request.body ?? {}) as {
    code?: unknown
    codeVerifier?: unknown
    intent?: unknown
    device?: LoginBody['device']
  }
  const code = requiredString(body.code, 'code', 256)
  const verifier = requiredString(body.codeVerifier, 'codeVerifier', 256)
  const device = parseDevice({ device: body.device })
  if (!/^[0-9a-f-]{36}$/i.test(device.id)) {
    throw new ApiError(400, 'INVALID_REQUEST', '设备 ID 无效')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const codeResult = await client.query<{
      user_id: string
      email: string
      display_name: string
      app_challenge: string
      expires_at: Date
      used_at: Date | null
    }>(
      `SELECT user_id, email, display_name, app_challenge, expires_at, used_at
       FROM oidc_auth_codes WHERE code_hash = $1 FOR UPDATE`,
      [sha256(code)]
    )
    const authCode = codeResult.rows[0]
    if (
      !authCode ||
      authCode.used_at ||
      authCode.expires_at.getTime() <= Date.now() ||
      authCode.app_challenge !== pkceChallenge(verifier)
    ) {
      throw new ApiError(400, 'OIDC_CODE_INVALID', 'OIDC 授权码无效或已过期')
    }
    await client.query(
      'UPDATE oidc_auth_codes SET used_at = now() WHERE code_hash = $1',
      [sha256(code)]
    )
    const loginResult = await beginDeviceLogin(
      client,
      {
        id: authCode.user_id,
        email: authCode.email,
        displayName: authCode.display_name
      },
      device,
      loginIntent(body.intent)
    )
    await client.query('COMMIT')
    if ('approvalRequired' in loginResult) {
      return reply.status(202).send(loginResult)
    }
    pushUserEvent(authCode.user_id, {
      type: 'session.revoked',
      reason: 'replaced',
      activeDeviceId: device.id
    })
    return reply.send(loginResult)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.post('/v1/auth/dev-login', async (request, reply) => {
  if (!DEV_MODE) throw new ApiError(404, 'NOT_FOUND', '接口不存在')
  const body = (request.body ?? {}) as LoginBody
  const email = normalizeEmail(body.email)
  const displayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120)
      : email.split('@')[0]
  const device = parseDevice(body)
  const intent = loginIntent(body.intent)
  if (!/^[0-9a-f-]{36}$/i.test(device.id)) {
    throw new ApiError(400, 'INVALID_REQUEST', '设备 ID 无效')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const user = await client.query<{ id: string; session_epoch: number }>(
      `INSERT INTO users(id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name
       RETURNING id, session_epoch`,
      [crypto.randomUUID(), email, displayName]
    )
    const userId = user.rows[0].id
    const loginResult = await beginDeviceLogin(
      client,
      { id: userId, email, displayName },
      device,
      intent
    )
    await client.query('COMMIT')

    if ('approvalRequired' in loginResult) {
      return reply.status(202).send(loginResult)
    }
    pushUserEvent(userId, {
      type: 'session.revoked',
      reason: 'replaced',
      activeDeviceId: device.id
    })

    return reply.send(loginResult)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.post('/v1/auth/device-requests/:id/claim', async (request, reply) => {
  const params = request.params as { id: string }
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    throw new ApiError(400, 'INVALID_REQUEST', '设备登录请求无效')
  }
  const body = (request.body ?? {}) as { requestToken?: unknown }
  const requestToken = requiredString(body.requestToken, 'requestToken', 256)
  const client = await pool.connect()
  let userId = ''
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      user_id: string
      device_id: string
      device_name: string
      platform: string
      app_version: string
      intent: InitialSyncMode
      request_hash: string
      status: string
      expires_at: Date
      email: string
      display_name: string
      primary_device_name: string | null
    }>(
      `SELECT e.user_id, e.device_id, e.device_name, e.platform, e.app_version,
              e.intent, e.request_hash, e.status, e.expires_at,
              u.email, u.display_name,
              (
                SELECT name FROM devices
                WHERE user_id = e.user_id AND is_primary = true
                LIMIT 1
              ) AS primary_device_name
       FROM device_enrollments e
       JOIN users u ON u.id = e.user_id
       WHERE e.id = $1
       FOR UPDATE OF e`,
      [params.id]
    )
    const enrollment = result.rows[0]
    if (
      !enrollment ||
      enrollment.request_hash !== sha256(requestToken)
    ) {
      throw new ApiError(404, 'DEVICE_REQUEST_NOT_FOUND', '设备登录请求不存在')
    }
    if (enrollment.expires_at.getTime() <= Date.now()) {
      await client.query(
        "UPDATE device_enrollments SET status = 'expired' WHERE id = $1",
        [params.id]
      )
      throw new ApiError(410, 'DEVICE_REQUEST_EXPIRED', '设备登录请求已过期')
    }
    if (enrollment.status === 'pending') {
      await client.query('COMMIT')
      return reply.status(202).send({
        status: 'pending',
        primaryDeviceName: enrollment.primary_device_name,
        expiresAt: enrollment.expires_at.toISOString()
      })
    }
    if (enrollment.status !== 'approved') {
      throw new ApiError(
        enrollment.status === 'rejected' ? 403 : 409,
        'DEVICE_REQUEST_UNAVAILABLE',
        enrollment.status === 'rejected'
          ? '主设备拒绝了本次登录'
          : '设备登录请求已失效'
      )
    }

    userId = enrollment.user_id
    const device = {
      id: enrollment.device_id,
      name: enrollment.device_name,
      platform: enrollment.platform,
      appVersion: enrollment.app_version
    }
    await client.query(
      'UPDATE devices SET trusted_at = now(), revoked_at = NULL WHERE id = $1',
      [device.id]
    )
    const loginResult = await activateDeviceSession(
      client,
      {
        id: enrollment.user_id,
        email: enrollment.email,
        displayName: enrollment.display_name
      },
      device,
      { makePrimary: false, initialSyncMode: enrollment.intent }
    )
    await client.query(
      `UPDATE device_enrollments
       SET status = 'claimed', claimed_at = now()
       WHERE id = $1`,
      [params.id]
    )
    await client.query('COMMIT')
    pushUserEvent(userId, {
      type: 'session.revoked',
      reason: 'primary_transfer',
      activeDeviceId: device.id
    })
    return reply.send(loginResult)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.post('/v1/auth/refresh', async (request) => {
  const body = (request.body ?? {}) as { refreshToken?: unknown; deviceId?: unknown }
  const refreshToken = requiredString(body.refreshToken, 'refreshToken', 256)
  const deviceId = requiredString(body.deviceId, 'deviceId', 80)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      id: string
      user_id: string
      session_id: string
      session_epoch: number
      session_status: string
      user_epoch: number
      expires_at: Date
      revoked_at: Date | null
      email: string
      display_name: string
      device_name: string
      device_is_primary: boolean
      initial_sync_mode: InitialSyncMode
    }>(
      `SELECT rt.id, rt.user_id, rt.session_id, rt.expires_at, rt.revoked_at,
              s.epoch AS session_epoch, s.status AS session_status,
              s.initial_sync_mode,
              u.session_epoch AS user_epoch, u.email, u.display_name,
              d.name AS device_name, d.is_primary AS device_is_primary
       FROM refresh_tokens rt
       JOIN sessions s ON s.id = rt.session_id
       JOIN users u ON u.id = rt.user_id
       JOIN devices d ON d.id = rt.device_id
       WHERE rt.token_hash = $1 AND rt.device_id = $2
       FOR UPDATE`,
      [sha256(refreshToken), deviceId]
    )
    const row = result.rows[0]
    const sessionEpoch = row ? Number(row.session_epoch) : 0
    const userEpoch = row ? Number(row.user_epoch) : 0
    if (
      !row ||
      row.revoked_at ||
      row.expires_at.getTime() <= Date.now() ||
      row.session_status !== 'active' ||
      sessionEpoch !== userEpoch
    ) {
      throw new ApiError(401, 'SESSION_REPLACED', '登录已失效，请重新登录')
    }
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id])
    const nextRefreshToken = await issueRefreshToken(
      client,
      row.user_id,
      deviceId,
      row.session_id
    )
    await client.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [deviceId])
    await client.query('COMMIT')
    return {
      accessToken: accessToken({
        userId: row.user_id,
        deviceId,
        sessionId: row.session_id,
        sessionEpoch
      }),
      refreshToken: nextRefreshToken,
      accessExpiresIn: ACCESS_TTL_SECONDS,
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name
      },
      device: { id: deviceId, name: row.device_name },
      session: {
        id: row.session_id,
        epoch: sessionEpoch,
        status: 'active',
        initialSyncMode: row.initial_sync_mode
      },
      isPrimary: row.device_is_primary
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.get('/v1/account', async (request) => {
  return authenticate(request)
})

app.post('/v1/session/heartbeat', async (request) => {
  const account = await authenticate(request)
  await pool.query(
    'UPDATE sessions SET heartbeat_at = now() WHERE id = $1',
    [account.sessionId]
  )
  return {
    ok: true,
    sessionId: account.sessionId,
    sessionEpoch: account.sessionEpoch,
    deviceId: account.deviceId,
    serverTime: new Date().toISOString()
  }
})

app.get('/v1/devices', async (request) => {
  const account = await authenticate(request)
  const result = await pool.query<{
    id: string
    name: string
    platform: string
    app_version: string
    last_seen_at: Date | null
    revoked_at: Date | null
    session_status: string | null
    session_epoch: number | null
    is_primary: boolean
  }>(
    `SELECT d.id, d.name, d.platform, d.app_version, d.last_seen_at, d.revoked_at,
            latest.status AS session_status, latest.epoch AS session_epoch,
            d.is_primary
     FROM devices d
     LEFT JOIN LATERAL (
       SELECT status, epoch FROM sessions
       WHERE device_id = d.id
       ORDER BY created_at DESC
       LIMIT 1
     ) latest ON true
     WHERE d.user_id = $1
     ORDER BY d.last_seen_at DESC NULLS LAST, d.created_at DESC`,
    [account.userId]
  )
  return {
    devices: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      appVersion: row.app_version,
      lastSeenAt: row.last_seen_at?.toISOString() ?? null,
      revokedAt: row.revoked_at?.toISOString() ?? null,
      active: row.session_status === 'active',
      current: row.id === account.deviceId,
      primary: row.is_primary,
      sessionEpoch: row.session_epoch === null ? null : Number(row.session_epoch)
    }))
  }
})

app.get('/v1/device-requests', async (request) => {
  const account = await authenticate(request)
  if (!account.isPrimary) {
    throw new ApiError(403, 'PRIMARY_DEVICE_REQUIRED', '只有主设备可以审批登录')
  }
  await pool.query(
    `UPDATE device_enrollments SET status = 'expired'
     WHERE user_id = $1 AND status IN ('pending', 'approved') AND expires_at <= now()`,
    [account.userId]
  )
  const result = await pool.query<{
    id: string
    device_id: string
    device_name: string
    platform: string
    app_version: string
    intent: InitialSyncMode
    status: string
    expires_at: Date
    created_at: Date
  }>(
    `SELECT id, device_id, device_name, platform, app_version, intent,
            status, expires_at, created_at
     FROM device_enrollments
     WHERE user_id = $1 AND status IN ('pending', 'approved')
     ORDER BY created_at DESC`,
    [account.userId]
  )
  return {
    requests: result.rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      deviceName: row.device_name,
      platform: row.platform,
      appVersion: row.app_version,
      intent: row.intent,
      status: row.status,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString()
    }))
  }
})

app.post('/v1/device-requests/:id/approve', async (request) => {
  const account = await authenticate(request)
  if (!account.isPrimary) {
    throw new ApiError(403, 'PRIMARY_DEVICE_REQUIRED', '只有主设备可以审批登录')
  }
  const params = request.params as { id: string }
  const result = await pool.query(
    `UPDATE device_enrollments
     SET status = 'approved', approved_by_device = $3, approved_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'pending' AND expires_at > now()
     RETURNING id`,
    [params.id, account.userId, account.deviceId]
  )
  if (!result.rowCount) {
    throw new ApiError(409, 'DEVICE_REQUEST_UNAVAILABLE', '设备登录请求已失效')
  }
  pushUserEvent(account.userId, { type: 'device-request.approved', requestId: params.id })
  return { ok: true }
})

app.post('/v1/device-requests/:id/reject', async (request) => {
  const account = await authenticate(request)
  if (!account.isPrimary) {
    throw new ApiError(403, 'PRIMARY_DEVICE_REQUIRED', '只有主设备可以审批登录')
  }
  const params = request.params as { id: string }
  const result = await pool.query(
    `UPDATE device_enrollments
     SET status = 'rejected', approved_by_device = $3, approved_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'pending'
     RETURNING id`,
    [params.id, account.userId, account.deviceId]
  )
  if (!result.rowCount) {
    throw new ApiError(409, 'DEVICE_REQUEST_UNAVAILABLE', '设备登录请求已失效')
  }
  return { ok: true }
})

app.delete('/v1/devices/:id', async (request) => {
  const account = await authenticate(request)
  if (!account.isPrimary) {
    throw new ApiError(403, 'PRIMARY_DEVICE_REQUIRED', '只有主设备可以撤销设备')
  }
  const params = request.params as { id: string }
  if (params.id === account.deviceId) {
    throw new ApiError(400, 'CURRENT_DEVICE', '当前设备请使用退出登录')
  }
  await pool.query(
    `UPDATE sessions SET status = 'revoked', revoked_at = now(), revoke_reason = 'device_revoked'
     WHERE user_id = $1 AND device_id = $2 AND status <> 'revoked'`,
    [account.userId, params.id]
  )
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
    [account.userId, params.id]
  )
  await pool.query(
    `UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND id = $2`,
    [account.userId, params.id]
  )
  return { ok: true }
})

app.post('/v1/devices/:id/primary', async (request) => {
  const account = await authenticate(request)
  if (!account.isPrimary) {
    throw new ApiError(403, 'PRIMARY_DEVICE_REQUIRED', '只有主设备可以转移主设备身份')
  }
  const params = request.params as { id: string }
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    throw new ApiError(400, 'INVALID_REQUEST', '目标设备无效')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const target = await client.query<{ trusted_at: Date | null }>(
      `SELECT trusted_at FROM devices
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       FOR UPDATE`,
      [params.id, account.userId]
    )
    if (!target.rows[0]?.trusted_at) {
      throw new ApiError(409, 'DEVICE_NOT_TRUSTED', '目标设备尚未获得主设备信任')
    }
    await client.query(
      'UPDATE devices SET is_primary = false WHERE user_id = $1 AND is_primary = true',
      [account.userId]
    )
    await client.query(
      'UPDATE devices SET is_primary = true WHERE id = $1 AND user_id = $2',
      [params.id, account.userId]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
  return { ok: true }
})

app.post('/v1/auth/logout', async (request) => {
  const account = await authenticate(request)
  await pool.query(
    `UPDATE sessions SET status = 'revoked', revoked_at = now(), revoke_reason = 'logout'
     WHERE id = $1`,
    [account.sessionId]
  )
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE session_id = $1 AND revoked_at IS NULL`,
    [account.sessionId]
  )
  return { ok: true }
})

app.post('/v1/sync/bootstrap', async (request) => {
  const account = await authenticate(request)
  const body = (request.body ?? {}) as { entities?: SnapshotEntity[] }
  if (!Array.isArray(body.entities) || body.entities.length > 5000) {
    throw new ApiError(400, 'INVALID_REQUEST', '快照实体数量无效')
  }
  const entities = body.entities.map(parseSnapshotEntity)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      account.userId
    ])
    const count = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM entities WHERE user_id = $1',
      [account.userId]
    )
    if (Number(count.rows[0]?.count) > 0) {
      throw new ApiError(409, 'SNAPSHOT_EXISTS', '云端已有数据，请下载快照')
    }
    for (const entity of entities) {
      await client.query(
        `INSERT INTO entities(
           user_id, entity_type, entity_id, version, payload, deleted, updated_by_device, updated_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, false, $6, now())`,
        [
          account.userId,
          entity.entityType,
          entity.entityId,
          entity.version,
          JSON.stringify(entity.payload),
          account.deviceId
        ]
      )
    }
    await client.query('COMMIT')
    return {
      ok: true,
      latestSeq: 0,
      entityCount: entities.length
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.post('/v1/sync/bootstrap/begin', async (request) => {
  const account = await authenticate(request)
  const existing = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM entities WHERE user_id = $1',
    [account.userId]
  )
  if (Number(existing.rows[0]?.count) > 0) {
    throw new ApiError(409, 'SNAPSHOT_EXISTS', '云端已有数据，请下载快照')
  }
  await pool.query('DELETE FROM snapshot_uploads WHERE user_id = $1', [account.userId])
  const uploadId = crypto.randomUUID()
  await pool.query(
    'INSERT INTO snapshot_uploads(id, user_id, device_id) VALUES ($1, $2, $3)',
    [uploadId, account.userId, account.deviceId]
  )
  return { uploadId }
})

app.post('/v1/sync/bootstrap/chunk', async (request) => {
  const account = await authenticate(request)
  const body = (request.body ?? {}) as {
    uploadId?: unknown
    entities?: SnapshotEntity[]
  }
  const uploadId = requiredString(body.uploadId, 'uploadId', 80)
  if (!Array.isArray(body.entities) || body.entities.length > 500) {
    throw new ApiError(400, 'INVALID_REQUEST', '快照分块大小无效')
  }
  const owner = await pool.query(
    'SELECT 1 FROM snapshot_uploads WHERE id = $1 AND user_id = $2',
    [uploadId, account.userId]
  )
  if (!owner.rowCount) throw new ApiError(404, 'SNAPSHOT_UPLOAD_NOT_FOUND', '快照上传任务不存在')
  for (const raw of body.entities) {
    const entity = parseSnapshotEntity(raw)
    await pool.query(
      `INSERT INTO snapshot_upload_entities(upload_id, entity_type, entity_id, version, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT(upload_id, entity_type, entity_id) DO UPDATE SET
         version = excluded.version,
         payload = excluded.payload`,
      [
        uploadId,
        entity.entityType,
        entity.entityId,
        entity.version,
        JSON.stringify(entity.payload)
      ]
    )
  }
  return { ok: true, accepted: body.entities.length }
})

app.post('/v1/sync/bootstrap/complete', async (request) => {
  const account = await authenticate(request)
  const body = (request.body ?? {}) as { uploadId?: unknown }
  const uploadId = requiredString(body.uploadId, 'uploadId', 80)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      account.userId
    ])
    const owner = await client.query(
      'SELECT 1 FROM snapshot_uploads WHERE id = $1 AND user_id = $2',
      [uploadId, account.userId]
    )
    if (!owner.rowCount) {
      throw new ApiError(404, 'SNAPSHOT_UPLOAD_NOT_FOUND', '快照上传任务不存在')
    }
    const existing = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM entities WHERE user_id = $1',
      [account.userId]
    )
    if (Number(existing.rows[0]?.count) > 0) {
      throw new ApiError(409, 'SNAPSHOT_EXISTS', '云端已有数据，请下载快照')
    }
    const inserted = await client.query(
      `INSERT INTO entities(
         user_id, entity_type, entity_id, version, payload, deleted, updated_by_device, updated_at
       )
       SELECT $1, entity_type, entity_id, version, payload, false, $2, now()
       FROM snapshot_upload_entities WHERE upload_id = $3`,
      [account.userId, account.deviceId, uploadId]
    )
    await client.query('DELETE FROM snapshot_uploads WHERE id = $1', [uploadId])
    await client.query('COMMIT')
    return { ok: true, entityCount: inserted.rowCount ?? 0, latestSeq: 0 }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.delete('/v1/sync/bootstrap/:uploadId', async (request) => {
  const account = await authenticate(request)
  const params = request.params as { uploadId: string }
  await pool.query(
    'DELETE FROM snapshot_uploads WHERE id = $1 AND user_id = $2',
    [params.uploadId, account.userId]
  )
  return { ok: true }
})

app.get('/v1/sync/snapshot', async (request) => {
  const account = await authenticate(request)
  const query = request.query as {
    cursorType?: string
    cursorId?: string
    afterSeq?: string
    limit?: string
  }
  const cursorType = typeof query.cursorType === 'string' && query.cursorType ? query.cursorType : null
  const cursorId = typeof query.cursorId === 'string' ? query.cursorId : ''
  const limit = Math.max(1, Math.min(500, Number(query.limit) || 200))
  const suppliedSeq = Number(query.afterSeq)
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const latest =
      Number.isFinite(suppliedSeq) && suppliedSeq >= 0
        ? { rows: [{ seq: String(Math.floor(suppliedSeq)) }] }
        : await client.query<{ seq: string }>(
            `SELECT COALESCE(MAX(server_seq), 0)::text AS seq
             FROM changes WHERE user_id = $1`,
            [account.userId]
          )
    const result = await client.query<{
      entity_type: string
      entity_id: string
      version: string
      payload: unknown
      deleted: boolean
    }>(
      `SELECT entity_type, entity_id, version::text, payload, deleted
       FROM entities
       WHERE user_id = $1
         AND ($2::text IS NULL OR (entity_type, entity_id) > ($2, $3))
       ORDER BY entity_type, entity_id
       LIMIT $4`,
      [account.userId, cursorType, cursorId, limit]
    )
    await client.query('COMMIT')
    return {
      entities: result.rows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        version: Number(row.version),
        payload: row.payload,
        deleted: row.deleted
      })),
      snapshotSeq: Number(latest.rows[0]?.seq ?? 0),
      hasMore: result.rows.length === limit,
      nextCursor:
        result.rows.length === limit
          ? {
              entityType: result.rows.at(-1)?.entity_type,
              entityId: result.rows.at(-1)?.entity_id
            }
          : null
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.get('/v1/sync/changes', async (request) => {
  const account = await authenticate(request)
  const query = request.query as { after?: string; limit?: string }
  const after = Math.max(0, Number(query.after) || 0)
  const limit = Math.max(1, Math.min(500, Number(query.limit) || 200))
  const result = await pool.query<{
    server_seq: string
    entity_type: string
    entity_id: string
    version: string
    payload: unknown
    operation: 'put' | 'delete'
  }>(
    `SELECT server_seq::text, entity_type, entity_id, version::text, payload, operation
     FROM changes
     WHERE user_id = $1 AND server_seq > $2
     ORDER BY server_seq ASC
     LIMIT $3`,
    [account.userId, after, limit]
  )
  const latest = await pool.query<{ seq: string }>(
    `SELECT COALESCE(MAX(server_seq), 0)::text AS seq
     FROM changes WHERE user_id = $1`,
    [account.userId]
  )
  return {
    changes: result.rows.map((row) => ({
      serverSeq: Number(row.server_seq),
      entityType: row.entity_type,
      entityId: row.entity_id,
      version: Number(row.version),
      payload: row.payload,
      deleted: row.operation === 'delete'
    })),
    latestSeq: Number(latest.rows[0]?.seq ?? 0),
    hasMore: result.rows.length === limit
  }
})

app.post('/v1/sync/commit', async (request) => {
  const account = await authenticate(request)
  const body = (request.body ?? {}) as {
    operations?: Array<{
      opId?: unknown
      entityType?: unknown
      entityId?: unknown
      baseVersion?: unknown
      operation?: unknown
      payload?: unknown
    }>
  }
  if (!Array.isArray(body.operations) || body.operations.length > 500) {
    throw new ApiError(400, 'INVALID_REQUEST', '同步操作数量无效')
  }
  const operations = body.operations.map((raw) => {
    const opId = requiredString(raw.opId, 'opId', 80)
    if (!/^[0-9a-f-]{36}$/i.test(opId)) {
      throw new ApiError(400, 'INVALID_REQUEST', '操作 ID 无效')
    }
    const entityType = requiredString(raw.entityType, 'entityType', 80)
    const entityId = requiredString(raw.entityId, 'entityId', 500)
    const baseVersion = Number(raw.baseVersion)
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
      throw new ApiError(400, 'INVALID_REQUEST', '基线版本无效')
    }
    if (raw.operation !== 'put' && raw.operation !== 'delete') {
      throw new ApiError(400, 'INVALID_REQUEST', '同步操作类型无效')
    }
    return {
      opId,
      entityType,
      entityId,
      baseVersion,
      operation: raw.operation as 'put' | 'delete',
      payload: raw.payload ?? null
    }
  })

  const accepted: string[] = []
  let latestSeq = 0
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      account.userId
    ])
    if (operations.length > 0) {
      await saveUserSnapshot(
        client,
        account.userId,
        account.deviceId,
        'pre_commit'
      )
    }
    for (const operation of operations) {
      const duplicate = await client.query(
        'SELECT 1 FROM changes WHERE user_id = $1 AND op_id = $2',
        [account.userId, operation.opId]
      )
      if (duplicate.rowCount) {
        accepted.push(operation.opId)
        continue
      }
      const current = await client.query<{
        version: string
      }>(
        `SELECT version::text FROM entities
         WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
         FOR UPDATE`,
        [account.userId, operation.entityType, operation.entityId]
      )
      const serverVersion = current.rows[0] ? Number(current.rows[0].version) : 0
      const nextVersion = serverVersion + 1
      await client.query(
        `INSERT INTO entities(
           user_id, entity_type, entity_id, version, payload, deleted, updated_by_device, updated_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
         ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
           version = excluded.version,
           payload = excluded.payload,
           deleted = excluded.deleted,
           updated_by_device = excluded.updated_by_device,
           updated_at = excluded.updated_at`,
        [
          account.userId,
          operation.entityType,
          operation.entityId,
          nextVersion,
          JSON.stringify(operation.payload),
          operation.operation === 'delete',
          account.deviceId
        ]
      )
      const change = await client.query<{ server_seq: string }>(
        `INSERT INTO changes(
           user_id, op_id, device_id, entity_type, entity_id,
           base_version, version, operation, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING server_seq::text`,
        [
          account.userId,
          operation.opId,
          account.deviceId,
          operation.entityType,
          operation.entityId,
          serverVersion,
          nextVersion,
          operation.operation,
          JSON.stringify(operation.payload)
        ]
      )
      latestSeq = Math.max(latestSeq, Number(change.rows[0].server_seq))
      accepted.push(operation.opId)
    }
    await client.query('COMMIT')
    if (latestSeq > 0) {
      pushUserEvent(account.userId, { type: 'sync.changed', seq: latestSeq })
    }
    return { accepted, conflicts: [], latestSeq }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.post('/v1/web/fetch', async (request) => {
  await authenticate(request)
  const body = (request.body ?? {}) as { url?: unknown }
  let url = await assertPublicWebUrl(requiredString(body.url, 'url', 2000))
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'user-agent': 'Arbor-Web/0.1.19 (+https://github.com/charlie-sys/arbor)'
      }
    }).catch(() => {
      throw new ApiError(502, 'WEB_FETCH_FAILED', '网页读取失败')
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) {
        throw new ApiError(502, 'WEB_REDIRECT_FAILED', '网页重定向次数过多')
      }
      url = await assertPublicWebUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) {
      throw new ApiError(
        502,
        'WEB_FETCH_FAILED',
        `网页返回错误 (${response.status})`
      )
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml') &&
      !contentType.includes('text/plain')
    ) {
      throw new ApiError(415, 'WEB_CONTENT_UNSUPPORTED', '该地址不是可阅读的网页')
    }
    const declaredSize = Number(response.headers.get('content-length') ?? 0)
    if (declaredSize > MAX_WEB_PAGE_BYTES) {
      throw new ApiError(413, 'WEB_PAGE_TOO_LARGE', '网页内容超过大小限制')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new ApiError(502, 'WEB_FETCH_FAILED', '网页没有返回内容')
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_WEB_PAGE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new ApiError(413, 'WEB_PAGE_TOO_LARGE', '网页内容超过大小限制')
      }
      chunks.push(value)
    }
    const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
    const page = contentType.includes('text/plain')
      ? { title: '', text: raw.slice(0, 1_500_000) }
      : readableWebPage(raw)
    return {
      url: url.toString(),
      title: page.title || url.hostname,
      text: page.text,
      fetchedAt: new Date().toISOString()
    }
  }
  throw new ApiError(502, 'WEB_REDIRECT_FAILED', '网页重定向次数过多')
})

function extractSearchSources(text: string, limit: number) {
  const sources: Array<{ title: string; url: string; snippet: string }> = []
  const seen = new Set<string>()
  for (const match of text.matchAll(
    /\[([^\]]{1,160})\]\((https?:\/\/[^\s)]+)\)/g
  )) {
    if (seen.has(match[2])) continue
    seen.add(match[2])
    sources.push({ title: match[1].trim(), url: match[2], snippet: '' })
    if (sources.length >= limit) break
  }
  return sources
}

app.post('/v1/ali/search-web', async (request) => {
  await authenticate(request)
  const body = (request.body ?? {}) as {
    query?: unknown
    limit?: unknown
    provider?: unknown
    endpoint?: unknown
    apiKey?: unknown
  }
  const query = requiredString(body.query, 'query', 500).trim()
  const limit = Math.min(
    5,
    Math.max(1, Number.isFinite(Number(body.limit)) ? Number(body.limit) : 5)
  )
  const provider = body.provider === 'searxng' ? 'searxng' : 'exa'
  const endpoint =
    typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
  if (provider === 'searxng') {
    if (!endpoint) {
      throw new ApiError(400, 'SEARCH_ENDPOINT_REQUIRED', '请先填写 SearXNG 地址')
    }
    const baseUrl = await assertPublicWebUrl(endpoint)
    const path = baseUrl.pathname.endsWith('/search')
      ? baseUrl.pathname
      : `${baseUrl.pathname.replace(/\/+$/, '')}/search`
    const url = new URL(path, baseUrl)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('language', 'zh-CN')
    url.searchParams.set('safesearch', '0')
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(25_000)
    }).catch(() => {
      throw new ApiError(502, 'SEARCH_FAILED', '搜索服务请求失败')
    })
    if (!response.ok) {
      throw new ApiError(
        502,
        'SEARCH_FAILED',
        `搜索服务返回 ${response.status}`
      )
    }
    const json = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[]
    }
    const sources = (json.results ?? [])
      .filter((item) => item.url)
      .slice(0, limit)
      .map((item) => ({
        title: item.title || item.url || '',
        url: item.url || '',
        snippet: (item.content || '').slice(0, 300)
      }))
    return {
      sources,
      raw: sources
        .map((item) => `${item.title}\n${item.url}\n${item.snippet}`)
        .join('\n\n')
        .slice(0, 6000)
    }
  }

  const baseUrl = await assertPublicWebUrl(
    endpoint || 'https://mcp.exa.ai/mcp'
  )
  if (apiKey) baseUrl.searchParams.set('exaApiKey', apiKey)
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query,
          numResults: limit,
          livecrawl: 'fallback',
          type: 'auto'
        }
      }
    }),
    signal: AbortSignal.timeout(25_000)
  }).catch(() => {
    throw new ApiError(502, 'SEARCH_FAILED', 'Exa 请求失败')
  })
  if (!response.ok) {
    throw new ApiError(502, 'SEARCH_FAILED', `Exa 返回 ${response.status}`)
  }
  const type = response.headers.get('content-type') || ''
  let text = ''
  if (type.includes('text/event-stream')) {
    const raw = await response.text()
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      try {
        const message = JSON.parse(line.slice(5).trim()) as {
          result?: { content?: { text?: string }[] }
        }
        if (message.result) {
          text = (message.result.content ?? [])
            .map((part) => part.text ?? '')
            .join('\n')
        }
      } catch {
        // Ignore keep-alive events.
      }
    }
  } else {
    const json = (await response.json()) as {
      result?: { content?: { text?: string }[] }
      content?: { text?: string }[]
    }
    text = ((json.result ?? json).content ?? [])
      .map((part) => part.text ?? '')
      .join('\n')
  }
  if (!text.trim()) {
    throw new ApiError(502, 'SEARCH_EMPTY', 'Exa 未返回搜索结果')
  }
  return {
    sources: extractSearchSources(text, limit),
    raw: text.slice(0, 6000)
  }
})

app.post('/v1/ali/search-github', async (request) => {
  await authenticate(request)
  const body = (request.body ?? {}) as {
    query?: unknown
    type?: unknown
    limit?: unknown
    token?: unknown
  }
  const query = requiredString(body.query, 'query', 500).trim()
  const type =
    body.type === 'issues' || body.type === 'code'
      ? body.type
      : 'repositories'
  const limit = Math.min(
    10,
    Math.max(1, Number.isFinite(Number(body.limit)) ? Number(body.limit) : 5)
  )
  const token = typeof body.token === 'string' ? body.token : ''
  if (type === 'code' && !token) {
    throw new ApiError(
      400,
      'GITHUB_TOKEN_REQUIRED',
      'GitHub 代码搜索需要 Personal Access Token'
    )
  }
  const response = await fetch(
    `https://api.github.com/search/${type}?q=${encodeURIComponent(query)}&per_page=${limit}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'Arbor-Sync',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      signal: AbortSignal.timeout(20_000)
    }
  ).catch(() => {
    throw new ApiError(502, 'GITHUB_SEARCH_FAILED', 'GitHub 请求失败')
  })
  if (!response.ok) {
    throw new ApiError(
      502,
      'GITHUB_SEARCH_FAILED',
      `GitHub 搜索失败（${response.status}）`
    )
  }
  const json = (await response.json()) as {
    items?: Record<string, any>[]
  }
  const sources = (json.items ?? [])
    .slice(0, limit)
    .map((item) => {
      if (type === 'repositories') {
        return {
          title: `${item.full_name || item.name || 'repository'}${item.stargazers_count !== undefined ? ` · ★ ${item.stargazers_count}` : ''}`,
          url: item.html_url || '',
          snippet: [item.description, item.language]
            .filter(Boolean)
            .join(' · ')
        }
      }
      if (type === 'issues') {
        return {
          title: `${item.title || 'issue'} · ${item.state || ''}`,
          url: item.html_url || '',
          snippet: String(item.body || '')
            .replace(/\s+/g, ' ')
            .slice(0, 240)
        }
      }
      return {
        title: `${item.repository?.full_name || ''}/${item.path || item.name || ''}`,
        url: item.html_url || '',
        snippet: `${item.repository?.full_name || ''} · ${item.path || ''}`
      }
    })
    .filter((item) => item.url)
  return {
    sources,
    raw: sources
      .map((item) => `${item.title}\n${item.url}\n${item.snippet}`)
      .join('\n\n')
      .slice(0, 6000)
  }
})

app.get('/v1/snapshots', async (request) => {
  const account = await authenticate(request)
  if (!account.isPrimary) {
    throw new ApiError(403, 'PRIMARY_DEVICE_REQUIRED', '只有主设备可以查看云端快照')
  }
  const result = await pool.query<{
    id: string
    created_by_device: string | null
    device_name: string | null
    reason: 'pre_commit' | 'pre_restore'
    entity_count: number
    created_at: Date
  }>(
    `SELECT s.id, s.created_by_device, d.name AS device_name,
            s.reason, s.entity_count, s.created_at
     FROM sync_snapshots s
     LEFT JOIN devices d ON d.id = s.created_by_device
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC`,
    [account.userId]
  )
  return {
    retentionDays: SNAPSHOT_RETENTION_DAYS,
    snapshots: result.rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      entityCount: row.entity_count,
      deviceName: row.device_name ?? '未知设备',
      createdAt: row.created_at.toISOString()
    }))
  }
})

app.get('/v1/snapshots/:id/changes', async (request) => {
  const account = await authenticate(request)
  if (!account.isPrimary) {
    throw new ApiError(403, 'PRIMARY_DEVICE_REQUIRED', '只有主设备可以查看云端快照')
  }
  const params = request.params as { id: string }
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    throw new ApiError(400, 'INVALID_REQUEST', '快照 ID 无效')
  }
  type SnapshotItem = {
    entityType: string
    entityId: string
    version: number
    payload: unknown
    deleted: boolean
  }
  const snapshotResult = await pool.query<{
    payload: SnapshotItem[]
  }>(
    `SELECT payload FROM sync_snapshots
     WHERE id = $1 AND user_id = $2`,
    [params.id, account.userId]
  )
  const snapshot = snapshotResult.rows[0]
  if (!snapshot) {
    throw new ApiError(404, 'SNAPSHOT_NOT_FOUND', '云端快照不存在')
  }
  const next = await pool.query<{ payload: SnapshotItem[] }>(
    `SELECT payload FROM sync_snapshots
     WHERE user_id = $1
       AND id <> $2
       AND created_at > (
         SELECT created_at FROM sync_snapshots
         WHERE id = $2 AND user_id = $1
       )
     ORDER BY created_at ASC
     LIMIT 1`,
    [account.userId, params.id]
  )
  let after = next.rows[0]?.payload
  if (!after) {
    const current = await pool.query<{
      entity_type: string
      entity_id: string
      version: string
      payload: unknown
      deleted: boolean
    }>(
      `SELECT entity_type, entity_id, version::text, payload, deleted
       FROM entities WHERE user_id = $1
       ORDER BY entity_type, entity_id`,
      [account.userId]
    )
    after = current.rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      version: Number(row.version),
      payload: row.payload,
      deleted: row.deleted
    }))
  }
  const beforeMap = new Map(
    snapshot.payload.map((item) => [
      `${item.entityType}\u0000${item.entityId}`,
      item
    ])
  )
  const afterMap = new Map(
    after.map((item) => [`${item.entityType}\u0000${item.entityId}`, item])
  )
  const changes: Array<{
    entityType: string
    entityId: string
    change: 'added' | 'updated' | 'removed'
  }> = []
  for (const key of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    const before = beforeMap.get(key)
    const current = afterMap.get(key)
    if (!before && !current?.deleted) {
      if (current) {
        changes.push({
          entityType: current.entityType,
          entityId: current.entityId,
          change: 'added'
        })
      }
      continue
    }
    if (before && !current) {
      changes.push({
        entityType: before.entityType,
        entityId: before.entityId,
        change: 'removed'
      })
      continue
    }
    if (
      before &&
      current &&
      (before.deleted !== current.deleted ||
        !isDeepStrictEqual(before.payload, current.payload))
    ) {
      changes.push({
        entityType: current.entityType,
        entityId: current.entityId,
        change: current.deleted ? 'removed' : 'updated'
      })
    }
  }
  changes.sort((left, right) =>
    `${left.entityType}\u0000${left.entityId}`.localeCompare(
      `${right.entityType}\u0000${right.entityId}`
    )
  )
  const files = changes.filter((item) => item.entityType === 'blob_binding')
  return {
    files,
    changes: changes.slice(0, 300),
    totalChanges: changes.length,
    hasMore: changes.length > 300
  }
})

app.post('/v1/snapshots/:id/restore', async (request) => {
  const account = await authenticate(request)
  if (!account.isPrimary) {
    throw new ApiError(403, 'PRIMARY_DEVICE_REQUIRED', '只有主设备可以恢复云端快照')
  }
  const params = request.params as { id: string }
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    throw new ApiError(400, 'INVALID_REQUEST', '快照 ID 无效')
  }
  const client = await pool.connect()
  let latestSeq = 0
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      account.userId
    ])
    const snapshotResult = await client.query<{
      payload: Array<{
        entityType: string
        entityId: string
        version: number
        payload: unknown
        deleted: boolean
      }>
    }>(
      `SELECT payload FROM sync_snapshots
       WHERE id = $1 AND user_id = $2`,
      [params.id, account.userId]
    )
    const snapshot = snapshotResult.rows[0]
    if (!snapshot) {
      throw new ApiError(404, 'SNAPSHOT_NOT_FOUND', '云端快照不存在')
    }
    await saveUserSnapshot(
      client,
      account.userId,
      account.deviceId,
      'pre_restore'
    )
    const currentResult = await client.query<{
      entity_type: string
      entity_id: string
      version: string
    }>(
      `SELECT entity_type, entity_id, version::text
       FROM entities WHERE user_id = $1`,
      [account.userId]
    )
    const current = new Map(
      currentResult.rows.map((row) => [
        `${row.entity_type}\u0000${row.entity_id}`,
        Number(row.version)
      ])
    )
    const restored = new Map(
      snapshot.payload.map((entity) => [
        `${entity.entityType}\u0000${entity.entityId}`,
        entity
      ])
    )
    const appendChange = async (
      entityType: string,
      entityId: string,
      baseVersion: number,
      version: number,
      operation: 'put' | 'delete',
      payload: unknown
    ): Promise<void> => {
      const change = await client.query<{ server_seq: string }>(
        `INSERT INTO changes(
           user_id, op_id, device_id, entity_type, entity_id,
           base_version, version, operation, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING server_seq::text`,
        [
          account.userId,
          crypto.randomUUID(),
          account.deviceId,
          entityType,
          entityId,
          baseVersion,
          version,
          operation,
          operation === 'delete' ? null : JSON.stringify(payload)
        ]
      )
      latestSeq = Math.max(latestSeq, Number(change.rows[0].server_seq))
    }

    for (const [key, entity] of restored) {
      const previous = current.get(key) ?? 0
      const nextVersion = Math.max(entity.version, previous + 1)
      await client.query(
        `INSERT INTO entities(
           user_id, entity_type, entity_id, version, payload, deleted,
           updated_by_device, updated_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
         ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
           version = excluded.version,
           payload = excluded.payload,
           deleted = excluded.deleted,
           updated_by_device = excluded.updated_by_device,
           updated_at = excluded.updated_at`,
        [
          account.userId,
          entity.entityType,
          entity.entityId,
          nextVersion,
          JSON.stringify(entity.payload),
          entity.deleted,
          account.deviceId
        ]
      )
      await appendChange(
        entity.entityType,
        entity.entityId,
        previous,
        nextVersion,
        entity.deleted ? 'delete' : 'put',
        entity.payload
      )
      current.delete(key)
    }
    for (const [key, previous] of current) {
      const [entityType, entityId] = key.split('\u0000')
      const nextVersion = previous + 1
      await client.query(
        `INSERT INTO entities(
           user_id, entity_type, entity_id, version, payload, deleted,
           updated_by_device, updated_at
         ) VALUES ($1, $2, $3, $4, 'null'::jsonb, true, $5, now())
         ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
           version = excluded.version,
           payload = 'null'::jsonb,
           deleted = true,
           updated_by_device = excluded.updated_by_device,
           updated_at = excluded.updated_at`,
        [account.userId, entityType, entityId, nextVersion, account.deviceId]
      )
      await appendChange(
        entityType,
        entityId,
        previous,
        nextVersion,
        'delete',
        null
      )
    }
    await client.query('COMMIT')
    pushUserEvent(account.userId, { type: 'sync.changed', seq: latestSeq })
    return { ok: true, latestSeq }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
})

app.post('/v1/blobs/prepare', async (request) => {
  const account = await authenticate(request)
  const body = (request.body ?? {}) as {
    sha256?: unknown
    size?: unknown
    mimeType?: unknown
  }
  const sha256 = requiredString(body.sha256, 'sha256', 64).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new ApiError(400, 'INVALID_REQUEST', '文件哈希无效')
  }
  const size = Number(body.size)
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BLOB_SIZE) {
    throw new ApiError(400, 'INVALID_REQUEST', '文件大小无效')
  }
  const mimeType = requiredString(body.mimeType, 'mimeType', 120)
  const existing = await pool.query(
    'SELECT 1 FROM blobs WHERE user_id = $1 AND sha256 = $2',
    [account.userId, sha256]
  )
  if (existing.rowCount) return { exists: true, sha256 }
  const usage = await pool.query<{ total: string }>(
    'SELECT COALESCE(SUM(size), 0)::text AS total FROM blobs WHERE user_id = $1',
    [account.userId]
  )
  if (Number(usage.rows[0]?.total) + size > BLOB_USER_QUOTA) {
    throw new ApiError(413, 'STORAGE_QUOTA_EXCEEDED', '账号文件存储空间不足')
  }

  await pool.query("DELETE FROM blob_uploads WHERE expires_at < now()")
  const uploadId = crypto.randomUUID()
  await pool.query(
    `INSERT INTO blob_uploads(id, user_id, sha256, size, mime_type, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      uploadId,
      account.userId,
      sha256,
      size,
      mimeType,
      new Date(Date.now() + 30 * 60 * 1000)
    ]
  )
  return { exists: false, sha256, uploadId, maxSize: MAX_BLOB_SIZE }
})

app.put('/v1/blobs/upload/:id', async (request, reply) => {
  const account = await authenticate(request)
  const params = request.params as { id: string }
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    throw new ApiError(400, 'INVALID_REQUEST', '上传任务无效')
  }
  const upload = await pool.query<{
    sha256: string
    size: string
    mime_type: string
    expires_at: Date
  }>(
    `SELECT sha256, size::text, mime_type, expires_at
     FROM blob_uploads WHERE id = $1 AND user_id = $2`,
    [params.id, account.userId]
  )
  const row = upload.rows[0]
  if (!row || row.expires_at.getTime() <= Date.now()) {
    throw new ApiError(410, 'UPLOAD_EXPIRED', '上传任务已过期')
  }
  const part = await request.file()
  if (!part) throw new ApiError(400, 'INVALID_REQUEST', '缺少上传文件')

  await fs.mkdir(UPLOAD_TEMP_DIR, { recursive: true })
  const temp = path.join(UPLOAD_TEMP_DIR, `${params.id}.uploading`)
  const hash = crypto.createHash('sha256')
  let received = 0
  try {
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > MAX_BLOB_SIZE) {
          callback(new ApiError(413, 'FILE_TOO_LARGE', '文件超过大小限制'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      }
    })
    await pipeline(part.file, meter, createWriteStream(temp, { flags: 'wx' }))
    const actualHash = hash.digest('hex')
    if (received !== Number(row.size) || actualHash !== row.sha256) {
      throw new ApiError(400, 'BLOB_MISMATCH', '文件大小或哈希不匹配')
    }
    const quotaClient = await pool.connect()
    try {
      await quotaClient.query('BEGIN')
      await quotaClient.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [account.userId]
      )
      const usage = await quotaClient.query<{ total: string }>(
        `SELECT COALESCE(SUM(size), 0)::text AS total
         FROM blobs WHERE user_id = $1 AND sha256 <> $2`,
        [account.userId, actualHash]
      )
      if (Number(usage.rows[0]?.total) + received > BLOB_USER_QUOTA) {
        throw new ApiError(413, 'STORAGE_QUOTA_EXCEEDED', '账号文件存储空间不足')
      }
      const objectKey = `${account.userId}/${actualHash}`
      await blobStorage.putFile(temp, objectKey, row.mime_type)
      await quotaClient.query(
        `INSERT INTO blobs(user_id, sha256, size, mime_type, object_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(user_id, sha256) DO NOTHING`,
        [account.userId, actualHash, received, row.mime_type, objectKey]
      )
      await quotaClient.query('DELETE FROM blob_uploads WHERE id = $1', [params.id])
      await quotaClient.query('COMMIT')
    } catch (error) {
      await quotaClient.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      quotaClient.release()
    }
    return reply.status(201).send({
      ok: true,
      sha256: actualHash,
      size: received,
      mimeType: row.mime_type
    })
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
})

app.get('/v1/blobs/:sha256', async (request, reply) => {
  const account = await authenticate(request)
  const params = request.params as { sha256: string }
  const sha256 = String(params.sha256).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new ApiError(400, 'INVALID_REQUEST', '文件哈希无效')
  }
  const result = await pool.query<{
    object_key: string
    mime_type: string
    size: string
  }>(
    'SELECT object_key, mime_type, size::text FROM blobs WHERE user_id = $1 AND sha256 = $2',
    [account.userId, sha256]
  )
  const row = result.rows[0]
  if (!row) throw new ApiError(404, 'BLOB_NOT_FOUND', '文件不存在')
  const stream = await blobStorage.getObject(row.object_key).catch(() => {
    throw new ApiError(404, 'BLOB_NOT_FOUND', '文件内容不存在')
  })
  reply.header('content-type', row.mime_type)
  reply.header('content-length', row.size)
  return reply.send(stream)
})

app.post('/v1/session/socket-ticket', async (request) => {
  const account = await authenticate(request)
  const ticket = randomToken()
  await pool.query(
    `INSERT INTO session_tickets(id, user_id, device_id, session_id, ticket_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      crypto.randomUUID(),
      account.userId,
      account.deviceId,
      account.sessionId,
      sha256(ticket),
      new Date(Date.now() + TICKET_TTL_MS)
    ]
  )
  return { ticket, expiresIn: TICKET_TTL_MS / 1000 }
})

app.get('/v1/session/socket', { websocket: true }, async (socket, request) => {
  try {
    const query = request.query as { ticket?: string }
    const ticket = requiredString(query.ticket, 'ticket', 256)
    const result = await pool.query<{
      user_id: string
      device_id: string
      session_id: string
      expires_at: Date
      status: string
      epoch: number
      user_epoch: number
    }>(
      `SELECT st.user_id, st.device_id, st.session_id, st.expires_at,
              s.status, s.epoch, u.session_epoch AS user_epoch
       FROM session_tickets st
       JOIN sessions s ON s.id = st.session_id
       JOIN users u ON u.id = st.user_id
       WHERE st.ticket_hash = $1`,
      [sha256(ticket)]
    )
    const row = result.rows[0]
    const sessionEpoch = row ? Number(row.epoch) : 0
    const userEpoch = row ? Number(row.user_epoch) : 0
    if (
      !row ||
      row.expires_at.getTime() <= Date.now() ||
      row.status !== 'active' ||
      sessionEpoch !== userEpoch
    ) {
      socket.close(4003, 'Invalid ticket')
      return
    }
    await pool.query('DELETE FROM session_tickets WHERE ticket_hash = $1', [sha256(ticket)])
    const connections = sockets.get(row.user_id) ?? new Set()
    connections.add(socket)
    sockets.set(row.user_id, connections)
    socket.send(JSON.stringify({ type: 'ready', sessionEpoch }))
    socket.on('close', () => {
      const current = sockets.get(row.user_id)
      current?.delete(socket)
      if (current?.size === 0) sockets.delete(row.user_id)
    })
  } catch (error) {
    app.log.warn(error)
    socket.close(4003, 'Authentication failed')
  }
})

await migrate()
await initRedis()
await app.listen({ host: HOST, port: PORT })
const gcTimer =
  process.env.BLOB_GC_ENABLED === 'false'
    ? null
    : setInterval(() => {
        void garbageCollectBlobs().catch((error) =>
          app.log.warn({ err: error }, 'blob garbage collection failed')
        )
      }, 24 * 60 * 60 * 1000)
gcTimer?.unref()

async function shutdown(): Promise<void> {
  if (gcTimer) clearInterval(gcTimer)
  for (const connections of sockets.values()) {
    for (const socket of connections) socket.close(1001, 'Server shutting down')
  }
  await app.close()
  await Promise.allSettled([
    redisPublisher?.quit(),
    redisSubscriber?.quit()
  ].filter(Boolean) as Promise<unknown>[])
  await pool.end()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
