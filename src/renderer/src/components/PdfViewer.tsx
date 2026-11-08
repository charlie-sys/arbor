import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { EventBus, LinkTarget, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import { Loader2, TriangleAlert } from 'lucide-react'
import { pdfOptions } from '../pdf'
import type { Highlight, HighlightRect } from '@shared/types'
import { t } from '@shared/i18n'

export interface PdfSelection {
  text: string
  page: number
  rect: { left: number; top: number; right: number; bottom: number }
  rects: HighlightRect[]
}

export interface PdfOutlineItem {
  title: string
  page: number | null
  children: PdfOutlineItem[]
}

export interface PdfViewerHandle {
  goToPage(page: number): void
  nextPage(): void
  prevPage(): void
  zoomIn(): void
  zoomOut(): void
  fitWidth(): void
}

interface Props {
  docId: string
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

const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(props, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewerObj = useRef<any>(null)
  const loadingTaskRef = useRef<any>(null)
  const pageRef = useRef(props.initialPage || 1)
  const layersRef = useRef(new Map<number, HTMLDivElement>())
  const pendingPageRef = useRef<number | null>(null)
  const pagesReadyRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const callbacks = useRef(props)
  callbacks.current = props

  const paintHighlights = (): void => {
    const viewer = viewerObj.current
    if (!viewer) return
    const list = callbacks.current.highlights
    const pages = new Set(list.map((item) => item.page))
    for (const [page, layer] of layersRef.current) {
      if (!pages.has(page) || !layer.isConnected) {
        layer.remove()
        layersRef.current.delete(page)
      }
    }
    for (const page of pages) {
      let pageView: any
      try {
        pageView = viewer.getPageView(page - 1)
      } catch {
        continue
      }
      const pageDiv = pageView?.div as HTMLElement | undefined
      if (!pageDiv) continue
      let layer = layersRef.current.get(page)
      if (!layer) {
        layer = document.createElement('div')
        layer.className = 'pdf-highlight-layer'
        pageDiv.appendChild(layer)
        layersRef.current.set(page, layer)
      } else if (layer.parentElement !== pageDiv) {
        pageDiv.appendChild(layer)
      }
      layer.replaceChildren()
      for (const highlight of list) {
        if (highlight.page !== page) continue
        for (const rect of highlight.rects) {
          const el = document.createElement('div')
          el.className = `pdf-highlight hl-${highlight.color}`
          if (callbacks.current.flashHighlightId === highlight.id) el.classList.add('flash')
          el.style.left = `${rect.x * 100}%`
          el.style.top = `${rect.y * 100}%`
          el.style.width = `${rect.width * 100}%`
          el.style.height = `${rect.height * 100}%`
          el.dataset.highlightId = highlight.id
          layer.appendChild(el)
        }
      }
    }
  }

  const goToPage = (value: number): void => {
    const requested = Math.max(1, Math.round(value))
    const viewer = viewerObj.current
    const total = viewer?.pagesCount || 0
    // 文档尚未初始化完成时先记下目标页，pagesinit 时再应用，避免被 initialPage 覆盖
    if (!viewer || !pagesReadyRef.current || !total) {
      pendingPageRef.current = requested
      return
    }
    pendingPageRef.current = null
    const target = Math.min(total, requested)
    try {
      viewer.currentPageNumber = target
    } catch {
      pendingPageRef.current = target
      return
    }
    window.requestAnimationFrame(() => {
      if (viewerObj.current !== viewer) return
      const container = scrollRef.current
      const pageDiv = viewer.getPageView(target - 1)?.div as HTMLElement | undefined
      if (!container || !pageDiv || !pageDiv.offsetParent || container.clientHeight <= 0) return
      let offsetY = pageDiv.offsetTop + pageDiv.clientTop
      let parent = pageDiv.offsetParent as HTMLElement | null
      while (parent && parent !== container) {
        offsetY += parent.offsetTop
        parent = parent.offsetParent as HTMLElement | null
      }
      if (parent === container && Math.abs(container.scrollTop - offsetY) > 4) {
        container.scrollTop = offsetY
      }
    })
  }

  useImperativeHandle(ref, () => ({
    goToPage(page: number) {
      goToPage(page)
    },
    nextPage() {
      const viewer = viewerObj.current
      const current = viewer?.currentPageNumber || pageRef.current
      goToPage(current + 1)
    },
    prevPage() {
      const viewer = viewerObj.current
      const current = viewer?.currentPageNumber || pageRef.current
      goToPage(current - 1)
    },
    zoomIn() {
      const viewer = viewerObj.current
      if (!viewer) return
      viewer.currentScale = Math.min(4, viewer.currentScale * 1.15)
    },
    zoomOut() {
      const viewer = viewerObj.current
      if (!viewer) return
      viewer.currentScale = Math.max(0.3, viewer.currentScale / 1.15)
    },
    fitWidth() {
      const viewer = viewerObj.current
      if (!viewer) return
      viewer.currentScaleValue = 'page-width'
    }
  }))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    pendingPageRef.current = null
    pagesReadyRef.current = false
    layersRef.current.forEach((layer) => layer.remove())
    layersRef.current.clear()

    const init = async (): Promise<void> => {
      try {
        const task = pdfjsLib.getDocument(pdfOptions(window.api.library.pdfUrl(props.docId)) as never)
        loadingTaskRef.current = task
        const pdf = await task.promise
        if (cancelled) {
          await task.destroy()
          return
        }

        const loadOutline = async (): Promise<void> => {
          try {
            const raw = await pdf.getOutline()
            const resolvePage = async (dest: unknown): Promise<number | null> => {
              try {
                const explicit =
                  typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[] | null)
                if (!Array.isArray(explicit) || !explicit.length) return null
                const index = await pdf.getPageIndex(explicit[0] as never)
                return typeof index === 'number' ? index + 1 : null
              } catch {
                return null
              }
            }
            const walk = async (items: any[]): Promise<PdfOutlineItem[]> => {
              const result: PdfOutlineItem[] = []
              for (const item of items) {
                result.push({
                  title: String(item.title ?? '').trim() || t("未命名章节"),
                  page: await resolvePage(item.dest),
                  children: Array.isArray(item.items) && item.items.length ? await walk(item.items) : []
                })
              }
              return result
            }
            const outline = raw && raw.length ? await walk(raw) : []
            if (!cancelled) callbacks.current.onOutline(outline)
          } catch {
            if (!cancelled) callbacks.current.onOutline([])
          }
        }
        void loadOutline()

        const eventBus = new EventBus()
        const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK })
        const viewer = new PDFViewer({
          container: scrollRef.current as HTMLDivElement,
          viewer: viewportRef.current as HTMLDivElement,
          eventBus,
          linkService,
          textLayerMode: 1,
          annotationMode: 2
        })
        linkService.setViewer(viewer)
        viewer.setDocument(pdf)
        linkService.setDocument(pdf, null)
        viewerObj.current = viewer

        eventBus.on('pagechanging', (event: { pageNumber: number }) => {
          pageRef.current = event.pageNumber
          callbacks.current.onPageChange(event.pageNumber)
        })
        eventBus.on('pagerendered', () => paintHighlights())
        eventBus.on('scalechanging', () => window.requestAnimationFrame(paintHighlights))
        eventBus.on('pagesinit', () => {
          viewer.currentScaleValue = 'page-width'
          pagesReadyRef.current = true
          const pending = pendingPageRef.current ?? callbacks.current.initialPage ?? 1
          pendingPageRef.current = null
          viewer.currentPageNumber = Math.min(pending, pdf.numPages)
          callbacks.current.onPagesLoaded(pdf.numPages)
          if (!cancelled) setLoading(false)
          paintHighlights()
        })
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || t("PDF 加载失败"))
          setLoading(false)
        }
      }
    }

    void init()

    return () => {
      cancelled = true
      const viewer = viewerObj.current
      try {
        viewer?.setDocument(null)
      } catch {
        // ignore cleanup errors
      }
      viewerObj.current = null
      loadingTaskRef.current?.destroy?.()
      loadingTaskRef.current = null
      layersRef.current.forEach((layer) => layer.remove())
      layersRef.current.clear()
    }
  }, [props.docId])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      const viewer = viewerObj.current
      if (!viewer) return
      const delta = event.deltaY || event.deltaX
      if (!delta) return
      event.preventDefault()
      const oldScale = viewer.currentScale as number
      const factor = delta < 0 ? 1.12 : 1 / 1.12
      const nextScale = Math.min(4, Math.max(0.25, oldScale * factor))
      if (Math.abs(nextScale - oldScale) < 0.001) return

      const rect = container.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const contentX = (container.scrollLeft + pointerX) / oldScale
      const contentY = (container.scrollTop + pointerY) / oldScale
      viewer.currentScale = nextScale
      requestAnimationFrame(() => {
        container.scrollLeft = contentX * nextScale - pointerX
        container.scrollTop = contentY * nextScale - pointerY
      })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    paintHighlights()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.highlights, props.flashHighlightId])

  const handleMouseUp = (event: React.MouseEvent): void => {
    window.setTimeout(() => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      if (!selection || !text || selection.rangeCount === 0) {
        const hit = findHighlightAt(event.clientX, event.clientY)
        if (hit) {
          callbacks.current.onHighlightClick(hit, { left: event.clientX, top: event.clientY })
        } else {
          callbacks.current.onSelection(null)
        }
        return
      }
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) {
        callbacks.current.onSelection(null)
        return
      }
      const node = range.startContainer
      const element = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null
      const pageElement = element?.closest('.page') as HTMLElement | null
      const page = pageElement?.dataset.pageNumber ? Number(pageElement.dataset.pageNumber) : pageRef.current
      const textLayer = pageElement?.querySelector('.textLayer') as HTMLElement | null
      const pageRect = (textLayer ?? pageElement)?.getBoundingClientRect()
      const rects: HighlightRect[] = []
      if (pageRect && pageRect.width > 0 && pageRect.height > 0) {
        for (const item of Array.from(range.getClientRects())) {
          if (item.width < 2 || item.height < 2) continue
          const top = Math.max(item.top, pageRect.top)
          const bottom = Math.min(item.bottom, pageRect.bottom)
          if (bottom - top < 2) continue
          const left = Math.max(item.left, pageRect.left)
          const right = Math.min(item.right, pageRect.right)
          if (right - left < 2) continue
          rects.push({
            x: clamp01((left - pageRect.left) / pageRect.width),
            y: clamp01((top - pageRect.top) / pageRect.height),
            width: clamp01((right - left) / pageRect.width),
            height: clamp01((bottom - top) / pageRect.height)
          })
        }
      }
      callbacks.current.onSelection({
        text,
        page,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        rects
      })
    }, 10)
  }

  const findHighlightAt = (x: number, y: number): Highlight | null => {
    const target = document.elementFromPoint(x, y) as HTMLElement | null
    const pageElement = target?.closest('.page') as HTMLElement | null
    if (!pageElement) return null
    const pageNumber = Number(pageElement.dataset.pageNumber)
    if (!pageNumber) return null
    const textLayer = pageElement.querySelector('.textLayer') as HTMLElement | null
    const pageRect = (textLayer ?? pageElement).getBoundingClientRect()
    if (!pageRect.width || !pageRect.height) return null
    const nx = (x - pageRect.left) / pageRect.width
    const ny = (y - pageRect.top) / pageRect.height
    return (
      callbacks.current.highlights.find(
        (highlight) =>
          highlight.page === pageNumber &&
          highlight.rects.some(
            (rect) =>
              nx >= rect.x && nx <= rect.x + rect.width && ny >= rect.y && ny <= rect.y + rect.height
          )
      ) ?? null
    )
  }

  return (
    <div className="pdf-viewer-wrap">
      <div className="pdf-scroll" ref={scrollRef} onMouseUp={handleMouseUp} onScroll={() => callbacks.current.onSelection(null)}>
        <div className="pdfViewer" ref={viewportRef} />
      </div>
      {loading && (
        <div className="pdf-overlay">
          <Loader2 size={22} className="spin" />
          <span>{t("正在加载 PDF…")}</span>
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

export default PdfViewer
