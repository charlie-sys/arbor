interface IdentityStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface LegacyOwner {
  accountKey: string
  deviceId: string
}

const DEVICE_MAP_KEY = 'arbor-web-device-map-v1'
const LEGACY_DEVICE_KEY = 'arbor-web-device'
const LEGACY_OWNER_KEY = 'arbor-web-device-owner-v1'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeServer(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

export function accountDeviceKey(serverUrl: string, email: string): string {
  return `${normalizeServer(serverUrl)}|${email.trim().toLowerCase()}`
}

function readMap(storage: IdentityStorage): Record<string, string> {
  try {
    const parsed = JSON.parse(storage.getItem(DEVICE_MAP_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && UUID_PATTERN.test(entry[1])
      )
    )
  } catch {
    return {}
  }
}

function writeMap(
  storage: IdentityStorage,
  map: Record<string, string>
): void {
  try {
    storage.setItem(DEVICE_MAP_KEY, JSON.stringify(map))
  } catch {
    // Private browsing can reject storage; the caller still receives a usable ID.
  }
}

function readLegacyOwner(storage: IdentityStorage): LegacyOwner | null {
  try {
    const parsed = JSON.parse(
      storage.getItem(LEGACY_OWNER_KEY) ?? 'null'
    ) as Partial<LegacyOwner> | null
    return parsed &&
      typeof parsed.accountKey === 'string' &&
      typeof parsed.deviceId === 'string' &&
      UUID_PATTERN.test(parsed.deviceId)
      ? { accountKey: parsed.accountKey, deviceId: parsed.deviceId }
      : null
  } catch {
    return null
  }
}

function createDeviceId(): string {
  return crypto.randomUUID()
}

export function clearLegacyDeviceId(storage: IdentityStorage): void {
  try {
    storage.removeItem(LEGACY_DEVICE_KEY)
  } catch {
    // Storage cleanup is best-effort.
  }
}

export function seedAccountDeviceId(
  storage: IdentityStorage,
  serverUrl: string,
  email: string,
  deviceId: string
): string {
  if (!UUID_PATTERN.test(deviceId)) return getAccountDeviceId(storage, serverUrl, email)
  const key = accountDeviceKey(serverUrl, email)
  const map = readMap(storage)
  map[key] = deviceId
  writeMap(storage, map)
  try {
    storage.setItem(
      LEGACY_OWNER_KEY,
      JSON.stringify({ accountKey: key, deviceId } satisfies LegacyOwner)
    )
  } catch {
    // Keep the per-account map even when the migration marker cannot be stored.
  }
  clearLegacyDeviceId(storage)
  return deviceId
}

export function getAccountDeviceId(
  storage: IdentityStorage,
  serverUrl: string,
  email: string,
  knownCurrentDeviceId?: string
): string {
  const key = accountDeviceKey(serverUrl, email)
  const map = readMap(storage)
  if (map[key]) return seedAccountDeviceId(storage, serverUrl, email, map[key])
  if (knownCurrentDeviceId && UUID_PATTERN.test(knownCurrentDeviceId)) {
    return seedAccountDeviceId(storage, serverUrl, email, knownCurrentDeviceId)
  }

  const legacyOwner = readLegacyOwner(storage)
  const legacyDeviceId = storage.getItem(LEGACY_DEVICE_KEY)
  if (
    legacyOwner?.accountKey === key &&
    legacyDeviceId &&
    legacyOwner.deviceId === legacyDeviceId
  ) {
    return seedAccountDeviceId(storage, serverUrl, email, legacyDeviceId)
  }

  clearLegacyDeviceId(storage)
  return seedAccountDeviceId(storage, serverUrl, email, createDeviceId())
}

export function rotateAccountDeviceId(
  storage: IdentityStorage,
  serverUrl: string,
  email: string
): string {
  return seedAccountDeviceId(storage, serverUrl, email, createDeviceId())
}
