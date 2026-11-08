import type { PetView } from '@shared/pet'

export function startPetActivity(): () => void {
  let keys = 0
  let moved = 0
  let scrolled = false
  let lastX = Number.NaN
  let lastY = Number.NaN
  let lastFlush = 0

  const flush = (): void => {
    const now = Date.now()
    if (now - lastFlush < 400) return
    lastFlush = now
    if (keys > 0) {
      window.api.pet.signal({ type: 'keys', keys })
      keys = 0
    }
    if (moved > 0) {
      window.api.pet.signal({ type: 'pointer', moved })
      moved = 0
    }
    if (scrolled) {
      window.api.pet.signal({ type: 'scroll' })
      scrolled = false
    }
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target
    const editing =
      target instanceof Element &&
      Boolean(target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'))
    if (editing || event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter') {
      keys += 1
    }
  }

  const onComposition = (): void => {
    keys += 1
  }

  const onMove = (event: MouseEvent): void => {
    if (Number.isNaN(lastX)) {
      lastX = event.clientX
      lastY = event.clientY
      return
    }
    moved += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY)
    lastX = event.clientX
    lastY = event.clientY
  }

  const onScroll = (): void => {
    scrolled = true
  }

  window.addEventListener('keydown', onKey, true)
  window.addEventListener('compositionupdate', onComposition, true)
  window.addEventListener('mousemove', onMove, { passive: true })
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  const timer = window.setInterval(flush, 500)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('compositionupdate', onComposition, true)
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('scroll', onScroll, true)
  }
}

export function reportPetView(view: string): void {
  window.api.pet.signal({ type: 'context', view: view as PetView })
}
