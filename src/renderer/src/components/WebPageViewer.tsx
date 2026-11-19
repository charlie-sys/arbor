import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, RefreshCw, Save, MessageSquare, BookmarkPlus } from 'lucide-react'
import type { DocumentMeta } from '@shared/types'
import type { WebPageState, WebPageSource } from '@shared/web'
import { t } from '@shared/i18n'
import './web.css'

export default function WebPageViewer({ doc, onCaptured, onQuote, notify }: {
  doc: DocumentMeta
  onCaptured(docId: string): Promise<void>
  onQuote(text: string): Promise<void>
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const iframe = useRef<HTMLIFrameElement>(null)
  const browserMode = document.documentElement.dataset.arborWeb === 'true'
  const [source, setSource] = useState<WebPageSource>(doc.webArchivedAt ? 'offline' : 'online')
  const [state, setState] = useState<WebPageState>({ url: doc.url, title: doc.title, loading: true, canGoBack: false, canGoForward: false,
    source, hasArchive: !!doc.webArchivedAt })
  const [address, setAddress] = useState(doc.url)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)
  const [iframeUrl, setIframeUrl] = useState('')
  const [archiveText, setArchiveText] = useState('')
  const previousUrl = useRef(doc.url)
  const isZhihuExit = (() => {
    try { return new URL(state.url).hostname === 'link.zhihu.com' } catch { return false }
  })()
  useEffect(() => {
    if (browserMode) return
    let disposed = false
    let lastBounds = ''
    let mounted = false
    const bounds = () => {
      const node = host.current
      // WebContentsView 不参与 DOM 的 z-index 排序，所有应用浮层必须先让出原生网页层。
      const blocked = [...document.querySelectorAll('.sidebar-backdrop, .modal-backdrop, .palette-backdrop, [aria-modal="true"], [data-web-overlay]')]
        .some((overlay) => overlay.getClientRects().length > 0 && getComputedStyle(overlay).visibility !== 'hidden')
      if (!node || !node.getClientRects().length || blocked) return null
      const box = node.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }
    const syncBounds = (): void => {
      if (!mounted || disposed) return
      const value = bounds()
      const key = JSON.stringify(value)
      if (key === lastBounds) return
      lastBounds = key
      void window.api.web.bounds(value).catch(() => undefined)
    }
    const node = host.current!
    const observer = new ResizeObserver(syncBounds)
    observer.observe(node)
    const visibility = new MutationObserver(syncBounds)
    visibility.observe(document.body, { attributes: true, childList: true, subtree: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-modal', 'data-web-overlay'] })
    window.addEventListener('resize', syncBounds)
    const box = bounds() ?? { x: 0, y: 0, width: 0, height: 0 }
    setReady(false)
    void window.api.web.mount(doc.id, box, source).then((initial) => {
      if (disposed) return
      mounted = true
      setReady(true)
      setState(initial)
      setSource(initial.source)
      syncBounds()
    }).catch((err: Error) => { if (!disposed) setError(err.message) })
    const timer = window.setInterval(() => {
      if (!mounted || disposed) return
      void window.api.web.state().then((next) => {
        if (disposed) return
        setState(next)
        setSource(next.source)
        if (next.url && next.url !== previousUrl.current) { previousUrl.current = next.url; setAddress(next.url); setError('') }
      }).catch(() => undefined)
    }, 500)
    return () => {
      disposed = true
      observer.disconnect()
      visibility.disconnect()
      window.removeEventListener('resize', syncBounds)
      window.clearInterval(timer)
      void window.api.web.unmount().catch(() => undefined)
    }
  }, [doc.id, browserMode])

  useEffect(() => {
    if (!browserMode) return
    let disposed = false
    setReady(false)
    setError('')
    void window.api.web
      .mount(doc.id, { x: 0, y: 0, width: 0, height: 0 }, source)
      .then(async (initial) => {
        if (disposed) return
        setState(initial)
        setSource(initial.source)
        if (source === 'offline') {
          const url = await window.api.library.pdfUrl(doc.id)
          if (!disposed) setIframeUrl(url)
          const pages = await window.api.library.getTexts(doc.id)
          if (!disposed) setArchiveText(pages.join('\n\n'))
        } else {
          setIframeUrl(doc.url)
          const pages = await window.api.library.getTexts(doc.id)
          if (!disposed) setArchiveText(pages.join('\n\n'))
        }
        setReady(true)
      })
      .catch((err: Error) => {
        if (!disposed) setError(err.message)
      })
    return () => {
      disposed = true
      ;(window as unknown as { __arborWebSelection?: string }).__arborWebSelection = ''
      void window.api.web.unmount().catch(() => undefined)
    }
  }, [browserMode, doc.id, doc.url, source])

  const captureSelection = (): void => {
    const selected =
      window.getSelection()?.toString() ||
      iframe.current?.contentDocument?.getSelection()?.toString() ||
      ''
    ;(window as unknown as { __arborWebSelection?: string }).__arborWebSelection =
      selected.trim()
  }

  const perform = async (task: () => Promise<unknown>): Promise<void> => {
    setError('')
    try { await task() } catch (err) { setError((err as Error).message) }
  }
  return <div className="web-page-viewer">
    <div className="web-navigation">
      <button className="icon-btn" title={t('后退')} disabled={!state.canGoBack} onClick={() => void perform(() => window.api.web.action('back'))}><ArrowLeft size={16} /></button>
      <button className="icon-btn" title={t('前进')} disabled={!state.canGoForward} onClick={() => void perform(() => window.api.web.action('forward'))}><ArrowRight size={16} /></button>
      <button className="icon-btn" title={t('刷新网页')} disabled={!ready} onClick={() => void perform(() => window.api.web.action('reload'))}>
        {state.loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
      </button>
      <form onSubmit={(e) => { e.preventDefault(); void perform(() => window.api.web.navigate(address)) }}>
        <input className="input" aria-label={t('网页地址')} value={address} disabled={source === 'offline' || saving} onChange={(e) => setAddress(e.target.value)} />
      </form>
      <button className="icon-btn" title={t('用浏览器打开')} onClick={() => void perform(() => window.api.web.openExternal(state.url || doc.url))}><ExternalLink size={16} /></button>
      {state.hasArchive && <select className="select" aria-label={t('网页来源')} value={source} disabled={!ready || saving} onChange={(event) => void perform(async () => {
        const next = await window.api.web.source(event.target.value as WebPageSource)
        setState(next)
        setSource(next.source)
      })}>
        <option value="online">{t('在线网页')}</option><option value="offline">{t('离线网页')}</option>
      </select>}
      <button className="btn small" disabled={!ready || !state.readable || saving || source === 'offline'} onClick={() => void perform(async () => {
        setSaving(true)
        try {
          const captured = await window.api.web.capture()
          await onCaptured(captured.id)
          notify(t('已保存离线网页，包含已加载的图片和样式'), 'success')
        } finally { setSaving(false) }
      })}>{saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}{t('保存离线网页')}</button>
      <button className="btn small" disabled={!ready} onClick={() => void perform(async () => {
        const selected = await window.api.web.selection()
        if (!selected.text) throw new Error(t('请先在网页中选择文字'))
        await onQuote(selected.text)
      })}><MessageSquare size={14} />{t('问选区')}</button>
      <button className="icon-btn" title={t('摘录选区')} disabled={!ready} onClick={() => void perform(async () => {
        const selected = await window.api.web.selection()
        if (!selected.text) throw new Error(t('请先在网页中选择文字'))
        await window.api.excerpts.add({ docId: doc.id, source: `${selected.title}\n${selected.url}`, answer: selected.text })
        notify(t('已存为摘录'), 'success')
      })}><BookmarkPlus size={16} /></button>
    </div>
    <div className="web-snapshot-hint"><strong>{state.title || doc.title}</strong> · {isZhihuExit ? t('当前为知乎外链确认页，请在网页中点击“继续访问”后打开目标内容。') : source === 'offline' ? t('正在阅读离线网页归档。问答直接读取归档中的页面内容。') : t('问答直接读取当前网页；点击链接后可继续提问。配置视觉模型后可同时识别当前可见区域的图片和布局。')}</div>
    {(error || state.error) && <div className="web-error" role="alert">{error || state.error}</div>}
    <div ref={host} className="web-page-host" title={t('Ctrl + 滚轮缩放网页，Ctrl + 0 恢复原始大小')}>
      {browserMode ? (
        <article
          className="web-browser-archive"
          onMouseUp={captureSelection}
          onKeyUp={captureSelection}
        >
          {archiveText
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
        </article>
      ) : null}
      {browserMode && iframeUrl && !archiveText ? (
        <iframe
          ref={iframe}
          className="web-browser-frame"
          src={iframeUrl}
          sandbox="allow-same-origin allow-popups"
          onLoad={() => setReady(true)}
        />
      ) : null}
    </div>
  </div>
}
