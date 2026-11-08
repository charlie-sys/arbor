import { useMemo, useState } from 'react'
import { ArrowLeft, FileText, Layers, Loader2, MessagesSquare, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { Excerpt, LibraryData } from '@shared/types'
import { cx, formatTime, Markdown } from '../ui'
import MarkdownEditorModal from './MarkdownEditorModal'
import { t } from '@shared/i18n'

interface Props {
  data: LibraryData
  topicId?: string
  onSelectTopic(topicId?: string): void
  onOpenChat(chatId: string, question?: string): void
  onOpenDoc(docId: string, page?: number): void
  onChanged(): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

const panelStyle: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '14px 16px'
}

const REVIEW_PROMPT =
  '请基于以上全部成员文献生成一篇结构化的研究综述：先归纳共同主题，再比较各文献的方法与结论，最后指出研究空白与可延伸的问题。'

export default function TopicsView({
  data,
  topicId,
  onSelectTopic,
  onOpenChat,
  onOpenDoc,
  onChanged,
  notify
}: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [editingExcerpt, setEditingExcerpt] = useState<Excerpt | null>(null)

  const topic = topicId ? data.researchTopics.find((item) => item.id === topicId) ?? null : null
  const docs = topic ? data.documents.filter((doc) => topic.docIds.includes(doc.id)) : []
  const excerpts = useMemo(() => {
    if (!topic) return []
    return data.excerpts
      .filter((excerpt) => excerpt.docId && topic.docIds.includes(excerpt.docId))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [topic, data.excerpts])

  const toggleDoc = (id: string): void =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

  const createTopic = async (): Promise<void> => {
    setBusy('create')
    try {
      const created = await window.api.topics.add({ name: name.trim() || t("未命名研究主题"), docIds: picked })
      await onChanged()
      setName('')
      setPicked([])
      setCreating(false)
      onSelectTopic(created.id)
      notify(t("已创建研究主题「{0}」", [created.name]), 'success')
    } catch (err) {
      notify(t("创建失败：{0}", [(err as Error).message]), 'error')
    } finally {
      setBusy(null)
    }
  }

  const removeTopic = async (id: string, title: string): Promise<void> => {
    if (!window.confirm(t("删除研究主题「{0}」？文献、摘录与对话不会被删除。", [title]))) return
    try {
      await window.api.topics.remove(id)
      await onChanged()
      if (topicId === id) onSelectTopic(undefined)
      notify(t("研究主题已删除"), 'success')
    } catch (err) {
      notify(t("删除失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const suggest = async (): Promise<void> => {
    if (!topic) return
    setBusy('suggest')
    try {
      await window.api.topics.suggest(topic.id)
      await onChanged()
      notify(t("已生成建议问题"), 'success')
    } catch (err) {
      notify(t("生成建议问题失败：{0}", [(err as Error).message]), 'error')
    } finally {
      setBusy(null)
    }
  }

  const startChat = async (question?: string, title?: string): Promise<void> => {
    if (!topic) return
    setBusy('chat')
    try {
      const chat = await window.api.chats.create(topic.docIds)
      await window.api.chats.update(chat.id, { title: title ?? t("{0} · 主题对话", [topic.name]) })
      if (!question) await window.api.topics.update(topic.id, { chatId: chat.id })
      await onChanged()
      onOpenChat(chat.id, question)
    } catch (err) {
      notify(t("创建主题对话失败：{0}", [(err as Error).message]), 'error')
    } finally {
      setBusy(null)
    }
  }

  const openChat = async (): Promise<void> => {
    if (!topic) return
    if (topic.chatId && data.chats.some((chat) => chat.id === topic.chatId)) {
      onOpenChat(topic.chatId)
      return
    }
    await startChat()
  }

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>{t("研究主题")}</h1>
          <p className="muted">{t("把多篇文献聚合为一个研究空间，汇总问题、摘录与对话。")}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {topic && (
            <button className="btn ghost" onClick={() => onSelectTopic(undefined)}>
              <ArrowLeft size={14} /> {' '}{t("全部主题")}{' '}</button>
          )}
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> {' '}{t("新建研究主题")}{' '}</button>
        </div>
      </header>

      {!topic && (
        <>
          {data.researchTopics.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Layers size={28} />
              </div>
              <h2>{t("还没有研究主题")}</h2>
              <p className="muted">{t("选择若干文献，生成主题空间与建议提问。")}</p>
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> {' '}{t("新建研究主题")}{' '}</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {data.researchTopics.map((item) => {
                const members = data.documents.filter((doc) => item.docIds.includes(doc.id))
                return (
                  <div key={item.id} className="doc-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }} onClick={() => onSelectTopic(item.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{item.name}</strong>
                      <button
                        className="icon-btn tiny"
                        title={t("删除研究主题")}
                        onClick={(event) => {
                          event.stopPropagation()
                          void removeTopic(item.id, item.name)
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="muted small">
                      {item.docIds.length} {' '}{t("篇文献 ·")}{' '}{item.questions.length} {' '}{t("个建议问题 ·")}{' '}{formatTime(item.updatedAt)}
                    </div>
                    <div className="chat-doc-chips">
                      {members.slice(0, 3).map((doc) => (
                        <span key={doc.id} className="doc-chip">
                          <FileText size={12} /> {doc.title.length > 18 ? `${doc.title.slice(0, 18)}…` : doc.title}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {topic && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 15 }}>{t("成员文献")}</h2>
                <span className="muted small">{docs.length} {' '}{t("篇")}</span>
              </div>
              {docs.map((doc) => (
                <button key={doc.id} className="doc-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => onOpenDoc(doc.id)}>
                  <FileText size={14} />
                  <span style={{ flex: 1 }}>{doc.title}</span>
                  <span className="muted small">{doc.year || '—'}</span>
                </button>
              ))}
              {!docs.length && <div className="muted small">{t("成员文献均已删除，请重建主题。")}</div>}
            </div>

            <div style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 15 }}>{t("建议问题")}</h2>
                <button className="btn small" onClick={() => void suggest()} disabled={busy === 'suggest' || !docs.length}>
                  {busy === 'suggest' ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                  {topic.questions.length ? t("重新生成") : t("生成建议问题")}
                </button>
              </div>
              {!data.settings.apiKey && (
                <div className="notice" style={{ marginBottom: 8 }}>
                  {' '}{t("尚未配置模型 API，生成建议问题前请先在「设置」中填写 API Key。")}{' '}</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topic.questions.map((question) => (
                  <button
                    key={question}
                    className="session-item"
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => void startChat(question, question.slice(0, 44))}
                  >
                    {question}
                  </button>
                ))}
                {!topic.questions.length && <div className="muted small">{t("生成后点击问题即可发起主题对话。")}</div>}
              </div>
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={panelStyle}>
              <h2 style={{ margin: '0 0 10px', fontSize: 15 }}>{t("主题对话")}</h2>
              <p className="muted small" style={{ margin: '0 0 10px' }}>
                {' '}{t("对话会自动携带全部")}{' '}{topic.docIds.length} {' '}{t("篇成员文献作为上下文。")}{' '}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn primary small" onClick={() => void openChat()} disabled={busy === 'chat' || !topic.docIds.length}>
                  <MessagesSquare size={14} /> {' '}{t("打开主题对话")}{' '}</button>
                <button
                  className="btn ghost small"
                  onClick={() => void startChat(t(REVIEW_PROMPT), t("{0} · 研究综述", [topic.name]))}
                  disabled={busy === 'chat' || !topic.docIds.length}
                >
                  <Sparkles size={14} /> {' '}{t("生成综述")}{' '}</button>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 15 }}>{t("主题摘录")}</h2>
                <span className="muted small">{excerpts.length} {' '}{t("条")}</span>
              </div>
              <div className="excerpt-list">
                {excerpts.map((excerpt) => (
                  <div
                    key={excerpt.id}
                    className={cx('excerpt-item', 'clickable', excerpt.docMissing && 'missing')}
                    role="button"
                    tabIndex={0}
                    title={t("点击编辑摘录")}
                    onClick={() => setEditingExcerpt(excerpt)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setEditingExcerpt(excerpt)
                      }
                    }}
                  >
                    <div className="excerpt-head">
                      <button
                        className="link-btn excerpt-doc"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (excerpt.docId) onOpenDoc(excerpt.docId, excerpt.page)
                        }}
                      >
                        {excerpt.docTitle}
                      </button>
                      {excerpt.page ? <span className="excerpt-page">p.{excerpt.page}</span> : null}
                    </div>
                    {excerpt.question && (
                      <div className="excerpt-question">
                        <Markdown>{excerpt.question}</Markdown>
                      </div>
                    )}
                    {excerpt.source && <div className="excerpt-source">{excerpt.source}</div>}
                    {excerpt.answer && (
                      <div className="excerpt-answer">
                        <Markdown>{excerpt.answer}</Markdown>
                      </div>
                    )}
                  </div>
                ))}
                {!excerpts.length && <div className="muted small">{t("主题内文献还没有摘录或保存的回答。")}</div>}
              </div>
            </div>
          </section>
        </div>
      )}

      {creating && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCreating(false)}>
          <div className="modal new-chat-modal">
            <div className="modal-head">
              <div>
                <h3>{t("新建研究主题")}</h3>
                <p className="muted">{t("选择若干文献，之后可生成建议问题并围绕它们对话。")}</p>
              </div>
              <button className="icon-btn" onClick={() => setCreating(false)} title={t("关闭")}>
                <X size={18} />
              </button>
            </div>
            <input
              className="collection-input"
              style={{ marginBottom: 10 }}
              autoFocus
              value={name}
              placeholder={t("研究主题名称，如：多模态检索综述")}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="doc-picker">
              {data.documents.map((doc) => (
                <label key={doc.id} className={cx('doc-pick-item', picked.includes(doc.id) && 'checked')}>
                  <input type="checkbox" checked={picked.includes(doc.id)} onChange={() => toggleDoc(doc.id)} />
                  <div>
                    <div className="doc-pick-title">{doc.title}</div>
                    <div className="muted small">{[doc.authors, doc.year].filter(Boolean).join(' · ') || t("未填写元数据")}</div>
                  </div>
                </label>
              ))}
              {!data.documents.length && <div className="muted">{t("文献库为空，请先导入文献。")}</div>}
            </div>
            <div className="modal-foot">
              <div className="muted small">{t("已选择")}{' '}{picked.length} {' '}{t("篇")}</div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setCreating(false)}>
                  {' '}{t("取消")}{' '}</button>
                <button className="btn primary" onClick={() => void createTopic()} disabled={busy === 'create' || !picked.length}>
                  {busy === 'create' ? t("创建中…") : t("创建主题")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingExcerpt && (
        <MarkdownEditorModal
          key={editingExcerpt.id}
          heading={t("编辑主题摘录")}
          subtitle={t("{0}{1}", [editingExcerpt.docTitle, editingExcerpt.page ? ` · 第 ${editingExcerpt.page} 页` : ''])}
          initialTitle={editingExcerpt.question}
          initialContent={editingExcerpt.answer}
          attachments={editingExcerpt.attachments ?? []}
          dirtyKey={`topic-excerpt-${editingExcerpt.id}`}
          meta={
            editingExcerpt.source ? (
              <div className="excerpt-detail-quote topic-excerpt-source">{editingExcerpt.source}</div>
            ) : undefined
          }
          attachmentUrl={(file) => `zotfile://attachments/${editingExcerpt.id}/${encodeURIComponent(file)}`}
          onPickAttachments={(kind) => window.api.excerpts.pickAttachments(editingExcerpt.id, kind)}
          onRemoveAttachment={(attachmentId) =>
            window.api.excerpts.removeAttachment(editingExcerpt.id, attachmentId)
          }
          onExportZip={async () => {
            const result = await window.api.excerpts.exportZip(editingExcerpt.id)
            if (!result.canceled && result.filePath) notify(t("已导出：{0}", [result.filePath]), 'success')
          }}
          onSave={async (title, content) => {
            await window.api.excerpts.update(editingExcerpt.id, { question: title, answer: content })
            await onChanged()
            notify(t("摘录已更新"), 'success')
            return true
          }}
          onClose={() => setEditingExcerpt(null)}
          notify={notify}
        />
      )}
    </div>
  )
}
