import { useRef, useState } from 'react'

export default function PaneResizer({
  value,
  onChange,
  min,
  max,
  invert = false,
  label = '拖动调整宽度'
}: {
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  invert?: boolean
  label?: string
}): React.JSX.Element {
  const start = useRef<{ x: number; value: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={`pane-resizer${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      title={label}
      onPointerDown={(event) => {
        event.preventDefault()
        start.current = { x: event.clientX, value }
        setDragging(true)
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // synthetic pointer events may not have an active pointer
        }
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        const delta = (event.clientX - start.current.x) * (invert ? -1 : 1)
        const next = start.current.value + delta
        onChange(Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? 0, next)))
      }}
      onPointerUp={(event) => {
        start.current = null
        setDragging(false)
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // ignore synthetic pointer cleanup
        }
      }}
      onPointerCancel={() => {
        start.current = null
        setDragging(false)
      }}
    />
  )
}
