import { useEffect, useRef, useState } from 'react'
import { Copy, Send, Sparkles, Square, Loader2 } from 'lucide-react'
import type { ChatMessage, ChatSession, DocumentMeta } from '@shared/types'
import { Markdown, cx, formatTime } from '../ui'

interface Quote {
  text: string
  page?: number
  nonce: number
}

interface Props {
  chat: ChatSession
  docs: DocumentMeta[]
  quote?: Quote | null
  compact?: boolean
  onChanged: () => Promise<void> | void
  onCompose?: (chat: ChatSession) => void
  onQuoteApplied?: () => void
  notify: (message: string, kind?: 'info' | 'success' | 'error') => void
}

export default function ChatThread({ chat, docs, quote, compact, onChanged, onCompose, onQuoteApplied, notify }: Props): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>(chat.messages)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)

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
    window.setTimeout(() => textareaRef.current?.focus(), 30)
    onQuoteAppliedRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.nonce])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, streaming, messages[messages.length - 1]?.content.length])

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || streaming) return
    const active = chatRef.current
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: Date.now()
    }
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

    try {
      await persist(next)
    } catch {
      // keep the local conversation even if persistence fails
    }

    const history = next
      .slice(0, -1)
      .filter((message) => !(message.role === 'assistant' && (message.error || !message.content)))
      .map((message) => ({ role: (message.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: message.content }))

    const requestId = crypto.randomUUID()
    reqRef.current = requestId
    streamRef.current = ''
    setStreaming(true)
    try {
      const result = await window.api.agent.send({
        requestId,
        chatId: active.id,
        docIds: active.docIds,
        messages: history,
        contextMode: active.docIds.length ? 'auto' : 'none'
      })
      if (!result.ok) throw new Error('请求未能启动')
    } catch (err) {
      await finalizeRef.current('', (err as Error).message)
    }
  }

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
                  <div className="msg-meta">{formatTime(message.createdAt)}</div>
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
                  <Markdown>{message.content}</Markdown>
                )}
                {!waiting && (
                  <div className="msg-actions">
                    <button className="icon-btn tiny" title="复制回答" onClick={() => void copy(message.content)}>
                      <Copy size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="composer">
        <textarea
          ref={textareaRef}
          value={draft}
          placeholder={docs.length ? '针对文献提问，Enter 发送，Shift+Enter 换行…' : '输入问题，Enter 发送，Shift+Enter 换行…'}
          onChange={(event) => setDraft(event.target.value)}
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
            {streaming ? '正在生成回答…' : docs.length ? '回答将引用所选文献原文' : '未引用文献，可直接对话'}
          </div>
          <div className="composer-actions">
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
              <button className="btn primary small" disabled={!draft.trim()} onClick={() => void send()}>
                <Send size={14} /> 发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
