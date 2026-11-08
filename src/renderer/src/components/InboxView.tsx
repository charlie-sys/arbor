import { useRef, useState } from 'react'
import {
  Archive,
  Check,
  Download,
  FileText,
  ImagePlus,
  Inbox,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { InboxAttachment, InboxItem, InboxKind, InboxSuggestion } from '@shared/types'
import { formatTime, cx, Markdown } from '../ui'
import { useUnsavedChanges } from '../unsaved'
import MarkdownEditorModal from './MarkdownEditorModal'
import { t } from '@shared/i18n'

const KIND_LABEL: Record<InboxKind, string> = {
  text: '文本',
  link: '链接',
  excerpt: '摘录',
  todo: '待办'
}

const SUGGESTION_LABEL: Record<InboxSuggestion['type'], string> = {
  tag: '标签',
  collection: '分类',
  excerpt: '摘录',
  task: '任务'
}

function attachmentUrl(inboxId: string, file: string): string {
  return `zotfile://attachments/${inboxId}/${encodeURIComponent(file)}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface InboxViewProps {
  items: InboxItem[]
  onCapture(): void
  onChanged(): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function InboxView({ items, onCapture, onChanged, notify }: InboxViewProps): React.JSX.Element {
  const [showArchived, setShowArchived] = useState(false)
  const [suggestions, setSuggestions] = useState<InboxSuggestion[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [editing, setEditing] = useState<InboxItem | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [editorFullscreen, setEditorFullscreen] = useState(false)
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [editorSplit, setEditorSplit] = useState(50)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const active = items.filter((item) => !item.archived)
  const archived = items.filter((item) => item.archived)
  const visible = showArchived ? archived : active

  const runSuggest = async (): Promise<void> => {
    if (!active.length) {
      notify(t("灵感收集里还没有待整理内容"), 'info')
      return
    }
    setSuggesting(true)
    try {
      const result = await window.api.inbox.suggest()
      setSuggestions(result)
      notify(result.length ? t("AI 给出 {0} 条归类建议，请逐条确认", [result.length]) : t("AI 没有给出新的归类建议"), result.length ? 'success' : 'info')
    } catch (err) {
      notify(t("AI 整理失败：{0}", [(err as Error).message]), 'error')
    } finally {
      setSuggesting(false)
    }
  }

  const acceptSuggestion = async (suggestion: InboxSuggestion): Promise<void> => {
    try {
      await window.api.inbox.apply(suggestion.inboxId, suggestion)
      setSuggestions((prev) => prev.filter((entry) => entry !== suggestion))
      await onChanged()
      notify(t("已写入{0}「{1}」", [t(SUGGESTION_LABEL[suggestion.type]), suggestion.value]), 'success')
    } catch (err) {
      notify(t("采纳建议失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const toggleArchive = async (item: InboxItem): Promise<void> => {
    try {
      await window.api.inbox.update(item.id, { archived: !item.archived })
      setSuggestions((prev) => prev.filter((entry) => entry.inboxId !== item.id))
      await onChanged()
    } catch (err) {
      notify(t("操作失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const removeItem = async (item: InboxItem): Promise<void> => {
    if (!window.confirm(t("删除这条捕获内容？"))) return
    try {
      await window.api.inbox.remove(item.id)
      setSuggestions((prev) => prev.filter((entry) => entry.inboxId !== item.id))
      await onChanged()
    } catch (err) {
      notify(t("删除失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const convertToTask = async (item: InboxItem): Promise<void> => {
    try {
      await window.api.tasks.add({ title: item.title || item.content.slice(0, 80), docId: item.docId, inboxId: item.id })
      await window.api.inbox.update(item.id, { archived: true })
      await onChanged()
      notify(t("已转为任务"), 'success')
    } catch (err) {
      notify(t("转为任务失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const openEditor = (item: InboxItem): void => {
    setEditing(item)
    setDraftTitle(item.title)
    setDraftContent(item.content)
    setEditorFullscreen(false)
    setAttachmentPickerOpen(false)
    setPreviewZoom(1)
    setEditorSplit(50)
  }

  const insertText = (text: string): void => {
    const textarea = contentRef.current
    if (!textarea) {
      setDraftContent((prev) => prev + text)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const next = draftContent.slice(0, start) + text + draftContent.slice(end)
    setDraftContent(next)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = start + text.length
    })
  }

  const attachments = editing?.attachments ?? []
  const inboxEditorDirty =
    !!editing && (draftTitle !== editing.title || draftContent !== editing.content)
  useUnsavedChanges('inbox-editor', inboxEditorDirty)

  const closeEditor = (): void => {
    if (inboxEditorDirty) {
      notify(t("灵感收集有未保存的修改，请先保存"), 'info')
      return
    }
    setEditing(null)
  }

  const persistEditor = async (): Promise<boolean> => {
    if (!editing) return false
    if (!draftContent.trim()) {
      notify(t("内容不能为空"), 'error')
      return false
    }
    try {
      await window.api.inbox.update(editing.id, { title: draftTitle, content: draftContent })
      await onChanged()
      return true
    } catch (err) {
      notify(t("保存失败：{0}", [(err as Error).message]), 'error')
      return false
    }
  }

  const saveEditor = async (): Promise<void> => {
    if (!(await persistEditor())) return
    setEditing(null)
    notify(t("灵感收集已更新"), 'success')
  }

  const uploadAttachments = async (kind: 'image' | 'file'): Promise<void> => {
    if (!editing) return
    try {
      const added = await window.api.inbox.pickAttachments(editing.id, kind)
      if (!added.length) return
      setEditing((prev) =>
        prev ? { ...prev, attachments: [...(prev.attachments ?? []), ...added] } : prev
      )
      notify(t("已上传 {0} 个文件", [added.length]), 'success')
    } catch (err) {
      notify(t("上传失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const removeAttachment = async (attachment: InboxAttachment): Promise<void> => {
    if (!editing) return
    if (!window.confirm(t("删除附件「{0}」？", [attachment.name]))) return
    try {
      await window.api.inbox.removeAttachment(editing.id, attachment.id)
      setEditing((prev) =>
        prev
          ? { ...prev, attachments: (prev.attachments ?? []).filter((entry) => entry.id !== attachment.id) }
          : prev
      )
      notify(t("附件已删除"), 'success')
    } catch (err) {
      notify(t("删除附件失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const insertAttachment = (attachment: InboxAttachment): void => {
    if (!editing) return
    const url = attachmentUrl(editing.id, attachment.file)
    insertText(
      attachment.kind === 'image'
        ? `\n![${attachment.name}](${url})\n`
        : `\n[${attachment.name}](${url})\n`
    )
    if (attachment.kind === 'image') setAttachmentPickerOpen(false)
  }

  const exportZip = async (): Promise<void> => {
    if (!editing) return
    if (!(await persistEditor())) return
    try {
      const result = await window.api.inbox.exportZip(editing.id)
      if (!result.canceled && result.filePath) notify(t("已导出：{0}", [result.filePath]), 'success')
    } catch (err) {
      notify(t("导出失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const startSplitDrag = (event: React.PointerEvent): void => {
    const grid = gridRef.current
    if (!grid) return
    event.preventDefault()
    const rect = grid.getBoundingClientRect()
    const onMove = (moveEvent: PointerEvent): void => {
      const percent = Math.min(75, Math.max(25, ((moveEvent.clientX - rect.left) / rect.width) * 100))
      setEditorSplit(percent)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="view inbox-view">
      <header className="view-head">
        <div>
          <h1>{t("灵感收集")}</h1>
          <p className="muted">{t("快速捕获文本、链接、摘录与待办；Ctrl+N 可从任意页面唤起。")}</p>
        </div>
        <div className="inbox-head-actions">
          <button className="btn ghost" onClick={() => void runSuggest()} disabled={suggesting || !active.length}>
            <Sparkles size={15} /> {suggesting ? t("整理中…") : t("AI 整理")}
          </button>
          <button className="btn primary" onClick={onCapture}>
            <Plus size={15} /> {' '}{t("快速捕获")}{' '}</button>
        </div>
      </header>

      <div className="inbox-tabs">
        <button className={cx('chip-button', !showArchived && 'active')} onClick={() => setShowArchived(false)}>
          {' '}{t("待处理")}{' '}{active.length}
        </button>
        <button className={cx('chip-button', showArchived && 'active')} onClick={() => setShowArchived(true)}>
          {' '}{t("已归档")}{' '}{archived.length}
        </button>
      </div>

      {suggestions.length > 0 && (
        <section className="card inbox-suggest-card">
          <h2>
            <Sparkles size={15} /> {' '}{t("AI 归类建议（确认后才会写入）")}{' '}</h2>
          <div className="suggest-list">
            {suggestions.map((suggestion, index) => {
              const source = items.find((item) => item.id === suggestion.inboxId)
              return (
                <div key={`${suggestion.inboxId}-${suggestion.type}-${suggestion.value}-${index}`} className="suggest-item">
                  <div className="suggest-main">
                    <span className="inbox-kind">{t(SUGGESTION_LABEL[suggestion.type])}</span>
                    <strong>{suggestion.value}</strong>
                    {source && <span className="muted small">· {source.content.slice(0, 40)}</span>}
                    {suggestion.reason && <div className="muted small">{suggestion.reason}</div>}
                  </div>
                  <div className="suggest-actions">
                    <button className="btn small primary" onClick={() => void acceptSuggestion(suggestion)}>
                      <Check size={13} /> {' '}{t("采纳")}{' '}</button>
                    <button
                      className="btn small ghost"
                      onClick={() => setSuggestions((prev) => prev.filter((entry) => entry !== suggestion))}
                    >
                      {' '}{t("忽略")}{' '}</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Inbox size={26} />
          </div>
          <h2>{showArchived ? t("还没有归档内容") : t("灵感收集是空的")}</h2>
          <p className="muted">
            {showArchived ? t("归档后的内容会出现在这里。") : t("按 Ctrl+N 快速捕获想法、链接或待办。")}
          </p>
          {!showArchived && (
            <button className="btn primary" onClick={onCapture}>
              <Plus size={15} /> {' '}{t("快速捕获")}{' '}</button>
          )}
        </div>
      ) : (
        <div className="inbox-list">
          {visible.map((item) => (
            <article key={item.id} className="inbox-item" onClick={() => openEditor(item)} title={t("点击编辑内容")}>
              <div className="inbox-item-head">
                <span className={`inbox-kind kind-${item.kind}`}>{t(KIND_LABEL[item.kind])}</span>
                {item.title && <span className="inbox-title">{item.title}</span>}
                <span className="muted small">{formatTime(item.createdAt)}</span>
              </div>
              {item.url ? (
                <a
                  className="inbox-link"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                >
                  {item.content}
                </a>
              ) : (
                <div className="inbox-content" title={item.content}>
                  <Markdown>{item.content}</Markdown>
                </div>
              )}
              {item.tags && item.tags.length > 0 && (
                <div className="inbox-tags">
                  {item.tags.map((tag) => (
                    <span className="inbox-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="inbox-item-foot" onClick={(event) => event.stopPropagation()}>
                <div className="inbox-actions">
                  {!item.archived && item.kind !== 'todo' && (
                    <button className="link-btn" onClick={() => void convertToTask(item)}>
                      {' '}{t("转为任务")}{' '}</button>
                  )}
                  <button className="link-btn" onClick={() => void toggleArchive(item)}>
                    {item.archived ? (
                      <>
                        <RotateCcw size={12} /> {' '}{t("恢复")}{' '}</>
                    ) : (
                      <>
                        <Archive size={12} /> {' '}{t("归档")}{' '}</>
                    )}
                  </button>
                  <button className="icon-btn tiny" title={t("删除")} onClick={() => void removeItem(item)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <MarkdownEditorModal
          key={editing.id}
          heading={t("编辑灵感内容")}
          initialTitle={editing.title}
          initialContent={editing.content}
          attachments={editing.attachments ?? []}
          dirtyKey={`inbox-editor-${editing.id}`}
          attachmentUrl={(file) => attachmentUrl(editing.id, file)}
          onPickAttachments={(kind) => window.api.inbox.pickAttachments(editing.id, kind)}
          onRemoveAttachment={(attachmentId) => window.api.inbox.removeAttachment(editing.id, attachmentId)}
          onExportZip={async () => {
            const result = await window.api.inbox.exportZip(editing.id)
            if (!result.canceled && result.filePath) notify(t("已导出：{0}", [result.filePath]), 'success')
          }}
          onSave={async (title, content) => {
            await window.api.inbox.update(editing.id, { title, content })
            await onChanged()
            notify(t("灵感收集已更新"), 'success')
            return true
          }}
          onClose={() => setEditing(null)}
          notify={notify}
        />
      )}
    </div>
  )
}

interface QuickCaptureProps {
  onClose(): void
  onSaved(): Promise<unknown> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export function QuickCapture({ onClose, onSaved, notify }: QuickCaptureProps): React.JSX.Element {
  const [kind, setKind] = useState<InboxKind>('text')
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const quickDraftDirty = !!(content.trim() || title.trim() || due)
  useUnsavedChanges('quick-capture', quickDraftDirty)
  const closeCapture = (): void => {
    if (quickDraftDirty) {
      notify(t("有未保存的捕获内容，请先保存"), 'info')
      return
    }
    onClose()
  }

  const submit = async (): Promise<void> => {
    const text = content.trim()
    if (!text) {
      notify(t("请输入捕获内容"), 'error')
      return
    }
    setSaving(true)
    try {
      const isUrl = /^https?:\/\//i.test(text)
      await window.api.inbox.add({
        kind,
        content: text,
        title: title.trim() || undefined,
        url: kind === 'link' && isUrl ? text : undefined,
        due: kind === 'todo' ? due || undefined : undefined
      })
      await onSaved()
      notify(kind === 'todo' ? t("已捕获待办并创建任务") : t("已存入灵感收集"), 'success')
      onClose()
    } catch (err) {
      notify(t("捕获失败：{0}", [(err as Error).message]), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeCapture()
      }}
    >
      <div
        className="modal quick-capture"
        onKeyDown={(event) => {
          if (event.key === 'Escape') closeCapture()
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit()
        }}
      >
        <div className="modal-head">
          <div>
            <h3>{t("快速捕获")}</h3>
            <p className="muted">{t("内容会保存到灵感收集；待办同时创建任务。")}</p>
          </div>
          <button className="icon-btn" title={t("关闭")} onClick={closeCapture}>
            <X size={16} />
          </button>
        </div>
        <div className="quick-capture-body">
          <div className="capture-kinds">
            {(Object.keys(KIND_LABEL) as InboxKind[]).map((value) => (
              <button
                key={value}
                className={cx('chip-button', kind === value && 'active')}
                onClick={() => setKind(value)}
              >
                {t(KIND_LABEL[value])}
              </button>
            ))}
          </div>
          <label className="field">
            <span>{t("内容 *")}</span>
            <textarea
              autoFocus
              rows={5}
              value={content}
              placeholder={kind === 'link' ? t("粘贴链接或补充说明") : kind === 'todo' ? t("要完成的事情") : t("记录想法、摘录或要点…")}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("标题（可选）")}</span>
            <input value={title} placeholder={t("给这条内容一个标题")} onChange={(event) => setTitle(event.target.value)} />
          </label>
          {kind === 'todo' && (
            <label className="field">
              <span>{t("截止日期（可选）")}</span>
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </label>
          )}
          <div className="hint">{t("Ctrl + Enter 保存，Esc 关闭。")}</div>
        </div>
        <div className="modal-foot">
          <div className="modal-actions">
            <button className="btn ghost" onClick={closeCapture}>
              {' '}{t("取消")}{' '}</button>
            <button className="btn primary" disabled={saving} onClick={() => void submit()}>
              {saving ? t("保存中…") : t("保存到灵感收集")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
