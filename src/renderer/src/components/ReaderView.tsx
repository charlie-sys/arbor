import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Highlighter,
  Maximize,
  Palette,
  PenLine,
  Save,
  ScanLine,
  Sparkles,
  StickyNote,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type {
  AiActionId,
  ChatSession,
  Collection,
  DocumentMeta,
  DocumentToneId,
  Excerpt,
  Highlight,
  HighlightColor,
  StickyColor,
  StickyNote as StickyNoteRecord,
  StickyNoteKind,
  TaskItem,
  TranslationRecord
} from '@shared/types'
import type { ReaderPanelTab } from '@shared/api'
import { AI_ACTIONS } from '@shared/aiActions'
import PdfViewer, { type PdfOutlineItem, type PdfSelection, type PdfViewerHandle } from './PdfViewer'
import TextViewer from './TextViewer'
import { documentFormatOf } from '@shared/documents'
import AiActionPanel from './AiActionPanel'
import PaneResizer from './PaneResizer'
import ReaderSidePanel from './ReaderSidePanel'
import AnnotationToolbar from './AnnotationToolbar'
import StickyNoteEditor from './StickyNoteEditor'
import DocumentToneMenu from './DocumentToneMenu'
import type { AnnotationTool } from './PageAnnotationLayer'
import { useDocumentAnnotations, INK_COLORS, INK_WIDTHS, NIGHT_INK_COLORS } from '../annotations'
import { isDocumentToneId, readLastTone, toneById, writeLastTone } from '../documentTone'
import { useUnsavedChanges } from '../unsaved'
import { cx, formatTime, Markdown } from '../ui'
import { t } from '@shared/i18n'

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
  const docFormat = documentFormatOf(doc)
  const [panel, setPanel] = useState<Panel>('agent')
  const [detached, setDetached] = useState(false)
  const livePageRef = useRef(1)
  const liveOutlineRef = useRef({ outline: [] as PdfOutlineItem[], outlineLoaded: false, fallbackToc: [] as FallbackTocEntry[] })
  const startPage = initialPage && initialPage > 0 ? initialPage : doc.lastPage || 1
  const [page, setPage] = useState(startPage)
  const [pageInput, setPageInput] = useState(String(startPage))
  const pageInputRef = useRef<HTMLInputElement>(null)
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
  const [annotating, setAnnotating] = useState(false)
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('note')
  const [annotationsVisible, setAnnotationsVisible] = useState(true)
  const [inkColor, setInkColor] = useState(INK_COLORS[0].value)
  const [inkWidth, setInkWidth] = useState(INK_WIDTHS[1].value)
  const [stickyColor, setStickyColor] = useState<StickyColor>('yellow')
  const [noteEditor, setNoteEditor] = useState<{ id: string; isNew: boolean; left: number; top: number } | null>(null)
  const [noteDraft, setNoteDraft] = useState<{
    kind: StickyNoteKind
    color: StickyColor
    text: string
    resolved: boolean
  } | null>(null)
  const [flashNoteId, setFlashNoteId] = useState<string | null>(null)
  const [tone, setTone] = useState<DocumentToneId>(() =>
    isDocumentToneId(doc.tone) ? doc.tone : readLastTone()
  )
  const [toneMenuOpen, setToneMenuOpen] = useState(false)
  const noteFlashTimer = useRef<number | null>(null)
  const inkPalette = tone === 'night' ? NIGHT_INK_COLORS : INK_COLORS
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
      notify(t("打开独立面板失败：{0}", [(err as Error).message]), 'error')
    }
  }
  const docHighlights = useMemo(
    () =>
      highlights
        .filter((highlight) => highlight.docId === doc.id)
        .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),
    [highlights, doc.id]
  )
  const {
    annotations,
    canUndo: canUndoAnnotation,
    canRedo: canRedoAnnotation,
    addNote: addStickyNote,
    updateNote: updateStickyNote,
    removeNote: removeStickyNote,
    addStroke,
    removeStroke,
    clearStrokes,
    undo: undoAnnotation,
    redo: redoAnnotation
  } = useDocumentAnnotations(doc.id, (message) =>
    notify(t("保存标注失败：{0}", [message]), 'error')
  )
  const editingNote = noteEditor ? annotations.notes.find((note) => note.id === noteEditor.id) ?? null : null
  const noteEditorDirty =
    !!editingNote &&
    !!noteDraft &&
    (noteDraft.kind !== editingNote.kind ||
      noteDraft.color !== editingNote.color ||
      noteDraft.text !== editingNote.text ||
      noteDraft.resolved !== editingNote.resolved)

  useUnsavedChanges('reader-sticky-note', noteEditorDirty)

  const flashStickyNote = (id: string): void => {
    setFlashNoteId(id)
    if (noteFlashTimer.current) window.clearTimeout(noteFlashTimer.current)
    noteFlashTimer.current = window.setTimeout(() => setFlashNoteId(null), 1800)
  }

  const closeStickyEditor = (): void => {
    if (noteEditorDirty) {
      notify(t("贴纸有未保存的修改，请先保存"), 'info')
      return
    }
    if (noteEditor?.isNew) removeStickyNote(noteEditor.id)
    setNoteEditor(null)
    setNoteDraft(null)
  }

  const openStickyEditor = (
    note: StickyNoteRecord,
    position: { left: number; top: number },
    isNew = false
  ): void => {
    if (noteEditor && noteEditor.id !== note.id && noteEditorDirty) {
      notify(t("贴纸有未保存的修改，请先保存"), 'info')
      return
    }
    if (noteEditor && noteEditor.id !== note.id && noteEditor.isNew) removeStickyNote(noteEditor.id)
    const width = 316
    const height = 360
    setNoteEditor({
      id: note.id,
      isNew,
      left: Math.min(Math.max(12, position.left), window.innerWidth - width - 12),
      top: Math.min(Math.max(12, position.top), window.innerHeight - height - 12)
    })
    setNoteDraft({ kind: note.kind, color: note.color, text: note.text, resolved: note.resolved })
  }

  const saveStickyNote = (): void => {
    if (!noteEditor || !noteDraft) return
    const text = noteDraft.text.trim()
    if (!text && noteEditor.isNew) {
      removeStickyNote(noteEditor.id)
      setNoteEditor(null)
      setNoteDraft(null)
      return
    }
    updateStickyNote(noteEditor.id, { ...noteDraft, text })
    flashStickyNote(noteEditor.id)
    setNoteEditor(null)
    setNoteDraft(null)
    notify(t("贴纸已保存"), 'success')
  }

  const deleteStickyNote = (): void => {
    if (!noteEditor) return
    if (!window.confirm(t("删除这条贴纸？"))) return
    removeStickyNote(noteEditor.id)
    setNoteEditor(null)
    setNoteDraft(null)
    notify(t("已删除贴纸"), 'success')
  }

  const askAgentFromSticky = (): void => {
    if (!noteEditor || !editingNote || !noteDraft) return
    const text = noteDraft.text.trim()
    if (!text) return
    updateStickyNote(noteEditor.id, { ...noteDraft, text })
    setNoteEditor(null)
    setNoteDraft(null)
    void openAgentQuote(text, editingNote.page)
  }

  const placeStickyNote = (
    pageNumber: number,
    x: number,
    y: number,
    position: { left: number; top: number }
  ): void => {
    if (noteEditorDirty) {
      notify(t("贴纸有未保存的修改，请先保存"), 'info')
      return
    }
    if (noteEditor?.isNew) removeStickyNote(noteEditor.id)
    const note = addStickyNote({
      page: pageNumber,
      kind: 'idea',
      color: stickyColor,
      x,
      y,
      text: ''
    })
    openStickyEditor(note, position, true)
  }

  const changeAnnotationTool = (next: AnnotationTool): void => {
    if (noteEditorDirty) {
      notify(t("贴纸有未保存的修改，请先保存"), 'info')
      return
    }
    if (noteEditor) {
      if (noteEditor.isNew) removeStickyNote(noteEditor.id)
      setNoteEditor(null)
      setNoteDraft(null)
    }
    setAnnotationTool(next)
  }

  const exitAnnotating = (): void => {
    if (noteEditorDirty) {
      notify(t("贴纸有未保存的修改，请先保存"), 'info')
      return
    }
    if (noteEditor?.isNew) removeStickyNote(noteEditor.id)
    setNoteEditor(null)
    setNoteDraft(null)
    setAnnotationTool('note')
    setAnnotating(false)
  }

  const toggleAnnotating = (): void => {
    if (annotating) {
      exitAnnotating()
      return
    }
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    setAiActionMenuOpen(false)
    setAnnotationTool('note')
    setAnnotating(true)
  }

  const changeTone = async (next: DocumentToneId): Promise<void> => {
    const previous = tone
    setTone(next)
    writeLastTone(next)
    try {
      await window.api.library.update(doc.id, { tone: next })
      await onChanged()
    } catch (error) {
      setTone(previous)
      notify(t("切换文献色调失败：{0}", [(error as Error).message]), 'error')
    }
  }

  const editingHighlight = editor ? docHighlights.find((highlight) => highlight.id === editor.id) ?? null : null

  const highlightEditorDirty =
    !!editingHighlight && (draftNote !== editingHighlight.note || draftColor !== editingHighlight.color)

  useUnsavedChanges('reader-highlight-editor', highlightEditorDirty)

  const closeHighlightEditor = (): void => {
    if (highlightEditorDirty) {
      notify(t("高亮批注有未保存的修改，请先保存"), 'info')
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
    setAnnotating(false)
    setAnnotationTool('note')
    setAnnotationsVisible(true)
    setNoteEditor(null)
    setNoteDraft(null)
    setFlashNoteId(null)
    setToneMenuOpen(false)
    setTone(isDocumentToneId(doc.tone) ? doc.tone : readLastTone())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  useEffect(() => {
    if (isDocumentToneId(doc.tone)) setTone(doc.tone)
  }, [doc.id, doc.tone])

  useEffect(() => {
    if (tone === 'night' && INK_COLORS.some((color) => color.value === inkColor)) {
      setInkColor(NIGHT_INK_COLORS[0].value)
    } else if (tone !== 'night' && NIGHT_INK_COLORS.some((color) => color.value === inkColor)) {
      setInkColor(INK_COLORS[0].value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone])

  useEffect(() => {
    if (noteEditor && !annotations.notes.some((note) => note.id === noteEditor.id)) {
      setNoteEditor(null)
      setNoteDraft(null)
    }
  }, [annotations.notes, noteEditor])

  useEffect(() => {
    return () => {
      if (noteFlashTimer.current) {
        window.clearTimeout(noteFlashTimer.current)
        noteFlashTimer.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!toneMenuOpen) return
    const close = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.reader-toolbar-menu-wrap')) return
      setToneMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [toneMenuOpen])

  useEffect(() => {
    if (!annotating && !toneMenuOpen) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redoAnnotation()
        else undoAnnotation()
        return
      }
      if (event.key === 'Escape') {
        if (toneMenuOpen) {
          setToneMenuOpen(false)
          return
        }
        if (noteEditor) {
          closeStickyEditor()
          return
        }
        exitAnnotating()
        return
      }
      if (!annotating || event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'v') changeAnnotationTool('select')
      else if (key === 'n') changeAnnotationTool('note')
      else if (key === 'p') changeAnnotationTool('pen')
      else if (key === 'm') changeAnnotationTool('marker')
      else if (key === 'e') changeAnnotationTool('eraser')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotating, toneMenuOpen, noteEditor, noteEditorDirty, undoAnnotation, redoAnnotation])

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
    // 用户正在输入页码时，滚动触发的翻页事件不能覆盖输入内容
    if (document.activeElement === pageInputRef.current) return
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
    setPageInput(String(target))
    setPage(target)
    pdfRef.current?.goToPage(target)
  }

  const openAgentQuote = async (text: string, pageNumber: number): Promise<void> => {
    setPanel('agent')
    if (detached) {
      try {
        await window.api.readerPanel.quote(doc.id, text, pageNumber)
      } catch (err) {
        notify(t("发送引用失败：{0}", [(err as Error).message]), 'error')
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
    const segment = t("> 第 {0} 页：{1}\n", [selection.page, selection.text])
    const base = doc.notes.trim()
    const next = base ? `${base}\n\n${segment}` : segment
    setPanel('notes')
    try {
      await window.api.library.update(doc.id, { notes: next })
      notify(t("已保存为笔记"), 'success')
      await onChanged()
    } catch (err) {
      notify(t("保存笔记失败：{0}", [(err as Error).message]), 'error')
    }
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const copySelection = async (): Promise<void> => {
    if (!selection) return
    await navigator.clipboard.writeText(selection.text).catch(() => undefined)
    notify(t("已复制原文"), 'success')
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
      notify(t("未能定位选区位置，请重新选择文字后再高亮"), 'error')
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
      notify(t("已添加高亮"), 'success')
    } catch (err) {
      notify(t("添加高亮失败：{0}", [(err as Error).message]), 'error')
    }
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const openHighlightEditor = (highlight: Highlight, position: { left: number; top: number }): void => {
    if (highlightEditorDirty) {
      notify(t("高亮批注有未保存的修改，请先保存"), 'info')
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
      notify(t("高亮已更新"), 'success')
    } catch (err) {
      notify(t("更新高亮失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const removeHighlight = async (id: string): Promise<void> => {
    if (!window.confirm(t("删除这条高亮？"))) return
    try {
      await window.api.highlights.remove(id)
      await onChanged()
      if (editor?.id === id) setEditor(null)
      notify(t("已删除高亮"), 'success')
    } catch (err) {
      notify(t("删除高亮失败：{0}", [(err as Error).message]), 'error')
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
        <button className="icon-btn" title={t("返回文献库")} onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="reader-title" title={doc.title}>
          {doc.title}
          {doc.pageCount === 0 && <span className="warn-tag">{t("未提取文本")}</span>}
        </div>

        <div className="page-controls">
          <button className="icon-btn" onClick={() => pdfRef.current?.prevPage()} title={t("上一页")}>
            <ChevronLeft size={17} />
          </button>
          <input
            ref={pageInputRef}
            className="page-input"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => goToPage(Number(pageInput) || page)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') goToPage(Number(pageInput) || page)
            }}
          />
          <span className="page-total">/ {pageCount || doc.pageCount || '-'}</span>
          <button className="icon-btn" onClick={() => pdfRef.current?.nextPage()} title={t("下一页")}>
            <ChevronRight size={17} />
          </button>
        </div>

        <div className="zoom-controls" title={t("Ctrl + 鼠标滚轮可缩放")}>
          <button className="icon-btn" onClick={() => pdfRef.current?.zoomOut()} title={t("缩小")}>
            <ZoomOut size={17} />
          </button>
          <button className="icon-btn" onClick={() => pdfRef.current?.zoomIn()} title={t("放大")}>
            <ZoomIn size={17} />
          </button>
          <button className="icon-btn" onClick={() => pdfRef.current?.fitWidth()} title={t("适应宽度")}>
            <Maximize size={16} />
          </button>
        </div>

        <div className="reader-toolbar-menu-wrap">
          <button
            className={cx('icon-btn', toneMenuOpen && 'active')}
            title={t("文献色调：{0}", [t(toneById(tone).label)])}
            onClick={() => setToneMenuOpen((open) => !open)}
          >
            <Palette size={17} />
          </button>
          {toneMenuOpen && (
            <DocumentToneMenu tone={tone} onSelect={(next) => void changeTone(next)} onClose={() => setToneMenuOpen(false)} />
          )}
        </div>

        {docFormat === 'pdf' && (
          <button
            className={cx('btn ghost small', annotating && 'active')}
            title={t("在文献任意位置添加贴纸、画笔与标注")}
            onClick={toggleAnnotating}
          >
            <PenLine size={15} /> {' '}{t("标注")}{' '}
          </button>
        )}

        {!translation && hasTranslation && (
          <button className="btn ghost small" onClick={onRestoreTranslation} title={t("重新显示翻译面板")}>
            <ScanLine size={15} /> {' '}{t("显示翻译")}{' '}</button>
        )}
        <button className="btn ghost small" onClick={() => void window.api.translate.start()} disabled={translateBusy}>
          <ScanLine size={15} /> {' '}{t("截图翻译")}{' '}</button>
      </div>

      {resumePrompt && (
        <div
          className="modal-backdrop resume-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setResumePrompt(false)}
        >
          <div className="modal resume-modal">
            <div className="modal-head">
              <div>
                <h3>{t("继续阅读？")}</h3>
                <p className="muted">{t("上次读到第")}{' '}{startPage} {' '}{t("页。默认继续阅读。")}</p>
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
                  {' '}{t("从头开始")}{' '}</button>
                <button className="btn primary" autoFocus onClick={() => setResumePrompt(false)}>
                  {' '}{t("继续阅读（第")}{' '}{startPage} {' '}{t("页）")}{' '}</button>
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
                <strong>{t("截图翻译")}</strong>
                <div className="muted small">{formatTime(translation.createdAt)}</div>
              </div>
              <div className="translation-drawer-head-actions">
                <button className="btn ghost small" onClick={onCloseTranslation}>
                  {' '}{t("收起")}{' '}</button>
                <button className="icon-btn" title={t("隐藏翻译面板")} onClick={onCloseTranslation}>
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
                  {' '}{t("原图")}{' '}</button>
                <button
                  className={cx('chip-button', translationImageMode === 'translated' && 'active')}
                  onClick={() => setTranslationImageMode('translated')}
                  disabled={!translation.translatedImageFile}
                >
                  {' '}{t("译文图")}{' '}</button>
              </div>
              <img
                className="translation-drawer-image"
                src={`zotfile://translations/${translationImageFile}`}
                alt={translationImageMode === 'translated' ? t("译文截图") : t("截图原文")}
              />
              <div className="translation-drawer-text">
                <Markdown>{translation.structured || translation.plain}</Markdown>
              </div>
            </div>
            <div className="translation-drawer-foot">
              <button className="link-btn" onClick={onOpenTranslations}>
                {' '}{t("在翻译栏目查看")}{' '}</button>
            </div>
          </aside>
        )}
        {translation && (
          <PaneResizer
            value={effectiveTranslationWidth}
            onChange={setTranslationWidth}
            label={t("调整翻译面板宽度")}
          />
        )}
        <div
          className={cx('reader-pdf', !annotationsVisible && 'annotations-hidden')}
          data-tone={tone}
        >
          {annotating && docFormat === 'pdf' && (
            <AnnotationToolbar
              tool={annotationTool}
              inkColor={inkColor}
              inkColors={inkPalette}
              inkWidth={inkWidth}
              stickyColor={stickyColor}
              canUndo={canUndoAnnotation}
              canRedo={canRedoAnnotation}
              visible={annotationsVisible}
              onTool={changeAnnotationTool}
              onInkColor={setInkColor}
              onInkWidth={setInkWidth}
              onStickyColor={setStickyColor}
              onUndo={undoAnnotation}
              onRedo={redoAnnotation}
              onClearPage={() => {
                if (window.confirm(t("清空第 {0} 页的全部墨迹？", [page]))) clearStrokes(page)
              }}
              onToggleVisible={() => setAnnotationsVisible((visible) => !visible)}
              onClose={exitAnnotating}
            />
          )}
          {!doc.fileName ? (
            <div className="empty-state" style={{ margin: 'auto' }}>
              <h2>{t("这是一条外部导入的文献记录")}</h2>
              <p className="muted">{t("尚未关联原始文件。你仍可查看右侧的文献信息、摘录与 AI 对话。")}</p>
            </div>
          ) : docFormat === 'pdf' ? (
          <PdfViewer
            key={doc.id}
            ref={pdfRef}
            docId={doc.id}
            initialPage={startPage}
            highlights={docHighlights}
            flashHighlightId={flashHighlightId}
            annotations={annotations}
            annotationMode={annotating}
            annotationTool={annotationTool}
            inkColor={inkColor}
            inkWidth={inkWidth}
            flashNoteId={flashNoteId}
            tone={tone}
            onPageChange={(nextPage) => {
              setPage(nextPage)
              if (!highlightEditorDirty) setEditor(null)
              if (!noteEditorDirty && noteEditor) {
                if (noteEditor.isNew) removeStickyNote(noteEditor.id)
                setNoteEditor(null)
                setNoteDraft(null)
              }
            }}
            onPagesLoaded={setPageCount}
            onSelection={(next) => {
              setSelection(next)
              setAiActionMenuOpen(false)
              if (next && !highlightEditorDirty) setEditor(null)
            }}
            onHighlightClick={openHighlightEditor}
            onPlaceNote={placeStickyNote}
            onNoteClick={(note, position) => openStickyEditor(note, position)}
            onNoteMove={(note, x, y) => updateStickyNote(note.id, { x, y })}
            onStroke={addStroke}
            onEraseStroke={removeStroke}
            onOutline={(items) => {
              setOutline(items)
              setOutlineLoaded(true)
            }}
          />
          ) : (
          <TextViewer
            key={doc.id}
            ref={pdfRef}
            docId={doc.id}
            markdown={docFormat === 'md'}
            initialPage={startPage}
            highlights={docHighlights}
            flashHighlightId={flashHighlightId}
            onPageChange={(nextPage) => {
              setPage(nextPage)
              if (!highlightEditorDirty) setEditor(null)
              if (!noteEditorDirty && noteEditor) {
                if (noteEditor.isNew) removeStickyNote(noteEditor.id)
                setNoteEditor(null)
                setNoteDraft(null)
              }
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
              label={t("调整右侧栏宽度")}
            />
            <aside className="reader-panel" style={{ width: effectivePanelWidth }}>
              <ReaderSidePanel
                doc={doc}
                documents={documents}
                chats={chats}
                collections={collections}
                highlights={highlights}
                annotations={annotations}
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
                onRevealNote={(note) => {
                  goToPage(note.page)
                  flashStickyNote(note.id)
                }}
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
          <div className="hl-swatches" title={t("高亮选中文字")}>
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                className={`hl-swatch hl-${color.value}`}
                title={t("高亮（{0}）", [t(color.label)])}
                onClick={() => void addHighlight(color.value)}
              />
            ))}
          </div>
          <span className="toolbar-divider" />
          <button onClick={() => void askAgent()}>
            <Sparkles size={14} /> {' '}{t("问 Agent")}{' '}</button>
          <div className="selection-action-wrap">
            <button title={t("AI 动作：翻译、摘要、解释公式、对比文献")} onClick={() => setAiActionMenuOpen((open) => !open)}>
              <Sparkles size={14} /> {' '}{t("AI 动作")}{' '}<ChevronDown size={14} />
            </button>
            {aiActionMenuOpen && (
              <div className="selection-action-menu">
                {AI_ACTIONS.map((action) => (
                  <button key={action.id} onClick={() => startAiAction(action.id)} title={t(action.hint)}>
                    <span>{t(action.label)}</span>
                    <span className="muted">{t(action.hint)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => void saveSelectionAsNote()}>
            <StickyNote size={14} /> {' '}{t("存为笔记")}{' '}</button>
          <button onClick={() => void copySelection()}>
            <Copy size={14} /> {' '}{t("复制")}{' '}</button>
          <button
            className="close"
            title={t("取消")}
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
              <Highlighter size={13} /> {' '}{t("第")}{' '}{editingHighlight.page} {' '}{t("页高亮")}{' '}</span>
            <button className="icon-btn tiny" title={t("关闭")} onClick={closeHighlightEditor}>
              <X size={13} />
            </button>
          </div>
          <div className="highlight-editor-text">{editingHighlight.text}</div>
          <div className="hl-swatches editor">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                className={cx('hl-swatch', `hl-${color.value}`, draftColor === color.value && 'active')}
                title={t("改为{0}色", [t(color.label)])}
                onClick={() => setDraftColor(color.value)}
              />
            ))}
          </div>
          <textarea
            rows={3}
            className="highlight-note-input"
            placeholder={t("添加批注…")}
            value={draftNote}
            onChange={(event) => setDraftNote(event.target.value)}
          />
          <div className="highlight-editor-actions">
            <button className="btn ghost small danger" onClick={() => void removeHighlight(editingHighlight.id)}>
              <Trash2 size={13} /> {' '}{t("删除")}{' '}</button>
            <button className="btn primary small" onClick={() => void saveHighlightEditor()}>
              <Save size={13} /> {' '}{t("保存")}{' '}</button>
          </div>
        </div>
      )}

      {noteEditor && editingNote && noteDraft && (
        <StickyNoteEditor
          page={editingNote.page}
          isNew={noteEditor.isNew}
          kind={noteDraft.kind}
          color={noteDraft.color}
          text={noteDraft.text}
          resolved={noteDraft.resolved}
          position={{ left: noteEditor.left, top: noteEditor.top }}
          canAskAgent={Boolean(noteDraft.text.trim())}
          onChange={(patch) => setNoteDraft((current) => (current ? { ...current, ...patch } : current))}
          onSave={saveStickyNote}
          onClose={closeStickyEditor}
          onDelete={deleteStickyNote}
          onAskAgent={askAgentFromSticky}
        />
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
