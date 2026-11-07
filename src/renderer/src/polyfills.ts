// Chromium 140 (Electron 38) lacks the Map upsert proposals used by PDF.js 5.x.
function define(proto: object, name: string, fn: (...args: never[]) => unknown): void {
  const target = proto as Record<string, unknown>
  if (typeof target[name] === 'function') return
  Object.defineProperty(proto, name, { configurable: true, writable: true, value: fn })
}

define(Map.prototype, 'getOrInsert', function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
  if (!this.has(key)) this.set(key, value)
  return this.get(key)
} as never)

define(Map.prototype, 'getOrInsertComputed', function (this: Map<unknown, unknown>, key: unknown, compute: (key: unknown) => unknown) {
  if (!this.has(key)) this.set(key, compute(key))
  return this.get(key)
} as never)

define(WeakMap.prototype, 'getOrInsert', function (this: WeakMap<object, unknown>, key: object, value: unknown) {
  if (!this.has(key)) this.set(key, value)
  return this.get(key)
} as never)

define(WeakMap.prototype, 'getOrInsertComputed', function (this: WeakMap<object, unknown>, key: object, compute: (key: object) => unknown) {
  if (!this.has(key)) this.set(key, compute(key))
  return this.get(key)
} as never)
