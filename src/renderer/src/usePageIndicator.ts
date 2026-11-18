import { useCallback, useEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import './pageIndicator.css'

/** Transient navigation cue only: never creates a saved annotation or alters document content. */
export function usePageIndicator() {
  const pending = useRef<number | null>(null)
  const active = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    active.current?.remove()
    active.current = null
    pending.current = null
  }, [])
  const request = useCallback((page: number) => {
    clear()
    pending.current = page
  }, [clear])
  const show = useCallback((host: HTMLElement | null | undefined, page: number) => {
    if (pending.current !== page || !host?.isConnected || host.getBoundingClientRect().width <= 0) return
    const marker = document.createElement('div')
    marker.className = 'reference-page-indicator'
    marker.dataset.referencePage = String(page)
    marker.setAttribute('role', 'status')
    marker.setAttribute('aria-live', 'polite')
    const label = document.createElement('span')
    label.textContent = t('引用位置 · 第 {0} 页', [page])
    marker.append(label)
    host.append(marker)
    active.current = marker
    pending.current = null
    timer.current = setTimeout(clear, 2800)
  }, [clear])
  useEffect(() => clear, [clear])
  return { pending, request, show, clear }
}
