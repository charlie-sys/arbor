import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import type { Highlight, HighlightRect } from '@shared/types'
import type { PdfOutlineItem, PdfSelection, PdfViewerHandle } from './PdfViewer'
import { Markdown } from '../ui'

interface Props {
  docId: string
  markdown: boolean
  initialPage: number
  highlights: Highlight[]
  flashHighlightId?: string | null
  onPageChange(page: number): void
  onPagesLoaded(count: number): void
  onSelection(selection: PdfSelection | null): void
  onHighlightClick(highlight: Highlight, position: { left: number; top: number }): void
  onOutline(items: PdfOutlineItem[]): void
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function buildOutline(pages: string[]): PdfOutlineItem[] {
  const items: PdfOutlineItem[] = []
  pages.forEach((text, index) => {
    for (const line of text.split('\n')) {
      const match = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/)
      if (!match) continue
      const title = match[2].trim()
      if (title) items.push({ title, page: index + 1, children: [] })
    }
  })
  return items.slice(0, 300)
}

const TextViewer = forwardRef<PdfViewerHandle, Props>(function TextViewer(props, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<string[]>([])
  const pageRef = useRef(props.initialPage || 1)
  const pendingPageRef = useRef<number | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const [page, setPage] = useState(props.initialPage || 1)
  const [scale, setScale] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const callbacks = useRef(props)
  callbacks.current = props

  const goToPage = useCallback((value: number): void => {
    const total = pagesRef.current.length
    const requested = Math.max(1, Math.round(value))
    if (!total) {
      pendingPageRef.current = requested
      return
    }
    pendingPageRef.current = null
    const target = Math.min(total, Math.max(1, requested))
    pageRef.current = target
    setPage(target)
    callbacks.current.onPageChange(target)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    let cancelled = false
    pagesRef.current = []
    setPages([])
    setLoading(true)
    setError('')
    void window.api.library
      .getTexts(props.docId)
      .then((result) => {
        if (cancelled) return
        if (!result.length) {
          setError('尚未提取到正文')
          callbacks.current.onPagesLoaded(0)
          callbacks.current.onOutline([])
          return
        }
        pagesRef.current = result
        setPages(result)
        callbacks.current.onPagesLoaded(result.length)
        callbacks.current.onOutline(props.markdown ? buildOutline(result) : [])
        goToPage(pendingPageRef.current ?? (props.initialPage || 1))
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '读取正文失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.docId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [page])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const step = event.deltaY < 0 ? 0.1 : -0.1
      setScale((value) => Math.min(1.8, Math.max(0.7, Number((value + step).toFixed(2)))))
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      goToPage,
      nextPage: () => goToPage(pageRef.current + 1),
      prevPage: () => goToPage(pageRef.current - 1),
      zoomIn: () => setScale((value) => Math.min(1.8, Number((value + 0.1).toFixed(2)))),
      zoomOut: () => setScale((value) => Math.max(0.7, Number((value - 0.1).toFixed(2)))),
      fitWidth: () => setScale(1)
    }),
    [goToPage]
  )

  const handleMouseUp = (): void => {
    window.setTimeout(() => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      const content = contentRef.current
      if (!selection || !text || !selection.rangeCount || !content) {
        callbacks.current.onSelection(null)
        return
      }
      const range = selection.getRangeAt(0)
      if (!content.contains(range.commonAncestorContainer)) {
        callbacks.current.onSelection(null)
        return
      }
      const box = content.getBoundingClientRect()
      if (box.width < 2 || box.height < 2) {
        callbacks.current.onSelection(null)
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) {
        callbacks.current.onSelection(null)
        return
      }
      const rects: HighlightRect[] = []
      for (const item of Array.from(range.getClientRects())) {
        if (item.width < 2 || item.height < 2) continue
        const top = Math.max(item.top, box.top)
        const bottom = Math.min(item.bottom, box.bottom)
        const left = Math.max(item.left, box.left)
        const right = Math.min(item.right, box.right)
        if (bottom - top < 2 || right - left < 2) continue
        rects.push({
          x: clamp01((left - box.left) / box.width),
          y: clamp01((top - box.top) / box.height),
          width: clamp01((right - left) / box.width),
          height: clamp01((bottom - top) / box.height)
        })
      }
      callbacks.current.onSelection({
        text,
        page: pageRef.current,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        rects
      })
    }, 10)
  }

  const currentText = pages[page - 1] ?? ''
  const pageHighlights = props.highlights.filter((highlight) => highlight.page === page)

  return (
    <div className="text-doc-wrap">
      <div
        className="text-doc-scroll"
        ref={scrollRef}
        onMouseUp={handleMouseUp}
        onScroll={() => callbacks.current.onSelection(null)}
      >
        {currentText && (
          <div className="text-doc-sheet">
            <div className="text-doc-content" ref={contentRef} style={{ fontSize: `${16 * scale}px` }}>
              {props.markdown ? (
                <Markdown>{currentText}</Markdown>
              ) : (
                <div className="text-doc-plain">{currentText}</div>
              )}
              <div className="text-doc-highlight-layer">
                {pageHighlights.flatMap((highlight) =>
                  highlight.rects.map((rect, index) => (
                    <div
                      key={`${highlight.id}-${index}`}
                      className={`pdf-highlight hl-${highlight.color}${
                        props.flashHighlightId === highlight.id ? ' flash' : ''
                      }`}
                      style={{
                        left: `${rect.x * 100}%`,
                        top: `${rect.y * 100}%`,
                        width: `${rect.width * 100}%`,
                        height: `${rect.height * 100}%`
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        callbacks.current.onHighlightClick(highlight, {
                          left: event.clientX,
                          top: event.clientY
                        })
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {loading && (
        <div className="pdf-overlay">
          <Loader2 size={22} className="spin" />
          <span>正在加载正文…</span>
        </div>
      )}
      {error && (
        <div className="pdf-overlay error">
          <TriangleAlert size={22} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
})

export default TextViewer
