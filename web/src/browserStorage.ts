const DATABASE_NAME = 'arbor-web-storage'
const DATABASE_VERSION = 1
const BLOB_STORE = 'blobs'
const JSON_STORE = 'json'

let databasePromise: Promise<IDBDatabase> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('浏览器存储请求失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('浏览器存储事务失败'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('浏览器存储事务已取消'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(BLOB_STORE)) {
        database.createObjectStore(BLOB_STORE)
      }
      if (!database.objectStoreNames.contains(JSON_STORE)) {
        database.createObjectStore(JSON_STORE)
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('无法打开浏览器存储'))
    }
    request.onblocked = () => {
      reject(new Error('浏览器存储正在被另一个旧页面占用，请关闭其他 Arbor 页面后重试'))
    }
  })
  return databasePromise
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const database = await openDatabase()
  const transaction = database.transaction(BLOB_STORE, 'readonly')
  return (await requestResult(transaction.objectStore(BLOB_STORE).get(key))) as
    | Blob
    | undefined
}

export async function putBlob(key: string, value: Blob): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(BLOB_STORE, 'readwrite')
  transaction.objectStore(BLOB_STORE).put(value, key)
  await transactionDone(transaction)
}

export async function deleteBlob(key: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(BLOB_STORE, 'readwrite')
  transaction.objectStore(BLOB_STORE).delete(key)
  await transactionDone(transaction)
}

export async function getJson<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase()
  const transaction = database.transaction(JSON_STORE, 'readonly')
  return (await requestResult(transaction.objectStore(JSON_STORE).get(key))) as
    | T
    | undefined
}

export async function putJson(key: string, value: unknown): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(JSON_STORE, 'readwrite')
  transaction.objectStore(JSON_STORE).put(value, key)
  await transactionDone(transaction)
}

export async function deleteJson(key: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(JSON_STORE, 'readwrite')
  transaction.objectStore(JSON_STORE).delete(key)
  await transactionDone(transaction)
}

export async function sha256Hex(value: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await value.arrayBuffer())
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function safePathSegment(value: string): string {
  const clean = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.slice(0, 180) || 'file'
}
