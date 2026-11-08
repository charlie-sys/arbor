import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookmarkPlus,
  BookOpen,
  Check,
  ChevronRight,
  Highlighter,
  Info,
  ListTodo,
  MessageSquarePlus,
  PanelRightOpen,
  PenLine,
  Plus,
  Save,
  Sparkles,
  StickyNote,
  Trash2,
  X
} from 'lucide-react'
import type { ChatSession, Collection, DocumentMeta, Excerpt, Highlight, ReadingStatus, TaskItem } from '@shared/types'
import type { ReaderPanelTab } from '@shared/api'
import type { PdfOutlineItem } from './PdfViewer'
import ChatThread from './ChatThread'
import ComposeModal from './ComposeModal'
import MarkdownEditorModal from './MarkdownEditorModal'
import { useUnsavedChanges } from '../unsaved'
import { cx, formatTime, Markdown } from '../ui'

export interface ReaderPanelQuote {
  text: string
  page?: number
  nonce: number
}

interface Props {
  doc: DocumentMeta
  documents?: DocumentMeta[]
  chats: ChatSession[]
  collections: Collection[]
  highlights: Highlight[]
  excerpts: Excerpt[]
  tasks: TaskItem[]
  page: number
  quote: ReaderPanelQuote | null
  tab: ReaderPanelTab
  activeChatId: string | null
  outline: PdfOutlineItem[]
  outlineLoaded: boolean
  fallbackToc: { page: number; title: string }[]
  onTab(tab: ReaderPanelTab): void
  onActiveChat(chatId: string | null): void
  onChanged(): Promise<void> | void
  onQuoteApplied(): void
  onJumpPage(page: number): void
  onOpenDoc(docId: string, page?: number): void
  onDetach?(tab: ReaderPanelTab): void
  onDirtyChange?(dirty: boolean): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
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

export default function ReaderSidePanel({
  doc,
  documents,
  chats,
  collections,
  highlights,
  excerpts,
  tasks,
  page,
  quote,
  tab,
  activeChatId,
  outline,
  outlineLoaded,
  fallbackToc,
  onTab,
  onActiveChat,
  onChanged,
  onQuoteApplied,
  onJumpPage,
  onOpenDoc,
  onDetach,
  onDirtyChange,
  notify
}: Props): React.JSX.Element {
  const [notes, setNotes] = useState(doc.notes)
  const [notesDirty, setNotesDirty] = useState(false)
  const [notesPreview, setNotesPreview] = useState(true)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState(doc.title)
  const [authors, setAuthors] = useState(doc.authors)
  const [year, setYear] = useState(doc.year)
  const [journal, setJournal] = useState(doc.journal)
  const [doi, setDoi] = useState(doc.doi)
  const [url, setUrl] = useState(doc.url)
  const [abstract, setAbstract] = useState(doc.abstract)
  const [tags, setTags] = useState(doc.tags.join(', '))
  const [selectedCollections, setSelectedCollections] = useState<string[]>(doc.collections)
  const [readingStatus, setReadingStatus] = useState(doc.readingStatus ?? 'unread')
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [composeChat, setComposeChat] = useState<ChatSession | null>(null)
  const [editingExcerpt, setEditingExcerpt] = useState<Excerpt | null>(null)
  const [viewingExcerpt, setViewingExcerpt] = useState<Excerpt | null>(null)
  const [excerptQuestion, setExcerptQuestion] = useState('')
  const [excerptAnswer, setExcerptAnswer] = useState('')
  const [excerptSource, setExcerptSource] = useState('')

  const sortedExcerpts = useMemo(
    () => excerpts.filter((excerpt) => excerpt.docId === doc.id).sort((a, b) => b.createdAt - a.createdAt),
    [excerpts, doc.id]
  )
  const docChats = useMemo(
    () => chats.filter((chat) => chat.docIds.includes(doc.id)).sort((a, b) => b.updatedAt - a.updatedAt),
    [chats, doc.id]
  )
  const activeChat = docChats.find((chat) => chat.id === activeChatId) ?? null
  const chatDocs = useMemo(() => {
    const list = (documents ?? [])
      .filter((item) => activeChat?.docIds.includes(item.id))
      .sort((a, b) => (activeChat?.docIds.indexOf(a.id) ?? 0) - (activeChat?.docIds.indexOf(b.id) ?? 0))
    return list.length ? list : [doc]
  }, [documents, activeChat, doc])
  const chatIdList = docChats.map((chat) => chat.id).join(',')
  useEffect(() => {
    if (activeChatId && docChats.some((chat) => chat.id === activeChatId)) return
    if (!docChats.length) {
      if (activeChatId) onActiveChat(null)
      return
    }
    onActiveChat(docChats[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, chatIdList, activeChatId])
  const docHighlights = useMemo(
    () => highlights.filter((highlight) => highlight.docId === doc.id).sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),
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
  const dirty = notesDirty || metaDirty || excerptEditorDirty

  useUnsavedChanges(`reader-notes-${doc.id}`, notesDirty)
  useUnsavedChanges(`reader-meta-${doc.id}`, metaDirty)
  useUnsavedChanges('reader-excerpt-editor', excerptEditorDirty)

  const dirtyRef = useRef(onDirtyChange)
  dirtyRef.current = onDirtyChange
  useEffect(() => {
    dirtyRef.current?.(dirty)
  }, [dirty])

  useEffect(() => {
    setTitle(doc.title)
    setAuthors(doc.authors)
    setYear(doc.year)
    setJournal(doc.journal)
    setDoi(doc.doi)
    setUrl(doc.url)
    setAbstract(doc.abstract)
    setTags(doc.tags.join(', '))
    setSelectedCollections(doc.collections)
    setReadingStatus(doc.readingStatus ?? 'unread')
    setNotes(doc.notes)
    setNotesDirty(false)
    setEditingExcerpt(null)
    setViewingExcerpt(null)
  }, [doc.id])

  useEffect(() => {
    if (!notesDirty) setNotes(doc.notes)
  }, [doc.notes, notesDirty])

  useEffect(() => {
    setReadingStatus(doc.readingStatus ?? 'unread')
  }, [doc.readingStatus])

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const openTasks = tasks.filter((task) => !task.done)
  const dueTodayTasks = openTasks.filter((task) => task.due === todayKey)
  const otherOpenTasks = openTasks.filter((task) => task.due !== todayKey)
  const doneTasks = tasks.filter((task) => task.done)

  const createChat = async (): Promise<void> => {
    const emptyChat = docChats.find((chat) => chat.messages.length === 0)
    if (emptyChat) {
      onActiveChat(emptyChat.id)
      onTab('agent')
      return
    }
    try {
      const chat = await window.api.chats.create([doc.id])
      await onChanged()
      onActiveChat(chat.id)
      onTab('agent')
    } catch (err) {
      notify(`创建对话失败：${(err as Error).message}`, 'error')
    }
  }

  const deleteChat = async (chatId: string): Promise<void> => {
    if (!window.confirm('删除这个对话？')) return
    try {
      await window.api.chats.remove(chatId)
      if (activeChatId === chatId) onActiveChat(null)
      await onChanged()
    } catch (err) {
      notify(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  const quoteNonce = quote?.nonce ?? 0
  useEffect(() => {
    if (!quoteNonce) return
    onTab('agent')
    const hasChat = !!activeChatId && docChats.some((chat) => chat.id === activeChatId)
    if (!hasChat) {
      if (docChats.length) onActiveChat(docChats[0].id)
      else void createChat()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteNonce])

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

  const openExcerptEditor = (excerpt: Excerpt): void => {
    setEditingExcerpt(excerpt)
    setExcerptQuestion(excerpt.question)
    setExcerptAnswer(excerpt.answer)
    setExcerptSource(excerpt.source)
  }

  const closeExcerptEditor = (): void => {
    if (excerptEditorDirty) {
      notify('摘录有未保存的修改，请先保存', 'info')
      return
    }
    setEditingExcerpt(null)
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
      if (excerpt.page) onJumpPage(excerpt.page)
      return
    }
    onOpenDoc(excerpt.docId, excerpt.page)
  }

  const removeHighlight = async (id: string): Promise<void> => {
    if (!window.confirm('删除这条高亮？')) return
    try {
      await window.api.highlights.remove(id)
      await onChanged()
      notify('已删除高亮', 'success')
    } catch (err) {
      notify(`删除高亮失败：${(err as Error).message}`, 'error')
    }
  }

  const requestDetach = (): void => {
    if (!onDetach) return
    if (dirty) {
      notify('有未保存的修改，请先保存', 'info')
      return
    }
    onDetach(tab)
  }

  return (
    <>
      <div className="panel-tabs">
        <button
          className={cx('panel-tab', tab === 'agent' && 'active')}
          onClick={() => onTab('agent')}
          title="AI 助手"
        >
          <Sparkles size={14} /> <span className="tab-label">AI 助手</span>
        </button>
        <button
          className={cx('panel-tab', tab === 'outline' && 'active')}
          onClick={() => onTab('outline')}
          title="大纲"
        >
          <BookOpen size={14} /> <span className="tab-label">大纲</span>
        </button>
        <button
          className={cx('panel-tab', tab === 'highlights' && 'active')}
          onClick={() => onTab('highlights')}
          title="高亮"
        >
          <Highlighter size={14} /> <span className="tab-label">高亮</span>
          {docHighlights.length > 0 && <span className="tab-count">{docHighlights.length}</span>}
        </button>
        <button
          className={cx('panel-tab', tab === 'excerpts' && 'active')}
          onClick={() => onTab('excerpts')}
          title="摘录"
        >
          <BookmarkPlus size={14} /> <span className="tab-label">摘录</span>
          {sortedExcerpts.length > 0 && <span className="tab-count">{sortedExcerpts.length}</span>}
        </button>
        <button
          className={cx('panel-tab', tab === 'info' && 'active')}
          onClick={() => onTab('info')}
          title="文献信息"
        >
          <Info size={14} /> <span className="tab-label">文献信息</span>
        </button>
        <button
          className={cx('panel-tab', tab === 'notes' && 'active')}
          onClick={() => onTab('notes')}
          title="笔记"
        >
          <StickyNote size={14} /> <span className="tab-label">笔记</span>
          {notesDirty && <span className="dot" />}
        </button>
        <button
          className={cx('panel-tab', tab === 'tasks' && 'active')}
          onClick={() => onTab('tasks')}
          title="任务"
        >
          <ListTodo size={14} /> <span className="tab-label">任务</span>
          {openTasks.length > 0 && <span className="tab-count">{openTasks.length}</span>}
        </button>
        {onDetach && (
          <button className="panel-detach" title="脱离为独立窗口" onClick={requestDetach}>
            <PanelRightOpen size={14} />
          </button>
        )}
      </div>

      <div className={cx('panel-body agent-panel', tab !== 'agent' && 'is-hidden')}>
        <div className="chat-switcher">
          <div className="chat-pills">
            {docChats.map((chat) => (
              <button
                key={chat.id}
                className={cx('chat-pill', chat.id === activeChatId && 'active')}
                title={`${chat.title} · ${formatTime(chat.updatedAt)}`}
                onClick={() => onActiveChat(chat.id)}
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
            docs={chatDocs}
            quote={quote}
            currentPage={page}
            compact
            active={tab === 'agent'}
            onChanged={onChanged}
            onCompose={(chat) => setComposeChat(chat)}
            notify={notify}
            openPage={(docId, targetPage) => {
              if (docId === doc.id) onJumpPage(targetPage)
              else onOpenDoc(docId, targetPage)
            }}
            onQuoteApplied={onQuoteApplied}
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

      {tab === 'outline' && (
        <div className="panel-body outline-panel">
          {!outlineLoaded ? (
            <div className="panel-empty">
              <BookOpen size={24} />
              <p className="muted">正在读取目录…</p>
            </div>
          ) : outline.length > 0 ? (
            <div className="outline-tree">
              {outline.map((item, index) => (
                <OutlineNode key={`${item.title}-${index}`} item={item} depth={0} onJump={onJumpPage} />
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
                      onClick={() => onJumpPage(entry.page)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') onJumpPage(entry.page)
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

      {tab === 'info' && (
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

      {tab === 'notes' && (
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

      {tab === 'highlights' && (
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
                      onClick={() => onJumpPage(highlight.page)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') onJumpPage(highlight.page)
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

      {tab === 'excerpts' && (
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

      {tab === 'tasks' && (
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
          attachmentUrl={(file) => `zotfile://attachments/${editingExcerpt.id}/${encodeURIComponent(file)}`}
          onPickAttachments={(kind) => window.api.excerpts.pickAttachments(editingExcerpt.id, kind)}
          onRemoveAttachment={(attachmentId) => window.api.excerpts.removeAttachment(editingExcerpt.id, attachmentId)}
          onExportZip={async () => {
            const result = await window.api.excerpts.exportZip(editingExcerpt.id)
            if (!result.canceled && result.filePath) notify(`已导出：${result.filePath}`, 'success')
          }}
          onSave={async (nextTitle, content) => {
            await window.api.excerpts.update(editingExcerpt.id, { question: nextTitle, answer: content })
            await onChanged()
            notify('摘录已更新', 'success')
            return true
          }}
          onClose={closeExcerptEditor}
          notify={notify}
        />
      )}

      {composeChat && <ComposeModal chat={composeChat} onClose={() => setComposeChat(null)} notify={notify} />}



    </>
  )
}
