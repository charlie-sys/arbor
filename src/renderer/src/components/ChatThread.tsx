import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, BookOpen, ChevronDown, Copy, FileText, NotebookPen, Paperclip, Send, Sparkles, Square, Loader2, X } from 'lucide-react'
import type { ChatMessage, ChatSession, DocumentMeta, InboxAttachment } from '@shared/types'
import { Markdown, cx, formatTime } from '../ui'

interface Quote {
  text: string
  page?: number
  nonce: number
}

interface PageRef {
  docId: string
  page: number
}

const PAGE_REF_PATTERN = /\[?第\s*(\d+)\s*页\]?|\bp\.\s*(\d+)\b/gi

function resolveDocAt(content: string, index: number, docs: DocumentMeta[]): string {
  const mentions = [...content.slice(0, index).matchAll(/《([^》]{1,120})》/g)]
  const last = mentions[mentions.length - 1]
  if (last) {
    const title = last[1]
    const found = docs.find((doc) => doc.title === title || doc.title.includes(title) || title.includes(doc.title))
    if (found) return found.id
  }
  return docs[0]?.id ?? ''
}

function collectPageRefs(content: string, docs: DocumentMeta[]): PageRef[] {
  if (!docs.length) return []
  const refs: PageRef[] = []
  const pattern = new RegExp(PAGE_REF_PATTERN.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content))) {
    const page = Number(match[1] ?? match[2])
    if (!Number.isFinite(page) || page <= 0) continue
    const docId = resolveDocAt(content, match.index, docs)
    if (!refs.some((ref) => ref.docId === docId && ref.page === page)) refs.push({ docId, page })
  }
  return refs
}

function linkifyPageRefs(content: string, docs: DocumentMeta[]): string {
  if (!docs.length) return content
  return content.replace(PAGE_REF_PATTERN, (match, cn: string, en: string, offset: number) => {
    const page = Number(cn ?? en)
    if (!Number.isFinite(page) || page <= 0) return match
    const docId = resolveDocAt(content, offset, docs)
    return `[第${page}页](zotagent:page:${docId}:${page})`
  })
}

function CitationList({
  refs,
  docs,
  onOpen
}: {
  refs: PageRef[]
  docs: DocumentMeta[]
  onOpen?: (docId: string, page: number) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!refs.length) return null
  return (
    <div className="citation-block">
      <button className="citation-toggle" onClick={() => setOpen((value) => !value)}>
        <BookOpen size={13} /> 引用来源 · {refs.length}
        <ChevronDown size={13} className={cx('citation-chevron', open && 'open')} />
      </button>
      {open && (
        <div className="citation-list">
          {refs.map((ref) => {
            const doc = docs.find((item) => item.id === ref.docId)
            return (
              <button
                key={`${ref.docId}-${ref.page}`}
                className="citation-item"
                title={doc ? `${doc.title} · 第 ${ref.page} 页` : undefined}
                onClick={() => onOpen?.(ref.docId, ref.page)}
              >
                <span className="citation-title">{doc?.title ?? '未知文献'}</span>
                <span className="citation-page">p.{ref.page}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface Props {
  chat: ChatSession
  docs: DocumentMeta[]
  initialQuestion?: string
  quote?: Quote | null
  currentPage?: number
  compact?: boolean
  active?: boolean
  openPage?: (docId: string, page: number) => void
  onChanged: () => Promise<void> | void
  onCompose?: (chat: ChatSession) => void
  onQuoteApplied?: () => void
  notify: (message: string, kind?: 'info' | 'success' | 'error') => void
}

export default function ChatThread({ chat, docs, initialQuestion, quote, currentPage, compact, active = true, openPage, onChanged, onCompose, onQuoteApplied, notify }: Props): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>(chat.messages)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<InboxAttachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const [contextMode, setContextMode] = useState<'auto' | 'none' | 'page' | 'selection'>('auto')
  const [includeNotes, setIncludeNotes] = useState(false)
  const [selectionContext, setSelectionContext] = useState<{ text: string; page?: number } | null>(null)

  const messagesRef = useRef<ChatMessage[]>(chat.messages)
  const chatRef = useRef(chat)
  chatRef.current = chat
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  const onQuoteAppliedRef = useRef(onQuoteApplied)
  onQuoteAppliedRef.current = onQuoteApplied

  const reqRef = useRef<string | null>(null)
  const streamRef = useRef('')
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const updateLast = (content: string, error = false): void => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last && last.role === 'assistant') {
        next[next.length - 1] = { ...last, content, error }
      }
      messagesRef.current = next
      return next
    })
  }

  const persist = async (list: ChatMessage[]): Promise<void> => {
    const active = chatRef.current
    const firstUser = list.find((m) => m.role === 'user')
    const title =
      active.title === '新的对话' && firstUser
        ? firstUser.content.replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 30) || '新的对话'
        : active.title
    await window.api.chats.update(active.id, { messages: list, title })
    await onChangedRef.current()
  }

  const finalizeRef = useRef<(content: string, error?: string) => Promise<void>>(async () => {})
  finalizeRef.current = async (content, error) => {
    reqRef.current = null
    setStreaming(false)
    const finalMessages = messagesRef.current.map((message, index, array) => {
      if (index !== array.length - 1 || message.role !== 'assistant') return message
      const merged = error
        ? message.content
          ? `${message.content}\n\n> 生成中断：${error}`
          : `请求失败：${error}`
        : content || message.content
      return { ...message, content: merged, error: !!error && !message.content }
    })
    messagesRef.current = finalMessages
    setMessages(finalMessages)
    try {
      await persist(finalMessages)
    } catch (err) {
      notifyRef.current(`保存对话失败：${(err as Error).message}`, 'error')
    }
  }

  useEffect(() => {
    reqRef.current = null
    streamRef.current = ''
    setStreaming(false)
    setDraft('')
    setPendingAttachments([])
    setMessages(chat.messages)
    messagesRef.current = chat.messages
  }, [chat.id])

  useEffect(() => {
    if (streaming) return
    setMessages(chat.messages)
    messagesRef.current = chat.messages
  }, [chat.updatedAt, chat.id, streaming])

  useEffect(() => {
    const off = window.api.events.onChat((event) => {
      if (!reqRef.current || event.requestId !== reqRef.current) return
      if (event.type === 'delta') {
        streamRef.current += event.delta ?? ''
        updateLast(streamRef.current)
      } else if (event.type === 'done') {
        void finalizeRef.current(event.content ?? streamRef.current)
      } else {
        void finalizeRef.current(streamRef.current, event.error || '请求失败')
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!quote) return
    const text = quote.text.replace(/\r/g, '').replace(/\n/g, '\n> ')
    const block = quote.page ? `> 原文（第 ${quote.page} 页）：${text}\n\n` : `> 原文：${text}\n\n`
    setDraft((prev) => (prev.trim() ? `${prev}\n${block}` : block))
    setSelectionContext({ text: quote.text, page: quote.page })
    setContextMode('selection')
    window.setTimeout(() => textareaRef.current?.focus(), 30)
    onQuoteAppliedRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.nonce])

  useEffect(() => {
    if (!active) return
    const el = listRef.current
    if (!el) return
    const toBottom = (): void => {
      el.scrollTop = el.scrollHeight
    }
    toBottom()
    const frame = window.requestAnimationFrame(toBottom)
    const timer = window.setTimeout(toBottom, 80)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [active, chat.id, messages.length, streaming, messages[messages.length - 1]?.content.length])

  const attachFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return
    setAttaching(true)
    try {
      for (const file of files) {
        const data = new Uint8Array(await file.arrayBuffer())
        const extension = file.type.split('/')[1] || 'bin'
        const name = file.name || `粘贴文件-${Date.now()}.${extension}`
        const attachment = await window.api.chats.saveAttachment(chat.id, name, data)
        setPendingAttachments((prev) => [...prev, attachment])
      }
      notify('附件已添加', 'success')
    } catch (err) {
      notify(`添加附件失败：${(err as Error).message}`, 'error')
    } finally {
      setAttaching(false)
    }
  }

  const uploadAttachments = async (): Promise<void> => {
    setAttaching(true)
    try {
      const added = await window.api.chats.pickAttachments(chat.id, 'file')
      if (added.length) {
        setPendingAttachments((prev) => [...prev, ...added])
        notify(`已添加 ${added.length} 个附件`, 'success')
      }
    } catch (err) {
      notify(`添加附件失败：${(err as Error).message}`, 'error')
    } finally {
      setAttaching(false)
    }
  }

  const removePendingAttachment = async (attachment: InboxAttachment): Promise<void> => {
    try {
      await window.api.chats.removeAttachment(chat.id, attachment.file)
      setPendingAttachments((prev) => prev.filter((entry) => entry.id !== attachment.id))
    } catch (err) {
      notify(`移除附件失败：${(err as Error).message}`, 'error')
    }
  }

  const attachmentUrl = (attachment: InboxAttachment): string =>
    `zotfile://attachments/${chat.id}/${encodeURIComponent(attachment.file)}`

  const send = async (override?: string): Promise<void> => {
    const text = (override ?? draft).trim()
    if ((!text && !pendingAttachments.length) || streaming) return
    const active = chatRef.current
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: Date.now()
    }
    if (pendingAttachments.length) userMessage.attachments = pendingAttachments
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: Date.now()
    }
    const next = [...messagesRef.current, userMessage, assistantMessage]
    messagesRef.current = next
    setMessages(next)
    setDraft('')
    setPendingAttachments([])

    try {
      await persist(next)
    } catch {
      // keep the local conversation even if persistence fails
    }

    const history = next
      .slice(0, -1)
      .filter((message) => !(message.role === 'assistant' && (message.error || !message.content)))
      .map((message) => ({
        role: (message.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: message.content,
        attachments: message.attachments
      }))

    const requestId = crypto.randomUUID()
    reqRef.current = requestId
    streamRef.current = ''
    setStreaming(true)
    const pageForContext = selectionContext?.page ?? currentPage
    const effectiveMode =
      contextMode === 'selection' && !selectionContext?.text.trim() ? 'auto' : contextMode
    try {
      const result = await window.api.agent.send({
        requestId,
        chatId: active.id,
        docIds: active.docIds,
        messages: history,
        context: {
          contextMode: active.docIds.length ? effectiveMode : 'none',
          page: pageForContext,
          selection: effectiveMode === 'selection' ? selectionContext?.text : undefined,
          includeNotes: active.docIds.length > 0 && includeNotes
        }
      })
      if (!result.ok) throw new Error('请求未能启动')
    } catch (err) {
      await finalizeRef.current('', (err as Error).message)
    }
  }

  const autoSentRef = useRef(false)
  useEffect(() => {
    if (autoSentRef.current) return
    const question = initialQuestion?.trim()
    if (!question || chat.messages.length) return
    autoSentRef.current = true
    void send(question)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, initialQuestion])

  const stop = async (): Promise<void> => {
    if (!reqRef.current) return
    await window.api.agent.cancel(reqRef.current)
  }

  const copy = async (content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
      notify('已复制到剪贴板', 'success')
    } catch {
      notify('复制失败', 'error')
    }
  }

  const appendDocNotes = async (docId: string, entry: string): Promise<void> => {
    const state = await window.api.library.getState()
    const fresh = state.documents.find((doc) => doc.id === docId)
    if (!fresh) throw new Error('文献不存在或已被删除')
    const notes = fresh.notes.trim() ? `${fresh.notes.trim()}\n\n${entry}` : entry
    await window.api.library.update(docId, { notes })
    void onChangedRef.current()
  }

  const questionFor = (index: number): string => {
    for (let i = index - 1; i >= 0; i--) {
      if (messagesRef.current[i]?.role === 'user') return messagesRef.current[i].content
    }
    return ''
  }

  const saveAsNote = async (answer: string, question: string, page?: number): Promise<void> => {
    const doc = docs[0]
    if (!doc) {
      notify('当前对话未关联文献，无法存为文献笔记', 'error')
      return
    }
    const stamp = new Date().toLocaleString('zh-CN')
    const entry = `## 问答记录 · ${stamp}\n\n**问：** ${question || '（未记录）'}\n\n**答：** ${answer}${page ? `\n\n来源：第 ${page} 页` : ''}`
    try {
      await appendDocNotes(doc.id, entry)
      notify('已存为文献笔记', 'success')
    } catch (err) {
      notify(`保存笔记失败：${(err as Error).message}`, 'error')
    }
  }

  const saveAsQuestion = async (question: string): Promise<void> => {
    const doc = docs[0]
    if (!doc) {
      notify('当前对话未关联文献，无法存为问题', 'error')
      return
    }
    const entry = `## 问题 · ${new Date().toLocaleString('zh-CN')}\n\n**问：** ${question}`
    try {
      await appendDocNotes(doc.id, entry)
      notify('问题已存入文献笔记', 'success')
    } catch (err) {
      notify(`保存失败：${(err as Error).message}`, 'error')
    }
  }

  const saveAsExcerpt = async (answer: string, question: string, page?: number): Promise<void> => {
    const doc = docs[0]
    try {
      await window.api.excerpts.add({
        docId: doc?.id ?? null,
        page,
        source: selectionContext?.text ?? '',
        question,
        answer
      })
      notify('已存为摘录', 'success')
      void onChangedRef.current()
    } catch (err) {
      notify(`保存摘录失败：${(err as Error).message}`, 'error')
    }
  }

  const answerPage = (content: string): number | undefined => collectPageRefs(content, docs)[0]?.page

  const hasMessages = messages.length > 0
  const suggestions = docs.length
    ? ['这篇文献的研究问题和方法是什么？', '总结核心结论与主要贡献', '文中提到了哪些局限性？']
    : ['帮我梳理论文阅读的方法', '如何高效整理文献笔记？', '解释一下这篇文献的关键概念']

  return (
    <div className={cx('chat-thread', compact && 'compact')}>
      {docs.length > 0 && (
        <div className="chat-context-bar">
          <span className="context-label">引用文献</span>
          <div className="context-chips">
            {docs.map((doc) => (
              <span className="context-chip" key={doc.id} title={doc.title}>
                {doc.title.length > 22 ? `${doc.title.slice(0, 22)}…` : doc.title}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="chat-messages" ref={listRef}>
        {!hasMessages && (
          <div className="chat-empty">
            <div className="chat-empty-title">向 AI 助手提问</div>
            <div className="chat-empty-sub">
              {docs.length ? '回答将严格依据所选文献，并标注原文页码。' : '选择文献后可基于原文回答；也可以直接进行一般性讨论。'}
            </div>
            <div className="suggestion-list">
              {suggestions.map((suggestion) => (
                <button key={suggestion} className="suggestion" onClick={() => setDraft(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          const isLast = index === messages.length - 1
          const waiting = streaming && isLast && message.role === 'assistant' && !message.content
          if (message.role === 'user') {
            return (
              <div className="msg-row user" key={message.id}>
                <div className="msg-bubble user-bubble">
                  <div className="msg-user-text">{message.content}</div>
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="msg-attachments">
                      {message.attachments.map((attachment) =>
                        attachment.kind === 'image' ? (
                          <img
                            key={attachment.id}
                            src={attachmentUrl(attachment)}
                            alt={attachment.name}
                            title={attachment.name}
                          />
                        ) : (
                          <span className="msg-attachment-file" key={attachment.id} title={attachment.name}>
                            <FileText size={13} /> {attachment.name}
                          </span>
                        )
                      )}
                    </div>
                  )}
                  <div className="msg-meta">{formatTime(message.createdAt)}</div>
                  <div className="msg-actions">
                    <button
                      className="icon-btn tiny"
                      title="存为问题"
                      onClick={() => void saveAsQuestion(message.content)}
                    >
                      <NotebookPen size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )
          }
          return (
            <div className="msg-row assistant" key={message.id}>
              <div className={cx('msg-bubble assistant-bubble', message.error && 'error')}>
                {waiting ? (
                  <div className="typing">
                    <Loader2 size={15} className="spin" /> 正在阅读文献并思考…
                  </div>
                ) : (
                  <Markdown
                    onPageRef={(docId, page) => openPage?.(docId || docs[0]?.id || '', page)}
                  >
                    {linkifyPageRefs(message.content, docs)}
                  </Markdown>
                )}
                {!waiting && (
                  <div className="msg-actions">
                    <button className="icon-btn tiny" title="复制回答" onClick={() => void copy(message.content)}>
                      <Copy size={13} />
                    </button>
                    <button
                      className="icon-btn tiny"
                      title="存为笔记（追加到文献笔记）"
                      onClick={() => void saveAsNote(message.content, questionFor(index), answerPage(message.content))}
                    >
                      <NotebookPen size={13} />
                    </button>
                    <button
                      className="icon-btn tiny"
                      title="存为摘录"
                      onClick={() => void saveAsExcerpt(message.content, questionFor(index), answerPage(message.content))}
                    >
                      <BookmarkPlus size={13} />
                    </button>
                  </div>
                )}
                {!waiting && (
                  <CitationList
                    refs={collectPageRefs(message.content, docs)}
                    docs={docs}
                    onOpen={openPage}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div
        className="composer"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void attachFiles(Array.from(event.dataTransfer.files))
        }}
      >
        {docs.length > 0 && (
          <div className="context-mode-bar">
            <span className="context-mode-label">上下文</span>
            {([
              ['auto', '整篇文献'],
              ['page', '当前页'],
              ['selection', '选中段落'],
              ['none', '不引用']
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                className={cx('ctx-chip', contextMode === mode && 'active')}
                disabled={mode === 'page' && !(selectionContext?.page ?? currentPage)}
                onClick={() => setContextMode(mode)}
                title={
                  mode === 'page'
                    ? '仅引用当前页原文'
                    : mode === 'selection'
                      ? '引用选中的原文（从阅读器选中文字后自动启用）'
                      : mode === 'none'
                        ? '不向模型注入任何文献原文'
                        : '按问题检索相关原文片段'
                }
              >
                {label}
              </button>
            ))}
            <span className="ctx-divider" />
            <button
              className={cx('ctx-chip', includeNotes && 'active')}
              disabled={contextMode === 'none'}
              onClick={() => setIncludeNotes((value) => !value)}
              title="同时注入文献笔记"
            >
              笔记
            </button>
          </div>
        )}
        {pendingAttachments.length > 0 && (
          <div className="chat-attachments">
            {pendingAttachments.map((attachment) => (
              <div className="chat-attachment" key={attachment.id}>
                {attachment.kind === 'image' ? (
                  <img src={attachmentUrl(attachment)} alt="" />
                ) : (
                  <FileText size={14} />
                )}
                <span title={attachment.name}>{attachment.name}</span>
                <button
                  className="icon-btn tiny"
                  title="移除附件"
                  onClick={() => void removePendingAttachment(attachment)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          placeholder={docs.length ? '针对文献提问，Enter 发送，Shift+Enter 换行…' : '输入问题，Enter 发送，Shift+Enter 换行…'}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length) {
              event.preventDefault()
              void attachFiles(files)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={compact ? 2 : 3}
        />
        <div className="composer-bar">
          <div className="composer-hint">
            {streaming
              ? '正在生成回答…'
              : !docs.length
                ? '未引用文献，可直接对话'
                : contextMode === 'none'
                  ? '上下文已关闭，不注入文献原文'
                  : contextMode === 'page'
                    ? `仅引用第 ${selectionContext?.page ?? currentPage ?? 1} 页原文${includeNotes ? '与笔记' : ''}`
                    : contextMode === 'selection'
                      ? `引用选中段落${selectionContext?.page ? `（第 ${selectionContext.page} 页）` : ''}${includeNotes ? '与笔记' : ''}`
                      : `按问题检索整篇文献${includeNotes ? '并注入笔记' : ''}`}
          </div>
          <div className="composer-actions">
            <button
              className="icon-btn"
              title="添加附件（支持粘贴、拖拽、本地上传）"
              onClick={() => void uploadAttachments()}
              disabled={streaming || attaching}
            >
              {attaching ? <Loader2 className="spin" size={16} /> : <Paperclip size={16} />}
            </button>
            {onCompose && hasMessages && !streaming && (
              <button className="btn ghost small" onClick={() => onCompose(chat)}>
                <Sparkles size={14} /> 整理文档
              </button>
            )}
            {streaming ? (
              <button className="btn danger small" onClick={() => void stop()}>
                <Square size={13} /> 停止
              </button>
            ) : (
              <button
                className="btn primary small"
                disabled={!draft.trim() && !pendingAttachments.length}
                onClick={() => void send()}
              >
                <Send size={14} /> 发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
