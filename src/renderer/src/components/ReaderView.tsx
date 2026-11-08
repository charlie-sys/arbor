import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Highlighter,
  Maximize,
  Save,
  ScanLine,
  Sparkles,
  StickyNote,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { AiActionId, ChatSession, Collection, DocumentMeta, Excerpt, Highlight, HighlightColor, TaskItem, TranslationRecord } from '@shared/types'
import type { ReaderPanelTab } from '@shared/api'
import { AI_ACTIONS } from '@shared/aiActions'
import PdfViewer, { type PdfOutlineItem, type PdfSelection, type PdfViewerHandle } from './PdfViewer'
import AiActionPanel from './AiActionPanel'
import PaneResizer from './PaneResizer'
import ReaderSidePanel from './ReaderSidePanel'
import { useUnsavedChanges } from '../unsaved'
import { cx, formatTime, Markdown } from '../ui'

interface Props {
  doc: DocumentMeta
  documents: DocumentMeta[]
  chats: ChatSession[]
  collections: Collection[]
  highlights: Highlight[]
  excerpts: Excerpt[]
  tasks: TaskItem[]
  initialPage?: number
  translateBusy: boolean
  translation?: TranslationRecord | null
  hasTranslation?: boolean
  onCloseTranslation?(): void
  onRestoreTranslation?(): void
  onOpenTranslations?(): void
  onBack(): void
  onChanged(): Promise<void> | void
  onOpenDoc?(docId: string, page?: number): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

interface Quote {
  text: string
  page?: number
  nonce: number
}

type Panel = ReaderPanelTab

interface FallbackTocEntry {
  page: number
  title: string
}

const HIGHLIGHT_COLORS: { value: HighlightColor; label: string }[] = [  { value: 'yellow', label: '黄' },
  { value: 'green', label: '绿' },
  { value: 'blue', label: '蓝' },
  { value: 'pink', label: '粉' },
  { value: 'purple', label: '紫' }
]

interface HighlightEditorState {
  id: string
  left: number
  top: number
}

export default function ReaderView({ doc, documents, chats, collections, highlights, excerpts, tasks, initialPage, translateBusy, translation, hasTranslation, onCloseTranslation, onRestoreTranslation, onOpenTranslations, onBack, onChanged, onOpenDoc, notify }: Props): React.JSX.Element {
  const pdfRef = useRef<PdfViewerHandle>(null)
  const [panel, setPanel] = useState<Panel>('agent')
  const [detached, setDetached] = useState(false)
  const livePageRef = useRef(1)
  const liveOutlineRef = useRef({ outline: [] as PdfOutlineItem[], outlineLoaded: false, fallbackToc: [] as FallbackTocEntry[] })
  const startPage = initialPage && initialPage > 0 ? initialPage : doc.lastPage || 1
  const [page, setPage] = useState(startPage)
  const [pageInput, setPageInput] = useState(String(startPage))
  const [pageCount, setPageCount] = useState(doc.pageCount)
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const [aiActionMenuOpen, setAiActionMenuOpen] = useState(false)
  const [actionRequest, setActionRequest] = useState<{ action: AiActionId; text: string; page: number } | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [flashHighlightId, setFlashHighlightId] = useState<string | null>(null)
  const [editor, setEditor] = useState<HighlightEditorState | null>(null)
  const [draftNote, setDraftNote] = useState('')
  const [draftColor, setDraftColor] = useState<HighlightColor>('yellow')
  const [outline, setOutline] = useState<PdfOutlineItem[]>([])
  const [outlineLoaded, setOutlineLoaded] = useState(false)
  const [fallbackToc, setFallbackToc] = useState<FallbackTocEntry[]>([])
  const [resumePrompt, setResumePrompt] = useState(
    !initialPage && (doc.lastPage || 1) > 1 && (doc.pageCount || 0) > 1
  )
  const [translationImageMode, setTranslationImageMode] = useState<'translated' | 'original'>(
    translation?.translatedImageFile ? 'translated' : 'original'
  )
  const [panelRatio, setPanelRatioState] = useState<number>(() => {
    const raw = Number(window.localStorage.getItem('zotagent-reader-panel-ratio-v3'))
    return Number.isFinite(raw) && raw > 0 ? raw : 0.35
  })
  const [translationRatio, setTranslationRatioState] = useState<number>(() => {
    const raw = Number(window.localStorage.getItem('zotagent-translation-ratio-v3'))
    return Number.isFinite(raw) && raw > 0 ? raw : 0.26
  })
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const effectivePanelWidth = Math.max(0, Math.round(viewportWidth * panelRatio))
  const effectiveTranslationWidth = Math.max(0, Math.round(viewportWidth * translationRatio))
  const setPanelWidth = (value: number): void => {
    const ratio = viewportWidth > 0 ? Math.max(0, value) / viewportWidth : 0
    setPanelRatioState(ratio)
    window.localStorage.setItem('zotagent-reader-panel-ratio-v3', String(ratio))
  }
  const setTranslationWidth = (value: number): void => {
    const ratio = viewportWidth > 0 ? Math.max(0, value) / viewportWidth : 0
    setTranslationRatioState(ratio)
    window.localStorage.setItem('zotagent-translation-ratio-v3', String(ratio))
  }

  useEffect(() => {
    let cancelled = false
    void window.api.readerPanel.state().then((state) => {
      if (cancelled || !state.open || state.docId !== doc.id) return
      setDetached(true)
      setPanel(state.tab)
      setActiveChatId(state.activeChatId)
    })
    const offClosed = window.api.events.onReaderPanelClosed((payload) => {
      if (payload.docId !== doc.id) return
      setDetached(false)
      setPanel(payload.tab)
      setActiveChatId(payload.activeChatId)
    })
    const offOpenDoc = window.api.events.onReaderPanelOpenDoc((payload) => {
      onOpenDoc?.(payload.docId, payload.page)
    })
    const offReady = window.api.events.onReaderPanelReady((payload) => {
      if (payload.docId !== doc.id) return
      window.api.readerPanel.sendPage(doc.id, livePageRef.current)
      window.api.readerPanel.sendOutline(doc.id, liveOutlineRef.current)
    })
    return () => {
      cancelled = true
      offClosed()
      offOpenDoc()
      offReady()
      void window.api.readerPanel.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  livePageRef.current = page
  liveOutlineRef.current = { outline, outlineLoaded, fallbackToc }

  useEffect(() => {
    if (!detached) return
    window.api.readerPanel.sendPage(doc.id, page)
  }, [detached, doc.id, page])

  useEffect(() => {
    if (!detached) return
    window.api.readerPanel.sendOutline(doc.id, { outline, outlineLoaded, fallbackToc })
  }, [detached, doc.id, outline, outlineLoaded, fallbackToc])

  const detachPanel = async (nextTab: ReaderPanelTab): Promise<void> => {
    try {
      const state = await window.api.readerPanel.open(doc.id, nextTab, activeChatId)
      if (state.open) setDetached(true)
    } catch (err) {
      notify(`打开独立面板失败：${(err as Error).message}`, 'error')
    }
  }
  const docHighlights = useMemo(
    () =>
      highlights
        .filter((highlight) => highlight.docId === doc.id)
        .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),
    [highlights, doc.id]
  )
  const editingHighlight = editor ? docHighlights.find((highlight) => highlight.id === editor.id) ?? null : null

  const highlightEditorDirty =
    !!editingHighlight && (draftNote !== editingHighlight.note || draftColor !== editingHighlight.color)

  useUnsavedChanges('reader-highlight-editor', highlightEditorDirty)

  const closeHighlightEditor = (): void => {
    if (highlightEditorDirty) {
      notify('高亮批注有未保存的修改，请先保存', 'info')
      return
    }
    setEditor(null)
  }

  useEffect(() => {
    setPanel('agent')
    setPage(startPage)
    setPageInput(String(startPage))
    setPageCount(doc.pageCount)
    setSelection(null)
    setAiActionMenuOpen(false)
    setActionRequest(null)
    setQuote(null)
    setEditor(null)
    setFlashHighlightId(null)
    setOutline([])
    setOutlineLoaded(false)
    setFallbackToc([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  useEffect(() => {
    setTranslationImageMode(translation?.translatedImageFile ? 'translated' : 'original')
  }, [translation?.id])

  useEffect(() => {
    if (initialPage && initialPage > 0) {
      setPage(initialPage)
      setPageInput(String(initialPage))
      pdfRef.current?.goToPage(initialPage)
    }
  }, [initialPage])

  useEffect(() => {
    if (!outlineLoaded || outline.length > 0) return
    let cancelled = false
    void (async () => {
      try {
        const pages = await window.api.library.getTexts(doc.id)
        if (cancelled) return
        const entries: FallbackTocEntry[] = []
        pages.forEach((text, index) => {
          const line =
            String(text || '')
              .split(/\n+/)
              .map((value) => value.trim())
              .find(Boolean) || ''
          if (line) entries.push({ page: index + 1, title: line.slice(0, 60) })
        })
        setFallbackToc(entries)
      } catch {
        if (!cancelled) setFallbackToc([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [outlineLoaded, outline.length, doc.id])

  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  useEffect(() => {
    if (doc.readingStatus && doc.readingStatus !== 'unread') return
    let cancelled = false
    void (async () => {
      try {
        await window.api.library.update(doc.id, { readingStatus: 'reading' })
        if (cancelled) return
        await onChanged()
      } catch {
        // 自动标记阅读状态失败不影响正常阅读
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.readingStatus])

  useEffect(() => {
    if (page < 1 || page === doc.lastPage) return
    const timer = window.setTimeout(() => {
      void window.api.library.update(doc.id, { lastPage: page })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [page, doc.id, doc.lastPage])

  const goToPage = (value: number): void => {
    const max = pageCount || doc.pageCount || 0
    const target = max > 0 ? Math.min(Math.max(1, Math.round(value)), max) : Math.max(1, Math.round(value))
    setPage(target)
    pdfRef.current?.goToPage(target)
  }

  const openAgentQuote = async (text: string, pageNumber: number): Promise<void> => {
    setPanel('agent')
    if (detached) {
      try {
        await window.api.readerPanel.quote(doc.id, text, pageNumber)
      } catch (err) {
        notify(`发送引用失败：${(err as Error).message}`, 'error')
      }
      return
    }
    setQuote({ text, page: pageNumber, nonce: Date.now() })
  }

  const askAgent = async (): Promise<void> => {
    if (!selection) return
    const text = selection.text
    const pageNumber = selection.page
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    await openAgentQuote(text, pageNumber)
  }

  const startAiAction = (id: AiActionId): void => {
    if (!selection) return
    setActionRequest({ action: id, text: selection.text, page: selection.page })
    setAiActionMenuOpen(false)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const saveSelectionAsNote = async (): Promise<void> => {
    if (!selection) return
    const segment = `> 第 ${selection.page} 页：${selection.text}\n`
    const base = doc.notes.trim()
    const next = base ? `${base}\n\n${segment}` : segment
    setPanel('notes')
    try {
      await window.api.library.update(doc.id, { notes: next })
      notify('已保存为笔记', 'success')
      await onChanged()
    } catch (err) {
      notify(`保存笔记失败：${(err as Error).message}`, 'error')
    }
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const copySelection = async (): Promise<void> => {
    if (!selection) return
    await navigator.clipboard.writeText(selection.text).catch(() => undefined)
    notify('已复制原文', 'success')
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const flashTimer = useRef<number | null>(null)
  const flashHighlight = (id: string): void => {
    setFlashHighlightId(id)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashHighlightId(null), 1600)
  }
  useEffect(() => {
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
    }
  }, [])

  const addHighlight = async (color: HighlightColor): Promise<void> => {
    if (!selection) return
    if (!selection.rects.length) {
      notify('未能定位选区位置，请重新选择文字后再高亮', 'error')
      return
    }
    try {
      const highlight = await window.api.highlights.add({
        docId: doc.id,
        page: selection.page,
        color,
        text: selection.text,
        rects: selection.rects
      })
      await onChanged()
      flashHighlight(highlight.id)
      notify('已添加高亮', 'success')
    } catch (err) {
      notify(`添加高亮失败：${(err as Error).message}`, 'error')
    }
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const openHighlightEditor = (highlight: Highlight, position: { left: number; top: number }): void => {
    if (highlightEditorDirty) {
      notify('高亮批注有未保存的修改，请先保存', 'info')
      return
    }
    const width = 288
    const height = 230
    setEditor({
      id: highlight.id,
      left: Math.min(Math.max(12, position.left), window.innerWidth - width - 12),
      top: Math.min(Math.max(12, position.top), window.innerHeight - height - 12)
    })
    setDraftColor(highlight.color)
    setDraftNote(highlight.note)
    setSelection(null)
  }

  const saveHighlightEditor = async (): Promise<void> => {
    if (!editor) return
    try {
      await window.api.highlights.update(editor.id, { color: draftColor, note: draftNote })
      await onChanged()
      setEditor(null)
      notify('高亮已更新', 'success')
    } catch (err) {
      notify(`更新高亮失败：${(err as Error).message}`, 'error')
    }
  }

  const removeHighlight = async (id: string): Promise<void> => {
    if (!window.confirm('删除这条高亮？')) return
    try {
      await window.api.highlights.remove(id)
      await onChanged()
      if (editor?.id === id) setEditor(null)
      notify('已删除高亮', 'success')
    } catch (err) {
      notify(`删除高亮失败：${(err as Error).message}`, 'error')
    }
  }

  const toolbarTop = selection
    ? selection.rect.bottom + 52 > window.innerHeight
      ? Math.max(12, selection.rect.top - 46)
      : selection.rect.bottom + 8
    : 0
  const toolbarLeft = selection ? Math.min(Math.max(12, selection.rect.left), window.innerWidth - 340) : 0
  const translationImageFile = translation
    ? translationImageMode === 'translated' && translation.translatedImageFile
      ? translation.translatedImageFile
      : translation.imageFile
    : ''

  return (
    <div className="reader-view">
      <div className="reader-toolbar">
        <button className="icon-btn" title="返回文献库" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="reader-title" title={doc.title}>
          {doc.title}
          {doc.pageCount === 0 && <span className="warn-tag">未提取文本</span>}
        </div>

        <div className="page-controls">
          <button className="icon-btn" onClick={() => pdfRef.current?.prevPage()} title="上一页">
            <ChevronLeft size={17} />
          </button>
          <input
            className="page-input"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => goToPage(Number(pageInput) || page)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') goToPage(Number(pageInput) || page)
            }}
          />
          <span className="page-total">/ {pageCount || doc.pageCount || '-'}</span>
          <button className="icon-btn" onClick={() => pdfRef.current?.nextPage()} title="下一页">
            <ChevronRight size={17} />
          </button>
        </div>

        <div className="zoom-controls" title="Ctrl + 鼠标滚轮可缩放">
          <button className="icon-btn" onClick={() => pdfRef.current?.zoomOut()} title="缩小">
            <ZoomOut size={17} />
          </button>
          <button className="icon-btn" onClick={() => pdfRef.current?.zoomIn()} title="放大">
            <ZoomIn size={17} />
          </button>
          <button className="icon-btn" onClick={() => pdfRef.current?.fitWidth()} title="适应宽度">
            <Maximize size={16} />
          </button>
        </div>

        {!translation && hasTranslation && (
          <button className="btn ghost small" onClick={onRestoreTranslation} title="重新显示翻译面板">
            <ScanLine size={15} /> 显示翻译
          </button>
        )}
        <button className="btn ghost small" onClick={() => void window.api.translate.start()} disabled={translateBusy}>
          <ScanLine size={15} /> 截图翻译
        </button>
      </div>

      {resumePrompt && (
        <div
          className="modal-backdrop resume-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setResumePrompt(false)}
        >
          <div className="modal resume-modal">
            <div className="modal-head">
              <div>
                <h3>继续阅读？</h3>
                <p className="muted">上次读到第 {startPage} 页。默认继续阅读。</p>
              </div>
            </div>
            <div className="modal-foot" style={{ justifyContent: 'flex-end' }}>
              <div className="modal-actions">
                <button
                  className="btn ghost"
                  onClick={() => {
                    goToPage(1)
                    setPageInput('1')
                    setResumePrompt(false)
                  }}
                >
                  从头开始
                </button>
                <button className="btn primary" autoFocus onClick={() => setResumePrompt(false)}>
                  继续阅读（第 {startPage} 页）
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="reader-body">
        {translation && (
          <aside className="translation-drawer" style={{ width: effectiveTranslationWidth }}>
            <div className="translation-drawer-head">
              <div>
                <strong>截图翻译</strong>
                <div className="muted small">{formatTime(translation.createdAt)}</div>
              </div>
              <div className="translation-drawer-head-actions">
                <button className="btn ghost small" onClick={onCloseTranslation}>
                  收起
                </button>
                <button className="icon-btn" title="隐藏翻译面板" onClick={onCloseTranslation}>
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="translation-drawer-body">
              <div className="translation-drawer-toggle">
                <button
                  className={cx('chip-button', translationImageMode === 'original' && 'active')}
                  onClick={() => setTranslationImageMode('original')}
                >
                  原图
                </button>
                <button
                  className={cx('chip-button', translationImageMode === 'translated' && 'active')}
                  onClick={() => setTranslationImageMode('translated')}
                  disabled={!translation.translatedImageFile}
                >
                  译文图
                </button>
              </div>
              <img
                className="translation-drawer-image"
                src={`zotfile://translations/${translationImageFile}`}
                alt={translationImageMode === 'translated' ? '译文截图' : '截图原文'}
              />
              <div className="translation-drawer-text">
                <Markdown>{translation.structured || translation.plain}</Markdown>
              </div>
            </div>
            <div className="translation-drawer-foot">
              <button className="link-btn" onClick={onOpenTranslations}>
                在翻译栏目查看
              </button>
            </div>
          </aside>
        )}
        {translation && (
          <PaneResizer
            value={effectiveTranslationWidth}
            onChange={setTranslationWidth}
            label="调整翻译面板宽度"
          />
        )}
        <div className="reader-pdf">
          {!doc.fileName ? (
            <div className="empty-state" style={{ margin: 'auto' }}>
              <h2>这是一条外部导入的文献记录</h2>
              <p className="muted">尚未关联 PDF 文件。你仍可查看右侧的文献信息、摘录与 AI 对话。</p>
            </div>
          ) : (
          <PdfViewer
            key={doc.id}
            ref={pdfRef}
            docId={doc.id}
            initialPage={startPage}
            highlights={docHighlights}
            flashHighlightId={flashHighlightId}
            onPageChange={(nextPage) => {
              setPage(nextPage)
              if (!highlightEditorDirty) setEditor(null)
            }}
            onPagesLoaded={setPageCount}
            onSelection={(next) => {
              setSelection(next)
              setAiActionMenuOpen(false)
              if (next && !highlightEditorDirty) setEditor(null)
            }}
            onHighlightClick={openHighlightEditor}
            onOutline={(items) => {
              setOutline(items)
              setOutlineLoaded(true)
            }}
          />
          )}
        </div>

        {!detached && (
          <>
            <PaneResizer
              value={effectivePanelWidth}
              onChange={setPanelWidth}
              invert
              label="调整右侧栏宽度"
            />
            <aside className="reader-panel" style={{ width: effectivePanelWidth }}>
              <ReaderSidePanel
                doc={doc}
                documents={documents}
                chats={chats}
                collections={collections}
                highlights={highlights}
                excerpts={excerpts}
                tasks={tasks}
                page={page}
                quote={quote}
                tab={panel}
                activeChatId={activeChatId}
                outline={outline}
                outlineLoaded={outlineLoaded}
                fallbackToc={fallbackToc}
                onTab={setPanel}
                onActiveChat={setActiveChatId}
                onChanged={onChanged}
                onQuoteApplied={() => setQuote(null)}
                onJumpPage={goToPage}
                onOpenDoc={(docId, targetPage) => onOpenDoc?.(docId, targetPage)}
                onDetach={(nextTab) => void detachPanel(nextTab)}
                notify={notify}
              />
            </aside>
          </>
        )}
      </div>

      {selection && (
        <div className="selection-toolbar" style={{ top: toolbarTop, left: toolbarLeft }}>
          <div className="hl-swatches" title="高亮选中文字">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                className={`hl-swatch hl-${color.value}`}
                title={`高亮（${color.label}）`}
                onClick={() => void addHighlight(color.value)}
              />
            ))}
          </div>
          <span className="toolbar-divider" />
          <button onClick={() => void askAgent()}>
            <Sparkles size={14} /> 问 Agent
          </button>
          <div className="selection-action-wrap">
            <button title="AI 动作：翻译、摘要、解释公式、对比文献" onClick={() => setAiActionMenuOpen((open) => !open)}>
              <Sparkles size={14} /> AI 动作 <ChevronDown size={14} />
            </button>
            {aiActionMenuOpen && (
              <div className="selection-action-menu">
                {AI_ACTIONS.map((action) => (
                  <button key={action.id} onClick={() => startAiAction(action.id)} title={action.hint}>
                    <span>{action.label}</span>
                    <span className="muted">{action.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => void saveSelectionAsNote()}>
            <StickyNote size={14} /> 存为笔记
          </button>
          <button onClick={() => void copySelection()}>
            <Copy size={14} /> 复制
          </button>
          <button
            className="close"
            title="取消"
            onClick={() => {
              window.getSelection()?.removeAllRanges()
              setSelection(null)
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {editor && editingHighlight && (
        <div className="highlight-editor" style={{ top: editor.top, left: editor.left }}>
          <div className="highlight-editor-head">
            <span>
              <Highlighter size={13} /> 第 {editingHighlight.page} 页高亮
            </span>
            <button className="icon-btn tiny" title="关闭" onClick={closeHighlightEditor}>
              <X size={13} />
            </button>
          </div>
          <div className="highlight-editor-text">{editingHighlight.text}</div>
          <div className="hl-swatches editor">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                className={cx('hl-swatch', `hl-${color.value}`, draftColor === color.value && 'active')}
                title={`改为${color.label}色`}
                onClick={() => setDraftColor(color.value)}
              />
            ))}
          </div>
          <textarea
            rows={3}
            className="highlight-note-input"
            placeholder="添加批注…"
            value={draftNote}
            onChange={(event) => setDraftNote(event.target.value)}
          />
          <div className="highlight-editor-actions">
            <button className="btn ghost small danger" onClick={() => void removeHighlight(editingHighlight.id)}>
              <Trash2 size={13} /> 删除
            </button>
            <button className="btn primary small" onClick={() => void saveHighlightEditor()}>
              <Save size={13} /> 保存
            </button>
          </div>
        </div>
      )}

      {actionRequest && (
        <AiActionPanel
          key={`${actionRequest.action}-${actionRequest.page}-${actionRequest.text.length}`}
          action={actionRequest.action}
          selection={{ text: actionRequest.text, page: actionRequest.page }}
          docId={doc.id}
          docTitle={doc.title}
          documents={documents}
          onClose={() => setActionRequest(null)}
          onSaved={() => onChanged()}
          onContinueAsk={(text, pageNumber) => {
            setActionRequest(null)
            void openAgentQuote(text, pageNumber)
          }}
          notify={notify}
        />
      )}

    </div>
  )
}
