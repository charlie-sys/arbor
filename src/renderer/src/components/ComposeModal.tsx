import { useEffect, useState } from 'react'
import { Copy, FileDown, FileText, Loader2, Sparkles, X } from 'lucide-react'
import type { ChatSession } from '@shared/types'
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
  const [markdown, setMarkdown] = useState('')
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !generating) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [generating, onClose])

  const generate = async (): Promise<void> => {
    setGenerating(true)
    setError('')
    try {
      const result = await window.api.agent.compose(chat.id, title.trim() || defaultTitle, instruction.trim())
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
        notify(`已导出：${result.filePath}`, 'success')
      }
    } catch (err) {
      notify(`导出失败：${(err as Error).message}`, 'error')
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
            <p className="muted">Agent 会结合所选文献原文与对话内容，生成结构化的阅读整理文档。</p>
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
            <button className="btn primary generate-btn" onClick={() => void generate()} disabled={generating}>
              {generating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              {generating ? '正在梳理文献与问答…' : '生成整理文档'}
            </button>
          )}

          {generating && !markdown && (
            <div className="generate-progress">
              <div className="progress-line" />
              <span>正在检索相关原文片段、归纳问答要点并撰写文档，通常需要 10–60 秒。</span>
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
                  <button className="btn ghost small" onClick={() => void generate()} disabled={generating}>
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
          <div className="muted small">文档可在导出前直接编辑</div>
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
