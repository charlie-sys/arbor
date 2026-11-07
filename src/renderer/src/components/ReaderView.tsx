import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookmarkPlus,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Highlighter,
  Info,
  ListTodo,
  Maximize,
  MessageSquarePlus,
  PenLine,
  Plus,
  Save,
  ScanLine,
  Sparkles,
  StickyNote,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { AiActionId, ChatSession, Collection, DocumentMeta, Excerpt, Highlight, HighlightColor, ReadingStatus, TaskItem, TranslationRecord } from '@shared/types'
import { AI_ACTIONS } from '@shared/aiActions'
import PdfViewer, { type PdfOutlineItem, type PdfSelection, type PdfViewerHandle } from './PdfViewer'
import ChatThread from './ChatThread'
import ComposeModal from './ComposeModal'
import AiActionPanel from './AiActionPanel'
import PaneResizer from './PaneResizer'
import MarkdownEditorModal from './MarkdownEditorModal'
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

type Panel = 'agent' | 'info' | 'notes' | 'highlights' | 'outline' | 'excerpts' | 'tasks'

interface FallbackTocEntry {
  page: number
  title: string
}

function OutlineNode({
  item,
  depth,
  onJump
}: {
  item: PdfOutlineItem
  depth: number
  onJump(page: number): void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const hasChildren = item.children.length > 0
  return (
    <div className="outline-node">
      <div className="outline-row" style={{ paddingLeft: 8 + depth * 14 }}>
        {hasChildren ? (
          <button className="outline-toggle" title={open ? '收起' : '展开'} onClick={() => setOpen((value) => !value)}>
            <ChevronRight size={13} className={cx('outline-chevron', open && 'open')} />
          </button>
        ) : (
          <span className="outline-toggle placeholder" />
        )}
        <button
          className="outline-title"
          disabled={item.page === null}
          title={item.title}
          onClick={() => item.page !== null && onJump(item.page)}
        >
          {item.title}
        </button>
        {item.page !== null && <span className="outline-page">{item.page}</span>}
      </div>
      {hasChildren && open && (
        <div className="outline-children">
          {item.children.map((child, index) => (
            <OutlineNode key={`${child.title}-${index}`} item={child} depth={depth + 1} onJump={onJump} />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskRow({
  task,
  todayKey,
  onToggle,
  onRemove
}: {
  task: TaskItem
  todayKey: string
  onToggle(task: TaskItem): void
  onRemove(task: TaskItem): void
}): React.JSX.Element {
  return (
    <div className={cx('task-item', task.done && 'done')}>
      <button
        className={cx('task-check', task.done && 'checked')}
        title={task.done ? '标记未完成' : '标记完成'}
        onClick={() => onToggle(task)}
      >
        {task.done && <Check size={12} />}
      </button>
      <span className={cx('task-title', task.done && 'done')}>{task.title}</span>
      {task.due && (
        <span className={cx('task-due', !task.done && task.due < todayKey && 'overdue')}>{task.due.slice(5)}</span>
      )}
      <button className="icon-btn tiny" title="删除任务" onClick={() => onRemove(task)}>
        <Trash2 size={12} />
      </button>
    </div>
  )
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
  const startPage = initialPage && initialPage > 0 ? initialPage : doc.lastPage || 1
  const [page, setPage] = useState(startPage)
  const [pageInput, setPageInput] = useState(String(startPage))
  const [pageCount, setPageCount] = useState(doc.pageCount)
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const [aiActionMenuOpen, setAiActionMenuOpen] = useState(false)
  const [actionRequest, setActionRequest] = useState<{ action: AiActionId; text: string; page: number } | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [composeChat, setComposeChat] = useState<ChatSession | null>(null)
  const [flashHighlightId, setFlashHighlightId] = useState<string | null>(null)
  const [editor, setEditor] = useState<HighlightEditorState | null>(null)
  const [draftNote, setDraftNote] = useState('')
  const [draftColor, setDraftColor] = useState<HighlightColor>('yellow')
  const [outline, setOutline] = useState<PdfOutlineItem[]>([])
  const [outlineLoaded, setOutlineLoaded] = useState(false)
  const [fallbackToc, setFallbackToc] = useState<FallbackTocEntry[]>([])
  const [fallbackOpen, setFallbackOpen] = useState(false)

  const [title, setTitle] = useState(doc.title)
  const [authors, setAuthors] = useState(doc.authors)
  const [year, setYear] = useState(doc.year)
  const [journal, setJournal] = useState(doc.journal)
  const [doi, setDoi] = useState(doc.doi)
  const [url, setUrl] = useState(doc.url)
  const [abstract, setAbstract] = useState(doc.abstract)
  const [tags, setTags] = useState(doc.tags.join(', '))
  const [selectedCollections, setSelectedCollections] = useState<string[]>(doc.collections)
  const [notes, setNotes] = useState(doc.notes)
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>(doc.readingStatus ?? 'unread')
  const [notesDirty, setNotesDirty] = useState(false)
  const [notesPreview, setNotesPreview] = useState(true)
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
  const effectivePanelWidth = Math.min(900, Math.max(480, Math.round(viewportWidth * panelRatio)))
  const effectiveTranslationWidth = Math.min(640, Math.max(320, Math.round(viewportWidth * translationRatio)))
  const setPanelWidth = (value: number): void => {
    const ratio = Math.min(0.55, Math.max(0.24, value / viewportWidth))
    setPanelRatioState(ratio)
    window.localStorage.setItem('zotagent-reader-panel-ratio-v3', String(ratio))
  }
  const setTranslationWidth = (value: number): void => {
    const ratio = Math.min(0.45, Math.max(0.18, value / viewportWidth))
    setTranslationRatioState(ratio)
    window.localStorage.setItem('zotagent-translation-ratio-v3', String(ratio))
  }
  const [saving, setSaving] = useState(false)
  const [editingExcerpt, setEditingExcerpt] = useState<Excerpt | null>(null)
  const [viewingExcerpt, setViewingExcerpt] = useState<Excerpt | null>(null)
  const [excerptQuestion, setExcerptQuestion] = useState('')
  const [excerptAnswer, setExcerptAnswer] = useState('')
  const [excerptSource, setExcerptSource] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState('')

  const sortedExcerpts = useMemo(
    () => excerpts.filter((excerpt) => excerpt.docId === doc.id).sort((a, b) => b.createdAt - a.createdAt),
    [excerpts, doc.id]
  )

  const docChats = useMemo(
    () => chats.filter((chat) => chat.docIds.includes(doc.id)).sort((a, b) => b.updatedAt - a.updatedAt),
    [chats, doc.id]
  )
  const activeChat = docChats.find((chat) => chat.id === activeChatId) ?? null

  const docHighlights = useMemo(
    () =>
      highlights
        .filter((highlight) => highlight.docId === doc.id)
        .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),
    [highlights, doc.id]
  )
  const highlightGroups = useMemo(() => {
    const groups = new Map<number, Highlight[]>()
    for (const highlight of docHighlights) {
      const list = groups.get(highlight.page) ?? []
      list.push(highlight)
      groups.set(highlight.page, list)
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0])
  }, [docHighlights])
  const editingHighlight = editor ? docHighlights.find((highlight) => highlight.id === editor.id) ?? null : null

  const metaDirty =
    title !== doc.title ||
    authors !== doc.authors ||
    year !== doc.year ||
    journal !== doc.journal ||
    doi !== doc.doi ||
    url !== doc.url ||
    abstract !== doc.abstract ||
    tags !== doc.tags.join(', ') ||
    readingStatus !== (doc.readingStatus ?? 'unread') ||
    selectedCollections.length !== doc.collections.length ||
    selectedCollections.some((id) => !doc.collections.includes(id))
  const excerptEditorDirty =
    !!editingExcerpt &&
    (excerptQuestion !== editingExcerpt.question ||
      excerptAnswer !== editingExcerpt.answer ||
      excerptSource !== editingExcerpt.source)
  const highlightEditorDirty =
    !!editingHighlight && (draftNote !== editingHighlight.note || draftColor !== editingHighlight.color)

  useUnsavedChanges(`reader-notes-${doc.id}`, notesDirty)
  useUnsavedChanges(`reader-meta-${doc.id}`, metaDirty)
  useUnsavedChanges('reader-excerpt-editor', excerptEditorDirty)
  useUnsavedChanges('reader-highlight-editor', highlightEditorDirty)

  const closeExcerptEditor = (): void => {
    if (excerptEditorDirty) {
      notify('摘录有未保存的修改，请先保存', 'info')
      return
    }
    setEditingExcerpt(null)
  }

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
    setActiveChatId(null)
    setTitle(doc.title)
    setAuthors(doc.authors)
    setYear(doc.year)
    setJournal(doc.journal)
    setDoi(doc.doi)
    setUrl(doc.url)
    setAbstract(doc.abstract)
    setTags(doc.tags.join(', '))
    setSelectedCollections(doc.collections)
    setNotes(doc.notes)
    setReadingStatus(doc.readingStatus ?? 'unread')
    setNotesDirty(false)
    setSelection(null)
    setEditor(null)
    setFlashHighlightId(null)
    setOutline([])
    setOutlineLoaded(false)
    setFallbackToc([])
    setFallbackOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  useEffect(() => {
    if (!notesDirty) setNotes(doc.notes)
  }, [doc.notes, notesDirty])

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

  const chatIds = docChats.map((chat) => chat.id).join(',')
  useEffect(() => {
    if (!docChats.length) {
      setActiveChatId(null)
      return
    }
    if (!activeChatId || !docChats.some((chat) => chat.id === activeChatId)) {
      setActiveChatId(docChats[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, chatIds, activeChatId])

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
        setReadingStatus('reading')
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
    const target = Math.min(Math.max(1, value), pageCount || doc.pageCount || 1)
    pdfRef.current?.goToPage(target)
    setPage(target)
  }

  const createChat = async (): Promise<void> => {
    const emptyChat = docChats.find((chat) => chat.messages.length === 0)
    if (emptyChat) {
      setActiveChatId(emptyChat.id)
      setPanel('agent')
      return
    }
    try {
      const chat = await window.api.chats.create([doc.id])
      await onChanged()
      setActiveChatId(chat.id)
      setPanel('agent')
    } catch (err) {
      notify(`创建对话失败：${(err as Error).message}`, 'error')
    }
  }

  const deleteChat = async (chatId: string): Promise<void> => {
    if (!window.confirm('删除这个对话？')) return
    try {
      await window.api.chats.remove(chatId)
      if (activeChatId === chatId) setActiveChatId(null)
      await onChanged()
    } catch (err) {
      notify(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  const openAgentQuote = async (text: string, pageNumber: number): Promise<void> => {
    setPanel('agent')
    try {
      if (!activeChatId || !docChats.some((chat) => chat.id === activeChatId)) {
        const chat = await window.api.chats.create([doc.id])
        await onChanged()
        setActiveChatId(chat.id)
      }
      setQuote({ text, page: pageNumber, nonce: Date.now() })
    } catch (err) {
      notify(`创建对话失败：${(err as Error).message}`, 'error')
    }
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
    const next = notes.trim() ? `${notes.trim()}\n\n${segment}` : segment
    setNotes(next)
    setNotesDirty(true)
    setPanel('notes')
    try {
      await window.api.library.update(doc.id, { notes: next })
      setNotesDirty(false)
      notify('已保存为笔记', 'success')
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

  const jumpToHighlight = (highlight: Highlight): void => {
    goToPage(highlight.page)
    flashHighlight(highlight.id)
  }

  const openExcerptEditor = (excerpt: Excerpt): void => {
    setEditingExcerpt(excerpt)
    setExcerptQuestion(excerpt.question)
    setExcerptAnswer(excerpt.answer)
    setExcerptSource(excerpt.source)
  }

  const saveExcerptEditor = async (): Promise<void> => {
    if (!editingExcerpt) return
    try {
      await window.api.excerpts.update(editingExcerpt.id, {
        question: excerptQuestion,
        answer: excerptAnswer,
        source: excerptSource
      })
      setEditingExcerpt(null)
      notify('摘录已更新', 'success')
      void onChanged()
    } catch (err) {
      notify(`更新摘录失败：${(err as Error).message}`, 'error')
    }
  }

  const removeExcerpt = async (excerpt: Excerpt): Promise<void> => {
    if (!window.confirm('删除这条摘录？')) return
    try {
      await window.api.excerpts.remove(excerpt.id)
      if (editingExcerpt?.id === excerpt.id) setEditingExcerpt(null)
      if (viewingExcerpt?.id === excerpt.id) setViewingExcerpt(null)
      notify('摘录已删除', 'success')
      void onChanged()
    } catch (err) {
      notify(`删除摘录失败：${(err as Error).message}`, 'error')
    }
  }

  const jumpToExcerpt = (excerpt: Excerpt): void => {
    if (excerpt.docMissing || !excerpt.docId) {
      notify('来源文献已删除，无法跳转', 'info')
      return
    }
    if (excerpt.docId === doc.id) {
      if (excerpt.page) goToPage(excerpt.page)
      return
    }
    onOpenDoc?.(excerpt.docId, excerpt.page)
  }

  const toggleTask = async (task: TaskItem): Promise<void> => {
    try {
      await window.api.tasks.update(task.id, { done: !task.done })
      await onChanged()
    } catch (err) {
      notify(`更新任务失败：${(err as Error).message}`, 'error')
    }
  }

  const createTask = async (): Promise<void> => {
    const value = taskTitle.trim()
    if (!value) return
    try {
      await window.api.tasks.add({ title: value, due: taskDue || undefined, docId: doc.id })
      setTaskTitle('')
      setTaskDue('')
      await onChanged()
      notify('任务已创建', 'success')
    } catch (err) {
      notify(`创建任务失败：${(err as Error).message}`, 'error')
    }
  }

  const removeTask = async (task: TaskItem): Promise<void> => {
    if (!window.confirm(`删除任务「${task.title}」？`)) return
    try {
      await window.api.tasks.remove(task.id)
      await onChanged()
    } catch (err) {
      notify(`删除任务失败：${(err as Error).message}`, 'error')
    }
  }

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const openTasks = tasks.filter((task) => !task.done)
  const dueTodayTasks = openTasks.filter((task) => task.due === todayKey)
  const otherOpenTasks = openTasks.filter((task) => task.due !== todayKey)
  const doneTasks = tasks.filter((task) => task.done)

  const saveMeta = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.library.update(doc.id, {
        title: title.trim() || '未命名文献',
        authors: authors.trim(),
        year: year.trim(),
        journal: journal.trim(),
        doi: doi.trim(),
        url: url.trim(),
        abstract: abstract.trim(),
        tags: tags
          .split(/[,，;；]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        collections: selectedCollections,
        readingStatus
      })
      await onChanged()
      notify('文献信息已保存', 'success')
    } catch (err) {
      notify(`保存失败：${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveNotes = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.library.update(doc.id, { notes })
      setNotesDirty(false)
      setNotesPreview(true)
      notify('笔记已保存', 'success')
      void onChanged()
    } catch (err) {
      notify(`保存失败：${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleCollection = (id: string): void => {
    setSelectedCollections((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
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
            min={280}
            max={620}
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

        <PaneResizer
          value={effectivePanelWidth}
          onChange={setPanelWidth}
          min={300}
          max={640}
          invert
          label="调整右侧栏宽度"
        />
        <aside className="reader-panel" style={{ width: effectivePanelWidth }}>
          <div className="panel-tabs">
            <button
              className={cx('panel-tab', panel === 'agent' && 'active')}
              onClick={() => setPanel('agent')}
              title="AI 助手"
            >
              <Sparkles size={14} /> <span className="tab-label">AI 助手</span>
            </button>
            <button
              className={cx('panel-tab', panel === 'outline' && 'active')}
              onClick={() => setPanel('outline')}
              title="大纲"
            >
              <BookOpen size={14} /> <span className="tab-label">大纲</span>
            </button>
            <button
              className={cx('panel-tab', panel === 'highlights' && 'active')}
              onClick={() => setPanel('highlights')}
              title="高亮"
            >
              <Highlighter size={14} /> <span className="tab-label">高亮</span>
              {docHighlights.length > 0 && <span className="tab-count">{docHighlights.length}</span>}
            </button>
            <button
              className={cx('panel-tab', panel === 'excerpts' && 'active')}
              onClick={() => setPanel('excerpts')}
              title="摘录"
            >
              <BookmarkPlus size={14} /> <span className="tab-label">摘录</span>
              {sortedExcerpts.length > 0 && <span className="tab-count">{sortedExcerpts.length}</span>}
            </button>
            <button
              className={cx('panel-tab', panel === 'info' && 'active')}
              onClick={() => setPanel('info')}
              title="文献信息"
            >
              <Info size={14} /> <span className="tab-label">文献信息</span>
            </button>
            <button
              className={cx('panel-tab', panel === 'notes' && 'active')}
              onClick={() => setPanel('notes')}
              title="笔记"
            >
              <StickyNote size={14} /> <span className="tab-label">笔记</span>
              {notesDirty && <span className="dot" />}
            </button>
            <button
              className={cx('panel-tab', panel === 'tasks' && 'active')}
              onClick={() => setPanel('tasks')}
              title="任务"
            >
              <ListTodo size={14} /> <span className="tab-label">任务</span>
              {openTasks.length > 0 && <span className="tab-count">{openTasks.length}</span>}
            </button>
          </div>

          {panel === 'agent' && (
            <div className="panel-body agent-panel">
              <div className="chat-switcher">
                <div className="chat-pills">
                  {docChats.map((chat) => (
                    <button
                      key={chat.id}
                      className={cx('chat-pill', chat.id === activeChatId && 'active')}
                      title={`${chat.title} · ${formatTime(chat.updatedAt)}`}
                      onClick={() => setActiveChatId(chat.id)}
                    >
                      <span>{chat.title.length > 14 ? `${chat.title.slice(0, 14)}…` : chat.title}</span>
                      <span
                        className="pill-delete"
                        role="button"
                        tabIndex={-1}
                        onClick={(event) => {
                          event.stopPropagation()
                          void deleteChat(chat.id)
                        }}
                      >
                        <Trash2 size={11} />
                      </span>
                    </button>
                  ))}
                  <button className="icon-btn tiny" title="新建对话" onClick={() => void createChat()}>
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {activeChat ? (
                <ChatThread
                  key={activeChat.id}
                  chat={activeChat}
                  docs={[doc]}
                  quote={quote}
                  currentPage={page}
                  compact
                  onChanged={onChanged}
                  onCompose={(chat) => setComposeChat(chat)}
                  notify={notify}
                  openPage={(docId, targetPage) => {
                    if (docId === doc.id) goToPage(targetPage)
                  }}
                  onQuoteApplied={() => setQuote(null)}
                />
              ) : (
                <div className="panel-empty">
                  <MessageSquarePlus size={26} />
                  <h3>针对本文提问</h3>
                  <p className="muted">选中 PDF 中的文字可直接“问 Agent”；回答会标注原文页码。</p>
                  <button className="btn primary" onClick={() => void createChat()}>
                    <Plus size={15} /> 新建对话
                  </button>
                </div>
              )}
            </div>
          )}

          {panel === 'outline' && (
            <div className="panel-body outline-panel">
              {!outlineLoaded ? (
                <div className="panel-empty">
                  <BookOpen size={24} />
                  <p className="muted">正在读取目录…</p>
                </div>
              ) : outline.length > 0 ? (
                <div className="outline-tree">
                  {outline.map((item, index) => (
                    <OutlineNode key={`${item.title}-${index}`} item={item} depth={0} onJump={goToPage} />
                  ))}
                </div>
              ) : fallbackToc.length === 0 ? (
                <div className="panel-empty">
                  <BookOpen size={24} />
                  <h3>暂无目录</h3>
                  <p className="muted">该 PDF 没有书签，且尚无可用的文本首行。</p>
                </div>
              ) : (
                <div className="outline-fallback">
                  <button className="outline-fallback-head" onClick={() => setFallbackOpen((value) => !value)}>
                    <ChevronRight size={13} className={cx('outline-chevron', fallbackOpen && 'open')} />
                    <span>按页首行生成（{fallbackToc.length} 页）</span>
                  </button>
                  {fallbackOpen && (
                    <div className="outline-fallback-list">
                      {fallbackToc.map((entry) => (
                        <div
                          key={entry.page}
                          className="outline-row fallback"
                          role="button"
                          tabIndex={0}
                          title={entry.title}
                          onClick={() => goToPage(entry.page)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') goToPage(entry.page)
                          }}
                        >
                          <span className="outline-title">{entry.title}</span>
                          <span className="outline-page">{entry.page}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {panel === 'info' && (
            <div className="panel-body info-panel">
              <label className="field">
                <span>标题</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="field">
                <span>作者</span>
                <input value={authors} onChange={(event) => setAuthors(event.target.value)} placeholder="多个作者用分号分隔" />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>年份</span>
                  <input value={year} onChange={(event) => setYear(event.target.value)} placeholder="2024" />
                </label>
                <label className="field">
                  <span>期刊 / 会议</span>
                  <input value={journal} onChange={(event) => setJournal(event.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>DOI</span>
                <input value={doi} onChange={(event) => setDoi(event.target.value)} />
              </label>
              <label className="field">
                <span>链接</span>
                <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />
              </label>
              <label className="field">
                <span>标签</span>
                <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用逗号分隔，例如：大模型, 综述" />
              </label>
              <div className="field">
                <span>分类</span>
                {collections.length === 0 ? (
                  <div className="muted small">尚未创建分类（可在左侧栏新建）</div>
                ) : (
                  <div className="collection-checks">
                    {collections.map((collection) => (
                      <label key={collection.id} className="check-item">
                        <input
                          type="checkbox"
                          checked={selectedCollections.includes(collection.id)}
                          onChange={() => toggleCollection(collection.id)}
                        />
                        {collection.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <label className="field">
                <span>阅读状态</span>
                <select
                  className="select"
                  value={readingStatus}
                  onChange={(event) => setReadingStatus(event.target.value as ReadingStatus)}
                >
                  <option value="unread">未读</option>
                  <option value="reading">阅读中</option>
                  <option value="read">已读</option>
                </select>
              </label>
              <label className="field">
                <span>摘要</span>
                <textarea rows={5} value={abstract} onChange={(event) => setAbstract(event.target.value)} />
              </label>
              <button className="btn primary full" onClick={() => void saveMeta()} disabled={saving}>
                <Save size={15} /> {saving ? '保存中…' : '保存文献信息'}
              </button>
            </div>
          )}

          {panel === 'notes' && (
            <div className="panel-body notes-panel">
              <div className="notes-head">
                <div>
                  <div className="notes-title">阅读笔记</div>
                  <div className="muted small">{notesDirty ? '有未保存的修改' : '已保存'}</div>
                </div>
                <div className="notes-head-actions">
                  <button className="btn ghost small" onClick={() => setNotesPreview((value) => !value)}>
                    {notesPreview ? '编辑' : '预览'}
                  </button>
                  <button className="btn primary small" onClick={() => void saveNotes()} disabled={saving || !notesDirty}>
                    <Save size={14} /> 保存笔记
                  </button>
                </div>
              </div>
              {notesPreview ? (
                <div className="notes-preview">
                  {notes.trim() ? (
                    <Markdown>{notes}</Markdown>
                  ) : (
                    <div className="muted small">暂无笔记。切到「编辑」开始记录，支持 Markdown 与 LaTeX。</div>
                  )}
                </div>
              ) : (
                <textarea
                  className="notes-editor"
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value)
                    setNotesDirty(true)
                  }}
                  placeholder="记录阅读心得、选中文本保存的摘录、待办问题…支持 Markdown 与 LaTeX"
                />
              )}
            </div>
          )}

          {panel === 'highlights' && (
            <div className="panel-body highlights-panel">
              {docHighlights.length === 0 ? (
                <div className="panel-empty">
                  <Highlighter size={26} />
                  <h3>还没有高亮</h3>
                  <p className="muted">在 PDF 中选中文字，选择颜色即可创建高亮。</p>
                </div>
              ) : (
                <div className="highlight-list">
                  {highlightGroups.map(([pageNumber, items]) => (
                    <div className="highlight-group" key={pageNumber}>
                      <div className="highlight-group-head">
                        <span>第 {pageNumber} 页</span>
                        <span className="muted small">{items.length} 条</span>
                      </div>
                      {items.map((highlight) => (
                        <div
                          key={highlight.id}
                          className="highlight-item"
                          role="button"
                          tabIndex={0}
                          title="点击跳转到原文"
                          onClick={() => jumpToHighlight(highlight)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') jumpToHighlight(highlight)
                          }}
                        >
                          <span className={`highlight-color hl-${highlight.color}`} />
                          <span className="highlight-body">
                            <span className="highlight-text">{highlight.text}</span>
                            {highlight.note && <span className="highlight-note">{highlight.note}</span>}
                          </span>
                          <span className="highlight-page">p.{highlight.page}</span>
                          <span
                            className="pill-delete"
                            role="button"
                            tabIndex={-1}
                            title="删除高亮"
                            onClick={(event) => {
                              event.stopPropagation()
                              void removeHighlight(highlight.id)
                            }}
                          >
                            <Trash2 size={11} />
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {panel === 'excerpts' && (
            <div className="panel-body excerpts-panel">
              {sortedExcerpts.length === 0 ? (
                <div className="panel-empty">
                  <BookmarkPlus size={26} />
                  <h3>还没有摘录</h3>
                  <p className="muted">在 AI 回答上点击「存为摘录」，即可把问答与页码沉淀到这里。</p>
                </div>
              ) : (
                <div className="excerpt-list">
                  {sortedExcerpts.map((excerpt) => (
                    <div
                      key={excerpt.id}
                      className={cx('excerpt-item', 'clickable', excerpt.docMissing && 'missing')}
                      role="button"
                      tabIndex={0}
                      title="点击查看完整摘录"
                      onClick={() => setViewingExcerpt(excerpt)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setViewingExcerpt(excerpt)
                        }
                      }}
                    >
                      <div className="excerpt-head">
                        <span className="excerpt-doc" title={excerpt.docTitle}>
                          {excerpt.docTitle}
                        </span>
                        {excerpt.page ? <span className="excerpt-page">p.{excerpt.page}</span> : null}
                      </div>
                      {excerpt.docMissing && <div className="excerpt-missing">来源已删除</div>}
                      {excerpt.source && <div className="excerpt-source">{excerpt.source}</div>}
                      {excerpt.question && (
                        <div className="excerpt-question">
                          <Markdown>{excerpt.question}</Markdown>
                        </div>
                      )}
                      {excerpt.answer && (
                        <div className="excerpt-answer">
                          <Markdown>{excerpt.answer}</Markdown>
                        </div>
                      )}
                      <div className="excerpt-foot">
                        <span className="muted small">{formatTime(excerpt.createdAt)}</span>
                        <div className="excerpt-actions">
                          <button
                            className="link-btn"
                            onClick={(event) => {
                              event.stopPropagation()
                              jumpToExcerpt(excerpt)
                            }}
                          >
                            跳回原文
                          </button>
                          <button
                            className="icon-btn tiny"
                            title="编辑摘录"
                            onClick={(event) => {
                              event.stopPropagation()
                              openExcerptEditor(excerpt)
                            }}
                          >
                            <PenLine size={12} />
                          </button>
                          <button
                            className="icon-btn tiny"
                            title="删除摘录"
                            onClick={(event) => {
                              event.stopPropagation()
                              void removeExcerpt(excerpt)
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {panel === 'tasks' && (
            <div className="panel-body tasks-panel">
              <div className="task-add-row">
                <input
                  className="task-input"
                  value={taskTitle}
                  placeholder="添加任务，回车确认"
                  onChange={(event) => setTaskTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void createTask()
                  }}
                />
                <input
                  className="task-date"
                  type="date"
                  value={taskDue}
                  title="截止日期"
                  onChange={(event) => setTaskDue(event.target.value)}
                />
                <button className="btn small primary" disabled={!taskTitle.trim()} onClick={() => void createTask()}>
                  <Plus size={13} /> 添加
                </button>
              </div>
              {tasks.length === 0 ? (
                <div className="panel-empty">
                  <ListTodo size={26} />
                  <h3>还没有任务</h3>
                  <p className="muted">在这里添加任务，或用 Ctrl+N 捕获待办。</p>
                </div>
              ) : (
                <div className="task-groups">
                  {dueTodayTasks.length > 0 && (
                    <div className="task-group">
                      <div className="task-group-head">今日到期</div>
                      {dueTodayTasks.map((task) => (
                        <TaskRow key={task.id} task={task} todayKey={todayKey} onToggle={(item) => void toggleTask(item)} onRemove={(item) => void removeTask(item)} />
                      ))}
                    </div>
                  )}
                  {otherOpenTasks.length > 0 && (
                    <div className="task-group">
                      <div className="task-group-head">未完成</div>
                      {otherOpenTasks.map((task) => (
                        <TaskRow key={task.id} task={task} todayKey={todayKey} onToggle={(item) => void toggleTask(item)} onRemove={(item) => void removeTask(item)} />
                      ))}
                    </div>
                  )}
                  {openTasks.length === 0 && <div className="task-group-empty">全部任务已完成</div>}
                  {doneTasks.length > 0 && (
                    <div className="task-group">
                      <div className="task-group-head">已完成 {doneTasks.length}</div>
                      {doneTasks.map((task) => (
                        <TaskRow key={task.id} task={task} todayKey={todayKey} onToggle={(item) => void toggleTask(item)} onRemove={(item) => void removeTask(item)} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
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

      {viewingExcerpt && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setViewingExcerpt(null)}
        >
          <div className="modal excerpt-detail-modal">
            <div className="modal-head">
              <div>
                <h3>摘录详情</h3>
                <p className="muted">
                  {viewingExcerpt.docTitle}
                  {viewingExcerpt.page ? ` · 第 ${viewingExcerpt.page} 页` : ''}
                  {viewingExcerpt.docMissing ? ' · 来源已删除' : ''}
                </p>
              </div>
              <button className="icon-btn" title="关闭" onClick={() => setViewingExcerpt(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="excerpt-detail-body">
              {viewingExcerpt.source && (
                <section className="excerpt-detail-section">
                  <div className="excerpt-detail-label">原文引用</div>
                  <blockquote className="excerpt-detail-quote">{viewingExcerpt.source}</blockquote>
                </section>
              )}
              {viewingExcerpt.question && (
                <section className="excerpt-detail-section">
                  <div className="excerpt-detail-label">问题</div>
                  <div className="excerpt-detail-content">
                    <Markdown>{viewingExcerpt.question}</Markdown>
                  </div>
                </section>
              )}
              {viewingExcerpt.answer && (
                <section className="excerpt-detail-section">
                  <div className="excerpt-detail-label">回答 / 摘要</div>
                  <div className="excerpt-detail-content">
                    <Markdown>{viewingExcerpt.answer}</Markdown>
                  </div>
                </section>
              )}
            </div>
            <div className="modal-foot">
              <div className="muted small">{formatTime(viewingExcerpt.createdAt)}</div>
              <div className="modal-actions">
                <button
                  className="btn ghost"
                  disabled={viewingExcerpt.docMissing}
                  onClick={() => {
                    const item = viewingExcerpt
                    setViewingExcerpt(null)
                    jumpToExcerpt(item)
                  }}
                >
                  跳回原文
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    const item = viewingExcerpt
                    setViewingExcerpt(null)
                    openExcerptEditor(item)
                  }}
                >
                  <PenLine size={14} /> 编辑
                </button>
                <button className="btn ghost danger" onClick={() => void removeExcerpt(viewingExcerpt)}>
                  <Trash2 size={14} /> 删除
                </button>
                <button className="btn primary" onClick={() => setViewingExcerpt(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingExcerpt && (
        <MarkdownEditorModal
          key={editingExcerpt.id}
          heading="编辑摘录"
          subtitle={`${editingExcerpt.docTitle}${editingExcerpt.page ? ` · 第 ${editingExcerpt.page} 页` : ''}`}
          initialTitle={editingExcerpt.question}
          initialContent={editingExcerpt.answer}
          attachments={editingExcerpt.attachments ?? []}
          dirtyKey={`reader-excerpt-editor-${editingExcerpt.id}`}
          meta={
            editingExcerpt.source ? (
              <div className="excerpt-detail-quote topic-excerpt-source">{editingExcerpt.source}</div>
            ) : undefined
          }
          attachmentUrl={(file) =>
            `zotfile://attachments/${editingExcerpt.id}/${encodeURIComponent(file)}`
          }
          onPickAttachments={(kind) => window.api.excerpts.pickAttachments(editingExcerpt.id, kind)}
          onRemoveAttachment={(attachmentId) =>
            window.api.excerpts.removeAttachment(editingExcerpt.id, attachmentId)
          }
          onExportZip={async () => {
            const result = await window.api.excerpts.exportZip(editingExcerpt.id)
            if (!result.canceled && result.filePath) notify(`已导出：${result.filePath}`, 'success')
          }}
          onSave={async (title, content) => {
            await window.api.excerpts.update(editingExcerpt.id, { question: title, answer: content })
            await onChanged()
            notify('摘录已更新', 'success')
            return true
          }}
          onClose={() => setEditingExcerpt(null)}
          notify={notify}
        />
      )}
      {composeChat && (
        <ComposeModal chat={composeChat} onClose={() => setComposeChat(null)} notify={notify} />
      )}
    </div>
  )
}
