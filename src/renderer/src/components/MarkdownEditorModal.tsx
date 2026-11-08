import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Download,
  FileText,
  ImagePlus,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { InboxAttachment } from '@shared/types'
import { cx, Markdown } from '../ui'
import { useUnsavedChanges } from '../unsaved'
import { t } from '@shared/i18n'

export interface MarkdownEditorModalProps {
  heading: string
  subtitle?: string
  initialTitle: string
  initialContent: string
  attachments: InboxAttachment[]
  dirtyKey: string
  meta?: ReactNode
  attachmentUrl(file: string): string
  onPickAttachments(kind: 'image' | 'file'): Promise<InboxAttachment[]>
  onRemoveAttachment(attachmentId: string): Promise<void>
  onExportZip(): Promise<void>
  onSave(title: string, content: string): Promise<boolean>
  onClose(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function MarkdownEditorModal({
  heading,
  subtitle,
  initialTitle,
  initialContent,
  attachments: initialAttachments,
  dirtyKey,
  meta,
  attachmentUrl,
  onPickAttachments,
  onRemoveAttachment,
  onExportZip,
  onSave,
  onClose,
  notify
}: MarkdownEditorModalProps): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const [attachments, setAttachments] = useState<InboxAttachment[]>(initialAttachments)
  const [fullscreen, setFullscreen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [split, setSplit] = useState(50)
  const [saving, setSaving] = useState(false)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewInnerRef = useRef<HTMLDivElement>(null)
  const [previewContentSize, setPreviewContentSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const preview = previewRef.current
    const inner = previewInnerRef.current
    if (!preview || !inner) return
    const measure = (): void => {
      const style = getComputedStyle(preview)
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
      const width = Math.max(120, preview.clientWidth - padding)
      const height = inner.offsetHeight
      setPreviewContentSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(preview)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const direction = event.deltaY > 0 ? -1 : 1
        setZoom((value) => Math.min(2, Math.max(0.6, Math.round((value + direction * 0.1) * 10) / 10)))
        return
      }
      if (event.shiftKey) {
        event.preventDefault()
        preview.scrollLeft += event.deltaY
      }
    }
    preview.addEventListener('wheel', onWheel, { passive: false })
    return () => preview.removeEventListener('wheel', onWheel)
  }, [])

  const dirty = title !== initialTitle || content !== initialContent
  useUnsavedChanges(dirtyKey, dirty)

  const close = (): void => {
    if (dirty) {
      notify(t("有未保存的修改，请先保存"), 'info')
      return
    }
    onClose()
  }

  const persist = async (): Promise<boolean> => {
    if (!content.trim()) {
      notify(t("内容不能为空"), 'error')
      return false
    }
    setSaving(true)
    try {
      return await onSave(title, content)
    } catch (err) {
      notify(t("保存失败：{0}", [(err as Error).message]), 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!(await persist())) return
    onClose()
  }

  const exportZip = async (): Promise<void> => {
    if (!(await persist())) return
    try {
      await onExportZip()
    } catch (err) {
      notify(t("导出失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const insertText = (text: string): void => {
    const textarea = contentRef.current
    if (!textarea) {
      setContent((prev) => prev + text)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    setContent(content.slice(0, start) + text + content.slice(end))
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = start + text.length
    })
  }

  const upload = async (kind: 'image' | 'file'): Promise<void> => {
    try {
      const added = await onPickAttachments(kind)
      if (!added.length) return
      setAttachments((prev) => [...prev, ...added])
      notify(t("已上传 {0} 个文件", [added.length]), 'success')
    } catch (err) {
      notify(t("上传失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const remove = async (attachment: InboxAttachment): Promise<void> => {
    if (!window.confirm(t("删除附件「{0}」？", [attachment.name]))) return
    try {
      await onRemoveAttachment(attachment.id)
      setAttachments((prev) => prev.filter((entry) => entry.id !== attachment.id))
      notify(t("附件已删除"), 'success')
    } catch (err) {
      notify(t("删除附件失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const insertAttachment = (attachment: InboxAttachment): void => {
    const url = attachmentUrl(attachment.file)
    insertText(
      attachment.kind === 'image'
        ? `\n![${attachment.name}](${url})\n`
        : `\n[${attachment.name}](${url})\n`
    )
    if (attachment.kind === 'image') setPickerOpen(false)
  }

  const startSplitDrag = (event: React.PointerEvent): void => {
    const grid = gridRef.current
    if (!grid) return
    event.preventDefault()
    const rect = grid.getBoundingClientRect()
    if (!rect.width) return
    const onMove = (moveEvent: PointerEvent): void => {
      const percent = Math.min(75, Math.max(25, ((moveEvent.clientX - rect.left) / rect.width) * 100))
      if (Number.isFinite(percent)) setSplit(percent)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      <div
        className="modal-backdrop"
        onMouseDown={(event) => event.target === event.currentTarget && close()}
      >
        <div className={cx('modal', 'inbox-editor-modal', fullscreen && 'fullscreen')}>
          <div className="modal-head">
            <div>
              <h3>{heading}</h3>
              <p className="muted">{subtitle ?? t("支持 Markdown、LaTeX、附件与 ZIP 导出，右侧实时预览。")}</p>
            </div>
            <div className="inbox-editor-head-actions">
              <button
                className="icon-btn"
                title={fullscreen ? t("退出全屏") : t("全屏编辑")}
                onClick={() => setFullscreen((value) => !value)}
              >
                {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
              <button className="icon-btn" title={t("关闭")} onClick={close}>
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="inbox-editor-body">
            <input
              className="inbox-editor-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("标题（可选）")}
            />
            <div className="inbox-editor-toolbar">
              <button className="btn ghost small" onClick={() => setPickerOpen(true)}>
                <ImagePlus size={14} /> {' '}{t("插入图片")}{' '}</button>
              <button className="btn ghost small" onClick={() => void upload('file')}>
                <Paperclip size={14} /> {' '}{t("上传文件")}{' '}</button>
              <button className="btn ghost small" onClick={() => insertText('\n$$\n\n$$\n')}>
                {' '}{t("插入公式")}{' '}</button>
              <button className="btn ghost small" onClick={() => insertText(t("\n- [ ] 待办\n"))}>
                {' '}{t("插入待办")}{' '}</button>
              <button className="btn ghost small" onClick={() => void exportZip()}>
                <Download size={14} /> {' '}{t("导出 ZIP")}{' '}</button>
              <div className="inbox-zoom-controls">
                <button
                  className="icon-btn tiny"
                  title={t("缩小预览")}
                  onClick={() => setZoom((value) => Math.max(0.6, Math.round((value - 0.1) * 10) / 10))}
                >
                  <ZoomOut size={13} />
                </button>
                <span className="muted small">{Math.round(zoom * 100)}%</span>
                <button
                  className="icon-btn tiny"
                  title={t("放大预览")}
                  onClick={() => setZoom((value) => Math.min(2, Math.round((value + 0.1) * 10) / 10))}
                >
                  <ZoomIn size={13} />
                </button>
              </div>
            </div>
            {meta}
            {attachments.length > 0 && (
              <div className="inbox-attachments">
                {attachments.map((attachment) => (
                  <div className="inbox-attachment" key={attachment.id}>
                    {attachment.kind === 'image' ? (
                      <img src={attachmentUrl(attachment.file)} alt="" />
                    ) : (
                      <span className="inbox-attachment-file">
                        <FileText size={16} />
                      </span>
                    )}
                    <div className="inbox-attachment-meta">
                      <span className="inbox-attachment-name" title={attachment.name}>
                        {attachment.name}
                      </span>
                      <span className="muted small">{formatSize(attachment.size)}</span>
                    </div>
                    <button
                      className="icon-btn tiny"
                      title={attachment.kind === 'image' ? t("插入图片") : t("插入链接")}
                      onClick={() => insertAttachment(attachment)}
                    >
                      <Plus size={12} />
                    </button>
                    <button className="icon-btn tiny" title={t("删除附件")} onClick={() => void remove(attachment)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div
              className="inbox-editor-grid"
              ref={gridRef}
              style={{ '--editor-split': `${split}%` } as React.CSSProperties}
            >
              <textarea
                ref={contentRef}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    void save()
                  }
                }}
                placeholder={t("支持 Markdown、LaTeX 公式与图片…")}
              />
              <div className="inbox-editor-divider" onPointerDown={startSplitDrag} title={t("拖动调整编辑/预览宽度")} />
              <div
                className="inbox-editor-preview"
                ref={previewRef}
                title={t("Ctrl+滚轮缩放，Shift+滚轮横向滚动，普通滚轮上下滚动")}
              >
                <div
                  className="inbox-preview-scaler"
                  style={{
                    width: previewContentSize.width ? previewContentSize.width * zoom : '100%',
                    height: previewContentSize.height ? previewContentSize.height * zoom : undefined
                  }}
                >
                  <div
                    ref={previewInnerRef}
                    style={{
                      width: previewContentSize.width || '100%',
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top left'
                    }}
                  >
                    <Markdown>{content}</Markdown>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-foot">
            <div className="muted small">{t("Ctrl+Enter 保存；保存后列表按 Markdown 渲染")}</div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={close}>
                {' '}{t("取消")}{' '}</button>
              <button className="btn primary" onClick={() => void save()} disabled={saving}>
                {saving ? t("保存中…") : t("保存")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <div
          className="modal-backdrop attachment-picker-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setPickerOpen(false)}
        >
          <div className="modal attachment-picker-modal">
            <div className="modal-head">
              <div>
                <h3>{t("选择图片")}</h3>
                <p className="muted">{t("从已上传的图片中选择，或上传新图片后插入。")}</p>
              </div>
              <button className="icon-btn" title={t("关闭")} onClick={() => setPickerOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="attachment-picker-grid">
              {attachments.filter((attachment) => attachment.kind === 'image').length === 0 && (
                <div className="muted">{t("还没有图片附件，请先上传。")}</div>
              )}
              {attachments
                .filter((attachment) => attachment.kind === 'image')
                .map((attachment) => (
                  <button
                    className="attachment-pick-item"
                    key={attachment.id}
                    onClick={() => insertAttachment(attachment)}
                    title={attachment.name}
                  >
                    <img src={attachmentUrl(attachment.file)} alt="" />
                    <span>{attachment.name}</span>
                  </button>
                ))}
            </div>
            <div className="modal-foot">
              <div className="muted small">{t("插入的是附件路径，不会把图片编码进 Markdown")}</div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => void upload('image')}>
                  <ImagePlus size={14} /> {' '}{t("上传新图片")}{' '}</button>
                <button className="btn ghost" onClick={() => setPickerOpen(false)}>
                  {' '}{t("取消")}{' '}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
