import { useEffect, useRef, useState } from 'react'
import { Check, HelpCircle, Lightbulb } from 'lucide-react'
import type { AnnotationPoint, InkStroke, StickyNote } from '@shared/types'
import { simplifyPoints, smoothPath } from '../annotations'

export type AnnotationTool = 'select' | 'note' | 'pen' | 'marker' | 'eraser'

interface Props {
  page: number
  notes: StickyNote[]
  strokes: InkStroke[]
  tool: AnnotationTool
  active: boolean
  inkColor: string
  inkWidth: number
  flashNoteId?: string | null
  onPlaceNote(x: number, y: number, position: { left: number; top: number }): void
  onNoteClick(note: StickyNote, position: { left: number; top: number }): void
  onNoteMove(id: string, x: number, y: number): void
  onStroke(input: { page: number; tool: 'pen' | 'marker'; color: string; width: number; points: AnnotationPoint[] }): void
  onErase(id: string): void
}

interface Size {
  width: number
  height: number
}

interface DragState {
  id: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  moved: boolean
  rect: DOMRect
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function pointOf(event: React.PointerEvent, rect: DOMRect): AnnotationPoint {
  return {
    x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height))
  }
}

function distance(a: AnnotationPoint, b: AnnotationPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function distanceToSegment(p: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (!dx && !dy) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export default function PageAnnotationLayer(props: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const livePathRef = useRef<SVGPathElement>(null)
  const pointsRef = useRef<AnnotationPoint[]>([])
  const drawingRef = useRef(false)
  const dragRef = useRef<DragState | null>(null)
  const dragListenersRef = useRef(false)
  const erasedRef = useRef(new Set<string>())
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null)
  const [hoverStroke, setHoverStroke] = useState<string | null>(null)

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const measure = (): void => {
      const rect = node.getBoundingClientRect()
      setSize((prev) =>
        Math.abs(prev.width - rect.width) > 0.5 || Math.abs(prev.height - rect.height) > 0.5
          ? { width: rect.width, height: rect.height }
          : prev
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (drawingRef.current) {
      drawingRef.current = false
      pointsRef.current = []
      if (livePathRef.current) livePathRef.current.setAttribute('d', '')
    }
  }, [props.tool, props.active])

  const updateLivePath = (): void => {
    const path = livePathRef.current
    if (!path) return
    path.setAttribute('d', smoothPath(pointsRef.current, size.width || 1, size.height || 1))
  }

  const hitStroke = (point: AnnotationPoint): InkStroke | null => {
    const threshold = Math.max(7 / Math.max(1, size.width), 0.002)
    for (let i = props.strokes.length - 1; i >= 0; i--) {
      const stroke = props.strokes[i]
      if (stroke.page !== props.page) continue
      if (stroke.points.some((p) => distance(p, point) <= Math.max(threshold, stroke.width * 1.5))) {
        return stroke
      }
      for (let j = 1; j < stroke.points.length; j++) {
        if (distanceToSegment(point, stroke.points[j - 1], stroke.points[j]) <= Math.max(threshold, stroke.width * 1.5)) {
          return stroke
        }
      }
    }
    return null
  }

  const eraseAt = (event: React.PointerEvent): void => {
    const node = rootRef.current
    if (!node) return
    const point = pointOf(event, node.getBoundingClientRect())
    const hit = hitStroke(point)
    if (!hit) {
      if (hoverStroke) setHoverStroke(null)
      return
    }
    if (erasedRef.current.has(hit.id)) return
    erasedRef.current.add(hit.id)
    props.onErase(hit.id)
  }

  const handleCapturePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    if (props.tool === 'note') {
      const point = pointOf(event, rect)
      props.onPlaceNote(point.x, point.y, {
        left: Math.min(Math.max(12, event.clientX), window.innerWidth - 320),
        top: Math.min(Math.max(12, event.clientY), window.innerHeight - 360)
      })
      return
    }
    if (props.tool === 'eraser') {
      erasedRef.current = new Set()
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      eraseAt(event)
      return
    }
    if (props.tool === 'pen' || props.tool === 'marker') {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      const point = pointOf(event, rect)
      drawingRef.current = true
      pointsRef.current = [point]
      updateLivePath()
    }
  }

  const handleCapturePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (props.tool === 'eraser') {
      eraseAt(event)
      return
    }
    if (!drawingRef.current) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const point = pointOf(event, rect)
    const last = pointsRef.current[pointsRef.current.length - 1]
    if (last && distance(last, point) < 0.0006) return
    pointsRef.current.push(point)
    updateLivePath()
  }

  const handleCapturePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (props.tool === 'eraser') {
      erasedRef.current = new Set()
      setHoverStroke(null)
      return
    }
    if (!drawingRef.current) return
    event.preventDefault()
    event.stopPropagation()
    drawingRef.current = false
    const raw = pointsRef.current
    pointsRef.current = []
    if (livePathRef.current) livePathRef.current.setAttribute('d', '')
    if (!raw.length) return
    const points = raw.length === 1 ? [raw[0], { x: raw[0].x + 0.0001, y: raw[0].y + 0.0001 }] : simplifyPoints(raw)
    props.onStroke({
      page: props.page,
      tool: props.tool === 'marker' ? 'marker' : 'pen',
      color: props.inkColor,
      width: props.inkWidth,
      points
    })
  }

  const startNoteDrag = (event: React.PointerEvent<HTMLButtonElement>, note: StickyNote): void => {
    if (event.button !== 0) return
    if (props.tool === 'pen' || props.tool === 'marker' || props.tool === 'eraser') return
    event.preventDefault()
    event.stopPropagation()
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      id: note.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: note.x,
      y: note.y,
      moved: false,
      rect
    }
    setDragging({ id: note.id, x: note.x, y: note.y })
  }

  const moveNoteDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) {
      drag.moved = true
    }
    if (!drag.moved) return
    const x = clamp01((event.clientX - drag.rect.left) / Math.max(1, drag.rect.width))
    const y = clamp01((event.clientY - drag.rect.top) / Math.max(1, drag.rect.height))
    drag.x = x
    drag.y = y
    setDragging({ id: drag.id, x, y })
  }

  const endNoteDrag = (event: React.PointerEvent<HTMLButtonElement>, note: StickyNote): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = null
    setDragging(null)
    if (drag.moved) {
      props.onNoteMove(note.id, drag.x, drag.y)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    props.onNoteClick(note, { left: rect.left + rect.width / 2, top: rect.bottom })
  }

  // 拖动时指针可能移出按钮，监听 window 事件保证松开后结束
  useEffect(() => {
    if (!dragging || dragListenersRef.current) return
    dragListenersRef.current = true
    const stop = (): void => {
      const drag = dragRef.current
      if (drag?.moved) props.onNoteMove(drag.id, drag.x, drag.y)
      dragRef.current = null
      setDragging(null)
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      dragListenersRef.current = false
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging, props])

  const pageStrokes = props.strokes.filter((stroke) => stroke.page === props.page)
  const pageNotes = props.notes.filter((note) => note.page === props.page)
  const interactive = props.active && props.tool !== 'select'
  const capture = interactive ? props.tool : null

  return (
    <div
      ref={rootRef}
      className={`page-annotation-layer mode-${props.tool}${props.active ? ' active' : ''}`}
      onMouseUp={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <svg
        className="annotation-ink-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
        aria-hidden="true"
      >
        {pageStrokes.map((stroke) => (
          <path
            key={stroke.id}
            className={`annotation-ink${stroke.tool === 'marker' ? ' marker' : ''}${
              hoverStroke === stroke.id ? ' erasing' : ''
            }`}
            d={smoothPath(stroke.points, size.width || 1, size.height || 1)}
            stroke={stroke.color}
            strokeWidth={Math.max(0.4, stroke.width * (size.width || 1))}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <path
          ref={livePathRef}
          className={`annotation-ink live${props.tool === 'marker' ? ' marker' : ''}`}
          stroke={props.inkColor}
          strokeWidth={Math.max(0.4, props.inkWidth * (size.width || 1))}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="annotation-note-layer">
        {pageNotes.map((note) => {
          const position = dragging?.id === note.id ? dragging : note
          return (
            <button
              key={note.id}
              type="button"
              className={`annotation-pin note-${note.color}${note.resolved ? ' resolved' : ''}${
                props.flashNoteId === note.id ? ' flash' : ''
              }`}
              style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
              title={note.text.slice(0, 120) || (note.kind === 'question' ? '问题' : '想法')}
              aria-label={`第 ${note.page} 页${note.kind === 'question' ? '问题' : '想法'}`}
              onPointerDown={(event) => startNoteDrag(event, note)}
              onPointerMove={moveNoteDrag}
              onPointerUp={(event) => endNoteDrag(event, note)}
              onMouseUp={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                // 键盘触发的点击没有指针位置，补一次打开编辑器
                if (event.detail === 0) {
                  const rect = event.currentTarget.getBoundingClientRect()
                  props.onNoteClick(note, { left: rect.left + rect.width / 2, top: rect.bottom })
                }
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {note.resolved ? (
                <Check size={14} />
              ) : note.kind === 'question' ? (
                <HelpCircle size={15} />
              ) : (
                <Lightbulb size={15} />
              )}
            </button>
          )
        })}
      </div>

      {capture && (
        <div
          className={`annotation-capture capture-${capture}`}
          onPointerDown={handleCapturePointerDown}
          onPointerMove={handleCapturePointerMove}
          onPointerUp={handleCapturePointerUp}
          onPointerCancel={handleCapturePointerUp}
          onMouseUp={(event) => event.stopPropagation()}
        />
      )}
    </div>
  )
}
