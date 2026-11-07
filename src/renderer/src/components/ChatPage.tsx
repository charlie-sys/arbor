import { useEffect, useMemo, useState } from 'react'
import { FileText, MessagesSquare, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { ChatSession, LibraryData } from '@shared/types'
import ChatThread from './ChatThread'
import ComposeModal from './ComposeModal'
import { cx, formatTime } from '../ui'

interface Props {
  data: LibraryData
  initialChatId?: string
  onChanged(): Promise<void> | void
  onOpenDoc(docId: string): void
  onOpenSettings(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function ChatPage({ data, initialChatId, onChanged, onOpenDoc, onOpenSettings, notify }: Props): React.JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(initialChatId ?? null)
  const [showNew, setShowNew] = useState(false)
  const [selectedDocs, setSelectedDocs] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [composeChat, setComposeChat] = useState<ChatSession | null>(null)

  const chats = useMemo(() => [...data.chats].sort((a, b) => b.updatedAt - a.updatedAt), [data.chats])
  const activeChat = chats.find((chat) => chat.id === activeId) ?? null

  useEffect(() => {
    if (initialChatId) setActiveId(initialChatId)
  }, [initialChatId])

  useEffect(() => {
    if (!activeId && chats.length) setActiveId(chats[0].id)
    if (activeId && !chats.some((chat) => chat.id === activeId)) {
      setActiveId(chats[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats.map((chat) => chat.id).join(','), initialChatId])

  const docs = activeChat ? data.documents.filter((doc) => activeChat.docIds.includes(doc.id)) : []

  const createChat = async (): Promise<void> => {
    setCreating(true)
    try {
      const chat = await window.api.chats.create(selectedDocs)
      await onChanged()
      setActiveId(chat.id)
      setShowNew(false)
      setSelectedDocs([])
    } catch (err) {
      notify(`创建对话失败：${(err as Error).message}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  const deleteChat = async (chat: ChatSession): Promise<void> => {
    if (!window.confirm('删除这个对话？')) return
    try {
      await window.api.chats.remove(chat.id)
      await onChanged()
      notify('对话已删除', 'success')
    } catch (err) {
      notify(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  const toggleDoc = (id: string): void => {
    setSelectedDocs((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  return (
    <div className="view chat-page">
      <aside className="chat-sessions">
        <div className="sessions-head">
          <div>
            <div className="sessions-title">对话</div>
            <div className="muted small">{chats.length} 个会话</div>
          </div>
          <button className="btn primary small" onClick={() => setShowNew(true)}>
            <Plus size={14} /> 新建
          </button>
        </div>
        <div className="sessions-list">
          {chats.length === 0 && (
            <div className="sessions-empty">
              <MessagesSquare size={22} />
              <span>还没有对话</span>
              <button className="btn ghost small" onClick={() => setShowNew(true)}>
                新建对话
              </button>
            </div>
          )}
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={cx('session-item', chat.id === activeId && 'active')}
              onClick={() => setActiveId(chat.id)}
            >
              <div className="session-title">{chat.title}</div>
              <div className="session-meta">
                <span>{chat.docIds.length ? `${chat.docIds.length} 篇文献` : '未引用文献'}</span>
                <span>{formatTime(chat.updatedAt)}</span>
              </div>
              <button
                className="icon-btn tiny session-delete"
                title="删除对话"
                onClick={(event) => {
                  event.stopPropagation()
                  void deleteChat(chat)
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="chat-main">
        {activeChat ? (
          <>
            <header className="chat-head">
              <div className="chat-head-main">
                <h2>{activeChat.title}</h2>
                <div className="chat-doc-chips">
                  {docs.map((doc) => (
                    <button key={doc.id} className="doc-chip" onClick={() => onOpenDoc(doc.id)} title="打开文献">
                      <FileText size={12} />
                      {doc.title.length > 28 ? `${doc.title.slice(0, 28)}…` : doc.title}
                    </button>
                  ))}
                  {!docs.length && <span className="muted small">未引用文献（一般对话）</span>}
                </div>
              </div>
              <button className="btn ghost small" onClick={() => setComposeChat(activeChat)}>
                <Sparkles size={14} /> 整理为文档
              </button>
            </header>

            {!data.settings.apiKey && (
              <div className="notice">
                尚未配置模型 API，Agent 暂时无法回答。
                <button className="link-btn" onClick={onOpenSettings}>
                  去设置
                </button>
              </div>
            )}

            <ChatThread
              key={activeChat.id}
              chat={activeChat}
              docs={docs}
              onChanged={onChanged}
              onCompose={(chat) => setComposeChat(chat)}
              notify={notify}
            />
          </>
        ) : (
          <div className="empty-state chat-empty-state">
            <div className="empty-icon">
              <MessagesSquare size={28} />
            </div>
            <h2>开始一次研究对话</h2>
            <p className="muted">选择一个已有对话，或新建对话并勾选要引用的文献。</p>
            <button className="btn primary" onClick={() => setShowNew(true)}>
              <Plus size={16} /> 新建对话
            </button>
          </div>
        )}
      </section>

      {showNew && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowNew(false)}>
          <div className="modal new-chat-modal">
            <div className="modal-head">
              <div>
                <h3>新建对话</h3>
                <p className="muted">勾选需要引用的文献；不勾选则进行不引用文献的普通对话。</p>
              </div>
              <button className="icon-btn" onClick={() => setShowNew(false)} title="关闭">
                <X size={18} />
              </button>
            </div>
            <div className="doc-picker">
              {data.documents.length === 0 && <div className="muted">文献库为空，可直接创建普通对话。</div>}
              {data.documents.map((doc) => (
                <label key={doc.id} className={cx('doc-pick-item', selectedDocs.includes(doc.id) && 'checked')}>
                  <input type="checkbox" checked={selectedDocs.includes(doc.id)} onChange={() => toggleDoc(doc.id)} />
                  <div>
                    <div className="doc-pick-title">{doc.title}</div>
                    <div className="muted small">
                      {[doc.authors, doc.year].filter(Boolean).join(' · ') || '未填写元数据'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="modal-foot">
              <div className="muted small">已选择 {selectedDocs.length} 篇</div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setShowNew(false)}>
                  取消
                </button>
                <button className="btn primary" onClick={() => void createChat()} disabled={creating}>
                  {creating ? '创建中…' : '创建对话'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {composeChat && <ComposeModal chat={composeChat} onClose={() => setComposeChat(null)} notify={notify} />}
    </div>
  )
}
