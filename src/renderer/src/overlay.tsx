import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

interface Point {
  x: number
  y: number
}

function rectOf(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

function Overlay(): React.JSX.Element {
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)
  const [done, setDone] = useState(false)
  const dragging = useRef(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void window.api.overlay.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onMouseDown = (event: React.MouseEvent): void => {
    if (done) return
    if (event.button !== 0) {
      void window.api.overlay.cancel()
      return
    }
    dragging.current = true
    setStart({ x: event.clientX, y: event.clientY })
    setCurrent({ x: event.clientX, y: event.clientY })
  }

  const onMouseMove = (event: React.MouseEvent): void => {
    if (!dragging.current || done) return
    setCurrent({ x: event.clientX, y: event.clientY })
  }

  const onMouseUp = (): void => {
    if (!dragging.current || !start || !current || done) return
    dragging.current = false
    const rect = rectOf(start, current)
    if (rect.width < 6 || rect.height < 6) {
      void window.api.overlay.cancel()
      return
    }
    setDone(true)
    void window.api.overlay.select(rect)
  }

  const rect = start && current ? rectOf(start, current) : null

  return (
    <div
      style={{ position: 'fixed', inset: 0, cursor: 'crosshair' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.api.overlay.cancel()
      }}
    >
      {!rect && (
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(17, 24, 39, 0.88)',
            color: '#e8eefc',
            padding: '10px 18px',
            borderRadius: 10,
            fontSize: 13,
            letterSpacing: 0.2,
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.12)',
            fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
            pointerEvents: 'none'
          }}
        >
          拖拽框选需要翻译的区域 · Esc 或右键取消
        </div>
      )}
      {rect && (
        <>
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              border: '1.5px solid #4f8cff',
              background: 'rgba(79, 140, 255, 0.08)',
              boxShadow: '0 0 0 9999px rgba(8, 12, 20, 0.35)',
              pointerEvents: 'none'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y + rect.height + 8,
              background: 'rgba(17, 24, 39, 0.9)',
              color: '#dbe7ff',
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'Consolas, monospace',
              pointerEvents: 'none'
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}
      {done && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(10, 14, 22, 0.45)',
            color: '#dbe7ff',
            fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
            fontSize: 14,
            pointerEvents: 'none'
          }}
        >
          正在截取并翻译…
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Overlay />)
