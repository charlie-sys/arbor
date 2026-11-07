import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Maximize,
  MessageSquarePlus,
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
import type { ChatSession, Collection, DocumentMeta } from '@shared/types'
import PdfViewer, { type PdfSelection, type PdfViewerHandle } from './PdfViewer'
import ChatThread from './ChatThread'
import ComposeModal from './ComposeModal'
import { cx, formatTime } from '../ui'

interface Props {
  doc: DocumentMeta
  chats: ChatSession[]
  collections: Collection[]
  translateBusy: boolean
  onBack(): void
  onChanged(): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

interface Quote {
  text: string
  page?: number
  nonce: number
}

type Panel = 'agent' | 'info' | 'notes'

export default function ReaderView({ doc, chats, collections, translateBusy, onBack, onChanged, notify }: Props): React.JSX.Element {
  const pdfRef = useRef<PdfViewerHandle>(null)
  const [panel, setPanel] = useState<Panel>('agent')
  const [page, setPage] = useState(doc.lastPage || 1)
  const [pageInput, setPageInput] = useState(String(doc.lastPage || 1))
  const [pageCount, setPageCount] = useState(doc.pageCount)
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [composeChat, setComposeChat] = useState<ChatSession | null>(null)

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
  const [notesDirty, setNotesDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const docChats = useMemo(
    () => chats.filter((chat) => chat.docIds.includes(doc.id)).sort((a, b) => b.updatedAt - a.updatedAt),
    [chats, doc.id]
  )
  const activeChat = docChats.find((chat) => chat.id === activeChatId) ?? null

  useEffect(() => {
    setPanel('agent')
    setPage(doc.lastPage || 1)
    setPageInput(String(doc.lastPage || 1))
    setPageCount(doc.pageCount)
    setSelection(null)
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
    setNotesDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

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

  const askAgent = async (): Promise<void> => {
    if (!selection) return
    const text = selection.text
    const pageNumber = selection.page
    setPanel('agent')
    let chatId = activeChatId
    if (!chatId || !docChats.some((chat) => chat.id === chatId)) {
      const chat = await window.api.chats.create([doc.id])
      await onChanged()
      chatId = chat.id
      setActiveChatId(chat.id)
    }
    setQuote({ text, page: pageNumber, nonce: Date.now() })
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
        collections: selectedCollections
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
      await onChanged()
      notify('笔记已保存', 'success')
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

        <button className="btn ghost small" onClick={() => void window.api.translate.start()} disabled={translateBusy}>
          <ScanLine size={15} /> 截图翻译
        </button>
      </div>

      <div className="reader-body">
        <div className="reader-pdf">
          <PdfViewer
            key={doc.id}
            ref={pdfRef}
            docId={doc.id}
            initialPage={doc.lastPage || 1}
            onPageChange={setPage}
            onPagesLoaded={setPageCount}
            onSelection={setSelection}
          />
        </div>

        <aside className="reader-panel">
          <div className="panel-tabs">
            <button className={cx('panel-tab', panel === 'agent' && 'active')} onClick={() => setPanel('agent')}>
              <Sparkles size={14} /> AI 助手
            </button>
            <button className={cx('panel-tab', panel === 'info' && 'active')} onClick={() => setPanel('info')}>
              文献信息
            </button>
            <button className={cx('panel-tab', panel === 'notes' && 'active')} onClick={() => setPanel('notes')}>
              笔记 {notesDirty && <span className="dot" />}
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
                  compact
                  onChanged={onChanged}
                  onCompose={(chat) => setComposeChat(chat)}
                  notify={notify}
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
                <button className="btn primary small" onClick={() => void saveNotes()} disabled={saving || !notesDirty}>
                  <Save size={14} /> 保存笔记
                </button>
              </div>
              <textarea
                className="notes-editor"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value)
                  setNotesDirty(true)
                }}
                placeholder="记录阅读心得、选中文本保存的摘录、待办问题…"
              />
            </div>
          )}
        </aside>
      </div>

      {selection && (
        <div className="selection-toolbar" style={{ top: toolbarTop, left: toolbarLeft }}>
          <button onClick={() => void askAgent()}>
            <Sparkles size={14} /> 问 Agent
          </button>
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

      {composeChat && (
        <ComposeModal chat={composeChat} onClose={() => setComposeChat(null)} notify={notify} />
      )}
    </div>
  )
}
