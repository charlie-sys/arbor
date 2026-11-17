const PAGE_TARGET = 3000
const LONG_BLOCK = PAGE_TARGET * 1.6

function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitLongBlock(block: string, max: number): string[] {
  const units = block.split(/(?<=[。！？；.!?;])\s*|\n+/).filter((unit) => unit.trim())
  const pieces: string[] = []
  let current = ''
  for (const unit of units) {
    if (unit.length > max) {
      if (current) {
        pieces.push(current)
        current = ''
      }
      for (let start = 0; start < unit.length; start += max) {
        pieces.push(unit.slice(start, start + max))
      }
      continue
    }
    if (current && current.length + unit.length > max) {
      pieces.push(current)
      current = ''
    }
    current += unit
  }
  if (current) pieces.push(current)
  return pieces
}

export function splitIntoPages(text: string): string[] {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  const pages: string[] = []
  let current = ''
  const flush = (): void => {
    const page = current.trim()
    if (page) pages.push(page)
    current = ''
  }
  for (const block of blocks) {
    const pieces = block.length > LONG_BLOCK ? splitLongBlock(block, PAGE_TARGET) : [block]
    for (const piece of pieces) {
      if (piece.length >= PAGE_TARGET) {
        flush()
        pages.push(piece.trim())
        continue
      }
      if (current && current.length + piece.length + 2 > PAGE_TARGET) flush()
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  flush()
  return pages.length ? pages : [normalized]
}
