import { useEffect, useMemo, useState } from 'react'
import { Copy, FileDown, FileText, FolderOpen, ListTree, Loader2, Sparkles, X } from 'lucide-react'
import type { ChatSession, Excerpt } from '@shared/types'
import { defaultComposeOutline } from '@shared/compose'
import { Markdown } from '../ui'

interface Props {
  chat: ChatSession
  onClose(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function ComposeModal({ chat, onClose, notify }: Props): React.JSX.Element {
  const defaultTitle = chat.title && chat.title !== '新的对话' ? `${chat.title} · 阅读整理` : '文献阅读整理'
  const [title, setTitle] = useState(defaultTitle)
  const [instruction, setInstruction] = useState('')
  const [outline, setOutline] = useState(defaultComposeOutline)
  const [showOutline, setShowOutline] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [excerpts, setExcerpts] = useState<Excerpt[]>([])
  const [includeChat, setIncludeChat] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [includeExcerpts, setIncludeExcerpts] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hasNotes, setHasNotes] = useState(false)
  const [exportedPath, setExportedPath] = useState('')

  useEffect(() => {
    let alive = true
    void window.api.library.getState().then((state) => {
      if (!alive) return
      setExcerpts(state.excerpts)
      setSelectedIds(state.excerpts.map((item) => item.id))
      setHasNotes(state.documents.some((doc) => chat.docIds.includes(doc.id) && doc.notes.trim().length > 0))
    })
    return () => {
      alive = false
    }
  }, [chat.docIds])

  const hasSource = useMemo(() => {
    if (includeChat) return true
    if (includeNotes) return hasNotes
    if (includeExcerpts) return selectedIds.length > 0
    return false
  }, [includeChat, includeNotes, includeExcerpts, hasNotes, selectedIds])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !generating) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [generating, onClose])

  const toggleExcerpt = (id: string): void => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]))
  }

  const generate = async (): Promise<void> => {
    if (!hasSource) {
      setError('请至少勾选一项非空内容（对话记录、文献笔记或摘录）')
      return
    }
    setGenerating(true)
    setError('')
    try {
      const result = await window.api.agent.compose(
        chat.id,
        title.trim() || defaultTitle,
        instruction.trim(),
        { includeChat, includeNotes, includeExcerpts, excerptIds: selectedIds },
        outline.trim()
      )
      setMarkdown(result)
    } catch (err) {
      setError((err as Error).message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const exportDoc = async (format: 'docx' | 'md'): Promise<void> => {
    if (!markdown.trim()) return
    try {
      const result = await window.api.documents.exportMarkdown(title.trim() || defaultTitle, markdown, format)
      if (!result.canceled && result.filePath) {
        setExportedPath(result.filePath)
        notify(`已导出：${result.filePath}`, 'success')
      }
    } catch (err) {
      notify(`导出失败：${(err as Error).message}`, 'error')
    }
  }

  const reveal = async (): Promise<void> => {
    if (!exportedPath) return
    try {
      await window.api.app.showInFolder(exportedPath)
    } catch (err) {
      notify(`无法打开文件夹：${(err as Error).message}`, 'error')
    }
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(markdown)
      notify('已复制 Markdown 全文', 'success')
    } catch {
      notify('复制失败', 'error')
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !generating && onClose()}>
      <div className="modal compose-modal">
        <div className="modal-head">
          <div>
            <h3>整理问答与文献，生成文档</h3>
            <p className="muted">勾选要纳入的对话、文献笔记与摘录，Agent 会生成结构化的阅读整理文档。</p>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={generating} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="compose-body">
          <label className="field">
            <span>文档标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Transformer 综述阅读笔记" />
          </label>

          <div className="field">
            <span>生成范围</span>
            <div className="scope-options">
              <label className="check-item">
                <input type="checkbox" checked={includeChat} onChange={(event) => setIncludeChat(event.target.checked)} />
                对话记录
              </label>
              <label className="check-item">
                <input
                  type="checkbox"
                  checked={includeNotes}
                  onChange={(event) => setIncludeNotes(event.target.checked)}
                  disabled={!hasNotes}
                />
                文献笔记{!hasNotes && <span className="muted small">（对话关联文献暂无笔记）</span>}
              </label>
              <label className="check-item">
                <input
                  type="checkbox"
                  checked={includeExcerpts}
                  onChange={(event) => setIncludeExcerpts(event.target.checked)}
                  disabled={!excerpts.length}
                />
                摘录{excerpts.length ? `（已选 ${selectedIds.length}/${excerpts.length}）` : '（暂无）'}
              </label>
            </div>
            {includeExcerpts && excerpts.length > 0 && (
              <div className="excerpt-picker">
                <div className="excerpt-picker-head">
                  <span className="muted small">勾选要纳入文档的摘录</span>
                  <button
                    className="link-btn"
                    onClick={() => setSelectedIds(selectedIds.length ? [] : excerpts.map((item) => item.id))}
                  >
                    {selectedIds.length ? '全不选' : '全选'}
                  </button>
                </div>
                {excerpts.map((item) => (
                  <label key={item.id} className="excerpt-option">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleExcerpt(item.id)} />
                    <span className="excerpt-option-text">
                      <span className="excerpt-option-title">
                        《{item.docTitle}》{item.page ? ` 第 ${item.page} 页` : ''}
                        {item.docMissing && <span className="muted small">（来源已删除）</span>}
                      </span>
                      <span className="muted small excerpt-option-preview">
                        {item.question.trim() || item.answer.trim() || item.source || '空摘录'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {!hasSource && <div className="scope-warning">至少勾选一项非空内容才能生成。</div>}
          </div>

          <div className="field">
            <div className="field-head">
              <span>章节结构（可调整）</span>
              <button className="link-btn" onClick={() => setShowOutline((value) => !value)}>
                <ListTree size={13} /> {showOutline ? '收起' : '编辑'}
              </button>
            </div>
            {showOutline ? (
              <textarea
                rows={7}
                value={outline}
                onChange={(event) => setOutline(event.target.value)}
                placeholder="每行一个 Markdown 标题，例如：## 一、研究背景"
              />
            ) : (
              <div className="outline-summary muted small">{outline}</div>
            )}
          </div>

          <label className="field">
            <span>额外要求（可选）</span>
            <textarea
              rows={2}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="例如：重点整理实验部分；用表格对比不同方法；面向组会汇报。"
            />
          </label>

          {!markdown && (
            <button className="btn primary generate-btn" onClick={() => void generate()} disabled={generating || !hasSource}>
              {generating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              {generating ? '正在梳理素材与撰写文档…' : '生成整理文档'}
            </button>
          )}

          {generating && !markdown && (
            <div className="generate-progress">
              <div className="progress-line" />
              <span>正在检索相关原文片段、归纳问答与摘录并撰写文档，通常需要 10–60 秒。</span>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          {markdown && (
            <div className="compose-preview">
              <div className="preview-head">
                <div className="preview-title">文档预览</div>
                <div className="preview-actions">
                  <button className="btn ghost small" onClick={() => setEditing((value) => !value)}>
                    <FileText size={14} /> {editing ? '预览' : '编辑'}
                  </button>
                  <button className="btn ghost small" onClick={() => void generate()} disabled={generating || !hasSource}>
                    {generating ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} 重新生成
                  </button>
                  <button className="btn ghost small" onClick={() => void copy()}>
                    <Copy size={14} /> 复制
                  </button>
                </div>
              </div>
              {editing ? (
                <textarea className="markdown-editor" value={markdown} onChange={(event) => setMarkdown(event.target.value)} rows={18} />
              ) : (
                <div className="preview-scroll">
                  <Markdown>{markdown}</Markdown>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <div className="muted small export-path">
            {exportedPath ? (
              <>
                已导出：{exportedPath}
                <button className="link-btn" onClick={() => void reveal()}>
                  <FolderOpen size={13} /> 在文件夹中显示
                </button>
              </>
            ) : (
              '文档可在导出前直接编辑'
            )}
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose} disabled={generating}>
              关闭
            </button>
            <button className="btn" onClick={() => void exportDoc('md')} disabled={!markdown || generating}>
              <FileText size={15} /> 导出 Markdown
            </button>
            <button className="btn primary" onClick={() => void exportDoc('docx')} disabled={!markdown || generating}>
              <FileDown size={15} /> 导出 Word
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
