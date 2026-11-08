import { promises as fs } from 'fs'
import path from 'path'
import { store } from './store'
import type { DocumentAnnotations, InkStroke, StickyNote } from '../shared/types'

const WRITE_DELAY = 150
const MAX_TEXT = 5000
const MAX_POINTS = 5000

const pending = new Map<string, DocumentAnnotations>()
const timers = new Map<string, NodeJS.Timeout>()
const chains = new Map<string, Promise<void>>()

function annotationsDir(): string {
  return path.join(store.root, 'annotations')
}

function filePath(docId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(docId)) throw new Error('Invalid document id')
  return path.join(annotationsDir(), `${docId}.json`)
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, number))
}

function normalizeNote(note: StickyNote): StickyNote | null {
  if (!note || typeof note.id !== 'string') return null
  const page = Math.max(1, Math.round(Number(note.page) || 1))
  return {
    id: note.id,
    page,
    kind: note.kind === 'question' ? 'question' : 'idea',
    color: ['yellow', 'green', 'blue', 'pink', 'purple'].includes(note.color) ? note.color : 'yellow',
    x: clamp(note.x, 0, 1, 0.5),
    y: clamp(note.y, 0, 1, 0.5),
    text: String(note.text ?? '').slice(0, MAX_TEXT),
    resolved: Boolean(note.resolved),
    createdAt: Number(note.createdAt) || Date.now(),
    updatedAt: Number(note.updatedAt) || Date.now()
  }
}

function normalizeStroke(stroke: InkStroke): InkStroke | null {
  if (!stroke || typeof stroke.id !== 'string' || !Array.isArray(stroke.points)) return null
  const points = stroke.points
    .slice(0, MAX_POINTS)
    .map((point) => ({ x: clamp(point?.x, 0, 1, 0), y: clamp(point?.y, 0, 1, 0) }))
  if (points.length < 2) return null
  return {
    id: stroke.id,
    page: Math.max(1, Math.round(Number(stroke.page) || 1)),
    tool: stroke.tool === 'marker' ? 'marker' : 'pen',
    color: typeof stroke.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(stroke.color) ? stroke.color : '#3f342d',
    width: clamp(stroke.width, 0.0005, 0.05, 0.0035),
    points,
    createdAt: Number(stroke.createdAt) || Date.now()
  }
}

function normalize(docId: string, data: DocumentAnnotations): DocumentAnnotations {
  return {
    version: 1,
    docId,
    notes: Array.isArray(data?.notes) ? data.notes.map(normalizeNote).filter(Boolean) as StickyNote[] : [],
    strokes: Array.isArray(data?.strokes)
      ? data.strokes.map(normalizeStroke).filter(Boolean) as InkStroke[]
      : [],
    updatedAt: Date.now()
  }
}

export function emptyAnnotations(docId: string): DocumentAnnotations {
  return { version: 1, docId, notes: [], strokes: [], updatedAt: Date.now() }
}

async function writeNow(docId: string, data: DocumentAnnotations): Promise<void> {
  await fs.mkdir(annotationsDir(), { recursive: true })
  const target = filePath(docId)
  const temp = `${target}.${process.pid}.tmp`
  await fs.writeFile(temp, JSON.stringify(data), 'utf-8')
  await fs.rename(temp, target)
}

function enqueue(docId: string, data: DocumentAnnotations): Promise<void> {
  const previous = chains.get(docId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => writeNow(docId, data))
    .catch((error) => {
      console.error('[annotations] save failed', error)
    })
  chains.set(docId, next)
  void next.finally(() => {
    if (chains.get(docId) === next) chains.delete(docId)
  })
  return next
}

function flushDoc(docId: string): Promise<void> {
  const timer = timers.get(docId)
  if (timer) {
    clearTimeout(timer)
    timers.delete(docId)
  }
  const data = pending.get(docId)
  pending.delete(docId)
  if (!data) return chains.get(docId) ?? Promise.resolve()
  return enqueue(docId, data)
}

export async function loadAnnotations(docId: string): Promise<DocumentAnnotations> {
  // 先落盘尚未写入的最近一次修改，避免独立面板或快速重载读到旧快照
  await flushDoc(docId)
  try {
    const raw = await fs.readFile(filePath(docId), 'utf-8')
    const parsed = JSON.parse(raw) as DocumentAnnotations
    return normalize(docId, parsed)
  } catch {
    return emptyAnnotations(docId)
  }
}

export function saveAnnotations(docId: string, data: DocumentAnnotations): Promise<void> {
  const normalized = normalize(docId, data)
  const previous = pending.get(docId)
  pending.set(docId, {
    ...normalized,
    // 保留首次进入队列的时间，连续保存时避免 updatedAt 反复变化
    updatedAt: previous?.updatedAt ?? normalized.updatedAt
  })
  if (!timers.has(docId)) {
    const timer = setTimeout(() => {
      timers.delete(docId)
      void flushDoc(docId)
    }, WRITE_DELAY)
    timer.unref?.()
    timers.set(docId, timer)
  }
  return Promise.resolve()
}

export async function removeAnnotations(docId: string): Promise<void> {
  const timer = timers.get(docId)
  if (timer) clearTimeout(timer)
  timers.delete(docId)
  pending.delete(docId)
  await (chains.get(docId) ?? Promise.resolve()).catch(() => undefined)
  await fs.rm(filePath(docId), { force: true }).catch(() => undefined)
}

export async function flushAnnotations(): Promise<void> {
  const ids = new Set([...pending.keys(), ...chains.keys(), ...timers.keys()])
  await Promise.all([...ids].map((docId) => flushDoc(docId)))
}
