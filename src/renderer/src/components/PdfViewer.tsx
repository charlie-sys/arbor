import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { EventBus, LinkTarget, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import { Loader2, TriangleAlert } from 'lucide-react'
import { pdfOptions } from '../pdf'

export interface PdfSelection {
  text: string
  page: number
  rect: { left: number; top: number; right: number; bottom: number }
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
  onPageChange(page: number): void
  onPagesLoaded(count: number): void
  onSelection(selection: PdfSelection | null): void
}

const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(props, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewerObj = useRef<any>(null)
  const loadingTaskRef = useRef<any>(null)
  const pageRef = useRef(props.initialPage || 1)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const callbacks = useRef(props)
  callbacks.current = props

  useImperativeHandle(ref, () => ({
    goToPage(page: number) {
      const viewer = viewerObj.current
      if (!viewer) return
      const total = viewer.pagesCount || 1
      viewer.currentPageNumber = Math.min(total, Math.max(1, page))
    },
    nextPage() {
      const viewer = viewerObj.current
      if (!viewer) return
      viewer.currentPageNumber = Math.min(viewer.pagesCount, viewer.currentPageNumber + 1)
    },
    prevPage() {
      const viewer = viewerObj.current
      if (!viewer) return
      viewer.currentPageNumber = Math.max(1, viewer.currentPageNumber - 1)
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
    setLoading(true)

    const init = async (): Promise<void> => {
      try {
        const task = pdfjsLib.getDocument(pdfOptions(window.api.library.pdfUrl(props.docId)) as never)
        loadingTaskRef.current = task
        const pdf = await task.promise
        if (cancelled) {
          await task.destroy()
          return
        }

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
        eventBus.on('pagesinit', () => {
          viewer.currentScaleValue = 'page-width'
          const page = Math.min(callbacks.current.initialPage || 1, pdf.numPages)
          viewer.currentPageNumber = page
          callbacks.current.onPagesLoaded(pdf.numPages)
          if (!cancelled) setLoading(false)
        })
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || 'PDF 加载失败')
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

  const handleMouseUp = (): void => {
    window.setTimeout(() => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      if (!selection || !text || selection.rangeCount === 0) {
        callbacks.current.onSelection(null)
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
      callbacks.current.onSelection({
        text,
        page,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      })
    }, 10)
  }

  return (
    <div className="pdf-viewer-wrap">
      <div className="pdf-scroll" ref={scrollRef} onMouseUp={handleMouseUp} onScroll={() => callbacks.current.onSelection(null)}>
        <div className="pdfViewer" ref={viewportRef} />
      </div>
      {loading && (
        <div className="pdf-overlay">
          <Loader2 size={22} className="spin" />
          <span>正在加载 PDF…</span>
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
