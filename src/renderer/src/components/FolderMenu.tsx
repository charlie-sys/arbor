import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './folders.css'

export default function FolderMenu({ anchor, onClose, children }: {
  anchor: HTMLButtonElement; onClose(): void; children: ReactNode
}) {
  const menu = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const sidebar = !!anchor.closest('.sidebar')
  const cancelClose = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const scheduleClose = () => {
    cancelClose()
    timer.current = window.setTimeout(onClose, 160)
  }
  useLayoutEffect(() => {
    const place = () => {
      const popup = menu.current
      if (!popup || !anchor.isConnected || !anchor.getClientRects().length) { onClose(); return }
      const rect = anchor.getBoundingClientRect()
      const box = popup.getBoundingClientRect()
      const left = Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8))
      const below = rect.bottom + 5
      const top = Math.max(8, Math.min(below + box.height <= window.innerHeight - 8 ? below : rect.top - box.height - 5, window.innerHeight - box.height - 8))
      setPosition(previous => previous?.left === left && previous.top === top ? previous : { left, top })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(anchor)
    if (menu.current) observer.observe(menu.current)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor, onClose])
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!anchor.contains(target) && !menu.current?.contains(target)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); anchor.focus() }
      if (event.key === 'Tab') onClose()
    }
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) onClose()
    }
    anchor.addEventListener('pointerenter', cancelClose)
    anchor.addEventListener('pointerleave', scheduleClose)
    const popup = menu.current
    popup?.addEventListener('pointerenter', cancelClose)
    popup?.addEventListener('pointerleave', scheduleClose)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    return () => {
      cancelClose()
      anchor.removeEventListener('pointerenter', cancelClose)
      anchor.removeEventListener('pointerleave', scheduleClose)
      popup?.removeEventListener('pointerenter', cancelClose)
      popup?.removeEventListener('pointerleave', scheduleClose)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [anchor, onClose])
  return createPortal(<div ref={menu} role="menu" className="folder-action-list" data-web-overlay data-sidebar-overlay={sidebar ? '' : undefined} data-surface={sidebar ? 'sidebar' : 'panel'} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }} onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    items[next]?.focus()
  }}>{children}</div>, document.body)
}
