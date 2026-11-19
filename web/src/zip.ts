export interface ZipEntry {
  name: string
  data: Blob | Uint8Array | ArrayBuffer | string
}

const encoder = new TextEncoder()

function crc32(data: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of data) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

function toBytes(value: ZipEntry['data']): Promise<Uint8Array> {
  if (typeof value === 'string') return Promise.resolve(encoder.encode(value))
  if (value instanceof Uint8Array) return Promise.resolve(value)
  if (value instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(value))
  return value.arrayBuffer().then((buffer) => new Uint8Array(buffer))
}

export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const localParts: BlobPart[] = []
  const centralParts: BlobPart[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/\\/g, '/'))
    const data = await toBytes(entry.data)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    localParts.push(local, data as unknown as BlobPart)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.length + data.length
  }

  const centralSize = centralParts.reduce(
    (total, part) =>
      total +
      (part instanceof Uint8Array
        ? part.length
        : (part as Blob).size ?? 0),
    0
  )
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  return new Blob([...localParts, ...centralParts, end], {
    type: 'application/zip'
  })
}
