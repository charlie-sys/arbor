import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pin, PinOff, X } from 'lucide-react'
import type { ReaderPanelQuote, ReaderPanelTab } from '@shared/api'
import type { DocumentAnnotations, LibraryData } from '@shared/types'
import ReaderSidePanel from './components/ReaderSidePanel'
import type { PdfOutlineItem } from './components/PdfViewer'
import { cx } from './ui'
import { applyTheme, readTheme } from './themes'
import { getLocale, localeTag, setLocale, subscribeLocale, t } from '@shared/i18n'

interface Props {
  docId: string
  tab: ReaderPanelTab
}

export default function DetachedPanel({ docId, tab: initialTab }: Props): React.JSX.Element {
  const locale = useSyncExternalStore(subscribeLocale, getLocale)
  const [data, setData] = useState<LibraryData | null>(null)
  const [annotations, setAnnotations] = useState<DocumentAnnotations>({
    version: 1,
    docId,
    notes: [],
    strokes: [],
    updatedAt: 0
  })
  const [tab, setTab] = useState<ReaderPanelTab>(initialTab)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [quote, setQuote] = useState<ReaderPanelQuote | null>(null)
  const [outline, setOutline] = useState<PdfOutlineItem[]>([])
  const [outlineLoaded, setOutlineLoaded] = useState(false)
  const [fallbackToc, setFallbackToc] = useState<{ page: number; title: string }[]>([])
  const [pinned, setPinned] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    const [state, annotationState] = await Promise.all([
      window.api.library.getState(),
      window.api.annotations.load(docId)
    ])
    setData(state)
    setAnnotations(annotationState)
    setLocale(state.settings.language)
  }, [docId])

  useEffect(() => {
    document.documentElement.lang = localeTag(locale)
    document.title = t('阅读面板 — Arbor')
  }, [locale])

  useEffect(() => {
    return window.api.events.onSettingsChanged((next) => setLocale(next.language))
  }, [])

  useEffect(() => {
    applyTheme(readTheme())
    const onStorage = (event: StorageEvent): void => {
      if (event.key === 'zotagent-theme') applyTheme(readTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    void reload()
    void window.api.readerPanel.state().then((state) => {
      setPinned(state.pinned)
      if (state.docId === docId) {
        if (state.activeChatId) setActiveChatId(state.activeChatId)
        setTab(state.tab)
      }
    })
    window.api.readerPanel.ready(docId)
    const offs = [
      window.api.events.onReaderPanelRefresh(() => void reload()),
      window.api.events.onReaderPanelQuote((payload) => setQuote(payload)),
      window.api.events.onReaderPanelPage((payload) => {
        if (payload.docId === docId) setPage(payload.page)
      }),
      window.api.events.onReaderPanelOutline((payload) => {
        if (payload.docId !== docId) return
        setOutline(payload.outline)
        setOutlineLoaded(payload.outlineLoaded)
        setFallbackToc(payload.fallbackToc)
      }),
      window.api.events.onReaderPanelBlockClose(() => notify(t("有未保存的修改，请先保存"))),
      window.api.events.onReaderPanelPinned((value) => setPinned(value))
    ]
    return () => {
      offs.forEach((off) => off())
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [docId, reload, notify])

  useEffect(() => {
    window.api.readerPanel.setTab(tab, activeChatId)
  }, [tab, activeChatId])

  useEffect(() => {
    if (tab !== 'annotations') return
    let cancelled = false
    void window.api.annotations.load(docId).then((data) => {
      if (!cancelled) setAnnotations(data)
    })
    return () => {
      cancelled = true
    }
  }, [tab, docId])

  const onDirtyChange = useCallback((dirty: boolean) => {
    window.api.readerPanel.setDirty(dirty)
  }, [])

  const onChanged = useCallback(async (): Promise<void> => {
    await reload()
    window.api.readerPanel.notifyChanged()
  }, [reload])

  const togglePin = async (): Promise<void> => {
    const next = !pinned
    await window.api.readerPanel.setPinned(next)
    setPinned(next)
  }

  const doc = data?.documents.find((item) => item.id === docId)

  if (!doc || !data) {
    return <div className="panel-window panel-window-loading">{t("正在加载阅读面板…")}</div>
  }

  return (
    <div className="panel-window">
      <header className="panel-window-head">
        <div className="panel-window-title" title={doc.title}>
          <span className="panel-window-label">{t("阅读面板")}</span>
          <span className="panel-window-doc">{doc.title}</span>
        </div>
        <button
          className={cx('icon-btn', pinned && 'active')}
          title={pinned ? t("取消置顶") : t("置顶窗口")}
          onClick={() => void togglePin()}
        >
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
        <button className="icon-btn" title={t("收回面板")} onClick={() => void window.api.readerPanel.close()}>
          <X size={15} />
        </button>
      </header>
      <div className="panel-window-body">
        <ReaderSidePanel
          doc={doc}
          documents={data.documents}
          chats={data.chats}
          collections={data.collections}
          highlights={data.highlights}
          annotations={annotations}
          excerpts={data.excerpts}
          tasks={data.tasks}
          page={page}
          quote={quote}
          tab={tab}
          activeChatId={activeChatId}
          outline={outline}
          outlineLoaded={outlineLoaded}
          fallbackToc={fallbackToc}
          onTab={setTab}
          onActiveChat={setActiveChatId}
          onChanged={onChanged}
          onQuoteApplied={() => setQuote(null)}
          onJumpPage={(target) => window.api.readerPanel.openDoc(docId, target)}
          onRevealNote={(note) => window.api.readerPanel.openDoc(docId, note.page)}
          onOpenDoc={(targetDocId, targetPage) => window.api.readerPanel.openDoc(targetDocId, targetPage)}
          onDirtyChange={onDirtyChange}
          notify={notify}
        />
      </div>
      {toast && <div className="panel-window-toast">{toast}</div>}
    </div>
  )
}
