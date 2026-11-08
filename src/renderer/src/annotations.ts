import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AnnotationPoint,
  DocumentAnnotations,
  InkStroke,
  StickyColor,
  StickyNote,
  StickyNoteKind
} from '@shared/types'

export const STICKY_COLORS: StickyColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']

export const INK_COLORS = [
  { value: '#3f342d', label: '炭黑' },
  { value: '#c65f4a', label: '朱红' },
  { value: '#5b7fa3', label: '靛蓝' },
  { value: '#6d8a5c', label: '松绿' },
  { value: '#c9a227', label: '赭黄' }
]

export const NIGHT_INK_COLORS = [
  { value: '#f1ece2', label: '米白' },
  { value: '#e8a09a', label: '浅红' },
  { value: '#9ec1e0', label: '浅蓝' },
  { value: '#b4d3a4', label: '浅绿' },
  { value: '#f0d27a', label: '浅黄' }
]

export const INK_WIDTHS = [
  { value: 0.0025, label: '细' },
  { value: 0.0045, label: '中' },
  { value: 0.0075, label: '粗' }
]

const UNDO_LIMIT = 50

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function emptyDoc(docId: string): DocumentAnnotations {
  return { version: 1, docId, notes: [], strokes: [], updatedAt: Date.now() }
}

export function useDocumentAnnotations(
  docId: string,
  onError?: (message: string) => void
): {
  annotations: DocumentAnnotations
  loading: boolean
  canUndo: boolean
  canRedo: boolean
  addNote(input: {
    page: number
    kind: StickyNoteKind
    color: StickyColor
    x: number
    y: number
    text: string
  }): StickyNote
  updateNote(id: string, patch: Partial<Pick<StickyNote, 'kind' | 'color' | 'x' | 'y' | 'text' | 'resolved'>>): void
  removeNote(id: string): void
  addStroke(input: {
    page: number
    tool: InkStroke['tool']
    color: string
    width: number
    points: AnnotationPoint[]
  }): InkStroke | null
  removeStroke(id: string): void
  clearStrokes(page: number): void
  undo(): void
  redo(): void
} {
  const [annotations, setAnnotations] = useState<DocumentAnnotations>(() => emptyDoc(docId))
  const dataRef = useRef(annotations)
  const [loading, setLoading] = useState(true)
  const loadedRef = useRef(false)
  const undoRef = useRef<DocumentAnnotations[]>([])
  const redoRef = useRef<DocumentAnnotations[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const errorRef = useRef(onError)
  errorRef.current = onError

  const syncHistory = useCallback(() => {
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(redoRef.current.length > 0)
  }, [])

  const persist = useCallback(
    (next: DocumentAnnotations) => {
      void window.api.annotations.save(docId, next).catch((error: Error) => {
        errorRef.current?.(error.message)
      })
    },
    [docId]
  )

  const apply = useCallback(
    (next: DocumentAnnotations, record = true) => {
      if (record) {
        undoRef.current.push(dataRef.current)
        if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift()
        redoRef.current = []
      }
      const stamped = { ...next, updatedAt: Date.now() }
      dataRef.current = stamped
      setAnnotations(stamped)
      syncHistory()
      persist(stamped)
    },
    [persist, syncHistory]
  )

  useEffect(() => {
    let cancelled = false
    loadedRef.current = false
    undoRef.current = []
    redoRef.current = []
    syncHistory()
    setLoading(true)
    setAnnotations(emptyDoc(docId))
    dataRef.current = emptyDoc(docId)
    void window.api.annotations
      .load(docId)
      .then((loaded) => {
        if (cancelled) return
        const normalized: DocumentAnnotations = {
          version: 1,
          docId,
          notes: Array.isArray(loaded.notes) ? loaded.notes : [],
          strokes: Array.isArray(loaded.strokes) ? loaded.strokes : [],
          updatedAt: loaded.updatedAt || Date.now()
        }
        dataRef.current = normalized
        setAnnotations(normalized)
        loadedRef.current = true
        setLoading(false)
      })
      .catch((error: Error) => {
        if (cancelled) return
        setLoading(false)
        errorRef.current?.(error.message)
      })
    return () => {
      cancelled = true
      if (loadedRef.current) void window.api.annotations.save(docId, dataRef.current).catch(() => undefined)
    }
  }, [docId, syncHistory])

  const addNote = useCallback(
    (input: { page: number; kind: StickyNoteKind; color: StickyColor; x: number; y: number; text: string }) => {
      const now = Date.now()
      const note: StickyNote = {
        id: uid(),
        page: Math.max(1, Math.round(input.page)),
        kind: input.kind,
        color: input.color,
        x: Math.min(1, Math.max(0, input.x)),
        y: Math.min(1, Math.max(0, input.y)),
        text: input.text,
        resolved: false,
        createdAt: now,
        updatedAt: now
      }
      apply({ ...dataRef.current, notes: [...dataRef.current.notes, note] })
      return note
    },
    [apply]
  )

  const updateNote = useCallback(
    (id: string, patch: Partial<Pick<StickyNote, 'kind' | 'color' | 'x' | 'y' | 'text' | 'resolved'>>) => {
      const current = dataRef.current
      if (!current.notes.some((note) => note.id === id)) return
      apply({
        ...current,
        notes: current.notes.map((note) =>
          note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note
        )
      })
    },
    [apply]
  )

  const removeNote = useCallback(
    (id: string) => {
      const current = dataRef.current
      if (!current.notes.some((note) => note.id === id)) return
      apply({ ...current, notes: current.notes.filter((note) => note.id !== id) })
    },
    [apply]
  )

  const addStroke = useCallback(
    (input: { page: number; tool: InkStroke['tool']; color: string; width: number; points: AnnotationPoint[] }) => {
      if (input.points.length < 2) return null
      const stroke: InkStroke = {
        id: uid(),
        page: Math.max(1, Math.round(input.page)),
        tool: input.tool,
        color: input.color,
        width: input.width,
        points: input.points,
        createdAt: Date.now()
      }
      apply({ ...dataRef.current, strokes: [...dataRef.current.strokes, stroke] })
      return stroke
    },
    [apply]
  )

  const removeStroke = useCallback(
    (id: string) => {
      const current = dataRef.current
      if (!current.strokes.some((stroke) => stroke.id === id)) return
      apply({ ...current, strokes: current.strokes.filter((stroke) => stroke.id !== id) })
    },
    [apply]
  )

  const clearStrokes = useCallback(
    (page: number) => {
      const current = dataRef.current
      const strokes = current.strokes.filter((stroke) => stroke.page !== page)
      if (strokes.length === current.strokes.length) return
      apply({ ...current, strokes })
    },
    [apply]
  )

  const undo = useCallback(() => {
    const previous = undoRef.current.pop()
    if (!previous) return
    redoRef.current.push(dataRef.current)
    dataRef.current = previous
    setAnnotations(previous)
    syncHistory()
    persist(previous)
  }, [persist, syncHistory])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(dataRef.current)
    dataRef.current = next
    setAnnotations(next)
    syncHistory()
    persist(next)
  }, [persist, syncHistory])

  return {
    annotations,
    loading,
    canUndo,
    canRedo,
    addNote,
    updateNote,
    removeNote,
    addStroke,
    removeStroke,
    clearStrokes,
    undo,
    redo
  }
}

function distanceToSegment(p: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (!dx && !dy) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Ramer–Douglas–Peucker，降低墨迹存储体积 */
export function simplifyPoints(points: AnnotationPoint[], tolerance = 0.0012): AnnotationPoint[] {
  if (points.length <= 2) return points
  let maxDistance = 0
  let index = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i], first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }
  if (maxDistance <= tolerance) return [first, last]
  const left = simplifyPoints(points.slice(0, index + 1), tolerance)
  const right = simplifyPoints(points.slice(index), tolerance)
  return [...left.slice(0, -1), ...right]
}

/** 用中点二次贝塞尔生成平滑路径，坐标为页面像素 */
export function smoothPath(points: AnnotationPoint[], width: number, height: number): string {
  if (!points.length) return ''
  const px = points.map((point) => ({ x: point.x * width, y: point.y * height }))
  if (px.length === 1) return `M ${px[0].x} ${px[0].y}`
  let d = `M ${px[0].x} ${px[0].y}`
  for (let i = 1; i < px.length - 1; i++) {
    const midX = (px[i].x + px[i + 1].x) / 2
    const midY = (px[i].y + px[i + 1].y) / 2
    d += ` Q ${px[i].x} ${px[i].y} ${midX} ${midY}`
  }
  const last = px[px.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}
