import path from 'path'
import type { InboxAttachment } from '../shared/types'
import { t } from '../shared/i18n'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_FILES = 8
const FILE_FENCE = '```zotagent-file'

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/zip': '.zip'
}

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip'
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

export type SaveChatFile = (
  name: string,
  data: Buffer,
  kind: 'image' | 'file'
) => Promise<InboxAttachment>

export interface ChatArtifactSink {
  onText: (text: string) => void
  onAttachment: (attachment: InboxAttachment) => void
}

function attr(source: string, name: string): string | undefined {
  const quoted = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(source)
  if (quoted) return quoted[1]
  const single = new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i').exec(source)
  if (single) return single[1]
  const bare = new RegExp(`${name}\\s*=\\s*([^\\s]+)`, 'i').exec(source)
  return bare?.[1]
}

function cleanName(raw: string, mime: string, index: number): string {
  const base = raw.trim().replace(/^["']|["']$/g, '').split(/[\\/]/).pop() ?? ''
  let name = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!name) name = `ai-file-${Date.now().toString(36)}-${index}`
  if (!path.extname(name)) {
    const ext = MIME_EXT[mime.split(';')[0].trim().toLowerCase()]
    if (ext) name += ext
  }
  return name
}

function resolveMime(name: string, declared?: string): string {
  const clean = (declared ?? '').trim().toLowerCase()
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(clean)) return clean
  return EXT_MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

function isImageFile(name: string, mime: string): boolean {
  return mime.startsWith('image/') || IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())
}

function parseBlock(
  info: string,
  body: string,
  index: number
): { name: string; data: Buffer; kind: 'image' | 'file' } | null {
  let declared = attr(info, 'mime') ?? attr(info, 'type')
  let payload = body.trim()
  let encoding = (attr(info, 'encoding') ?? '').toLowerCase()

  if (payload.startsWith('data:')) {
    const comma = payload.indexOf(',')
    if (comma < 0) return null
    const header = payload.slice(5, comma)
    if (/;base64$/i.test(header)) {
      encoding = 'base64'
      declared = header.replace(/;base64$/i, '')
    } else {
      encoding = 'text'
      declared = header
    }
    payload = payload.slice(comma + 1)
  }

  let data: Buffer
  if (encoding === 'text' || encoding === 'plain') {
    data = Buffer.from(body, 'utf8')
  } else {
    const base64 = payload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    if (!base64 || base64.length % 4 === 1) return null
    data = Buffer.from(base64, 'base64')
  }
  if (!data.length || data.length > MAX_FILE_BYTES) return null

  const name = cleanName(attr(info, 'name') ?? '', declared ?? '', index)
  const mime = resolveMime(name, declared)
  return { name, data, kind: isImageFile(name, mime) ? 'image' : 'file' }
}

function findFenceStart(buffer: string): number {
  let index = buffer.indexOf(FILE_FENCE)
  while (index >= 0) {
    if (index === 0) return 0
    const lineStart = buffer.lastIndexOf('\n', index - 1) + 1
    if (/^[ \t]*$/.test(buffer.slice(lineStart, index))) return index
    index = buffer.indexOf(FILE_FENCE, index + FILE_FENCE.length)
  }
  return -1
}

function partialFenceLength(buffer: string): number {
  const max = Math.min(FILE_FENCE.length - 1, buffer.length)
  for (let length = max; length > 0; length -= 1) {
    if (FILE_FENCE.startsWith(buffer.slice(-length))) return length
  }
  return 0
}

async function extractInlineDataImages(
  text: string,
  ownerId: string,
  save: SaveChatFile,
  remaining: number
): Promise<{ text: string; attachments: InboxAttachment[] }> {
  const pattern = /!\[([^\]]*)\]\(data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\)/gi
  const matches = [...text.matchAll(pattern)].slice(0, Math.max(0, remaining))
  if (!matches.length) return { text, attachments: [] }

  const attachments: InboxAttachment[] = []
  const replacements: { match: string; markdown: string }[] = []
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const payload = match[3].replace(/\s+/g, '')
    if (!payload || payload.length % 4 === 1) continue
    const data = Buffer.from(payload, 'base64')
    if (!data.length || data.length > MAX_FILE_BYTES) continue
    const name = cleanName(match[1] ?? '', match[2], index + 1)
    try {
      const attachment = await save(name, data, 'image')
      attachments.push(attachment)
      const url = `zotfile://attachments/${ownerId}/${encodeURIComponent(attachment.file)}`
      replacements.push({ match: match[0], markdown: `![${match[1] ?? attachment.name}](${url})` })
    } catch {
      // 保存失败时保留原始 data URI
    }
  }

  let next = text
  for (const item of replacements) next = next.replace(item.match, item.markdown)
  return { text: next, attachments }
}

/**
 * 把模型输出中的文件块从正文里拆出来：正文继续按文本流下发，
 * 文件内容写成聊天附件后再以附件事件下发。
 */
export class ChatArtifactParser {
  private buffer = ''
  private pending: Promise<void> = Promise.resolve()
  private saved = 0
  private text = ''

  constructor(
    private ownerId: string,
    private save: SaveChatFile,
    private sink: ChatArtifactSink
  ) {}

  get content(): string {
    return this.text
  }

  push(delta: string): void {
    if (!delta) return
    this.buffer += delta
    this.drain(false)
  }

  async flush(): Promise<string> {
    this.drain(true)
    await this.pending
    const remaining = MAX_FILES - this.saved
    if (remaining > 0 && this.text.includes('](data:image/')) {
      const extracted = await extractInlineDataImages(this.text, this.ownerId, this.save, remaining)
      if (extracted.attachments.length) {
        this.text = extracted.text
        for (const attachment of extracted.attachments) this.sink.onAttachment(attachment)
      }
    }
    return this.text
  }

  private emit(text: string): void {
    if (!text) return
    this.text += text
    this.sink.onText(text)
  }

  private enqueueSave(name: string, data: Buffer, kind: 'image' | 'file'): void {
    this.pending = this.pending.then(async () => {
      try {
        const attachment = await this.save(name, data, kind)
        this.sink.onAttachment(attachment)
      } catch (err) {
        this.emit(t("\n\n> 附件 {0} 保存失败：{1}\n", [name, (err as Error).message]))
      }
    })
  }

  private drain(final: boolean): void {
    for (;;) {
      const start = findFenceStart(this.buffer)
      if (start < 0) {
        if (final) {
          const rest = this.buffer
          this.buffer = ''
          this.emit(rest)
          return
        }
        const hold = partialFenceLength(this.buffer)
        const cut = this.buffer.length - hold
        if (cut > 0) {
          const text = this.buffer.slice(0, cut)
          this.buffer = this.buffer.slice(cut)
          this.emit(text)
        }
        return
      }

      if (start > 0) {
        const text = this.buffer.slice(0, start)
        this.buffer = this.buffer.slice(start)
        this.emit(text)
      }

      const headerEnd = this.buffer.indexOf('\n')
      if (headerEnd < 0) {
        if (final) {
          const rest = this.buffer
          this.buffer = ''
          this.emit(rest)
        }
        return
      }

      const close = this.buffer.indexOf('\n```', headerEnd + 1)
      if (close < 0) {
        if (final) {
          const rest = this.buffer
          this.buffer = ''
          this.emit(rest)
        }
        return
      }

      const info = this.buffer.slice(FILE_FENCE.length, headerEnd)
      const body = this.buffer.slice(headerEnd + 1, close)
      let end = close + 4
      if (this.buffer[end] === '\r') end += 1
      if (this.buffer[end] === '\n') end += 1

      const block = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end)

      const parsed = this.saved < MAX_FILES ? parseBlock(info, body, this.saved + 1) : null
      if (!parsed) {
        this.emit(block)
        continue
      }
      this.saved += 1
      this.enqueueSave(parsed.name, parsed.data, parsed.kind)
    }
  }
}

export function chatArtifactPrompt(): string {
  return t("交付文件：当需要给用户返回图片、图表、PDF、表格或其他文件时，在正文之后使用文件块，文件内容用 Base64（单文件不超过 20MB，一次最多 8 个）： ```zotagent-file name=\"figure.png\" mime=\"image/png\" <文件的 Base64 内容> ``` 纯文本文件也可以写成 ```zotagent-file name=\"notes.md\" encoding=\"text\"``` 后直接跟正文。不要在正文里粘贴单独的 Base64 或 data URI；普通回答仍使用 Markdown。")
}
