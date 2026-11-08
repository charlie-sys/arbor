import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, MessageSquarePlus, NotebookPen, Sparkles, X } from 'lucide-react'
import type { AiActionId, DocumentMeta } from '@shared/types'
import { aiActionMeta } from '@shared/aiActions'
import { Markdown } from '../ui'
import './AiActionPanel.css'
import { t } from '@shared/i18n'

interface Props {
  action: AiActionId
  selection: { text: string; page: number }
  docId: string
  docTitle: string
  documents: DocumentMeta[]
  onClose(): void
  onSaved(): Promise<void> | void
  onContinueAsk(text: string, page: number): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function AiActionPanel({
  action,
  selection,
  docId,
  docTitle,
  documents,
  onClose,
  onSaved,
  onContinueAsk,
  notify
}: Props): React.JSX.Element {
  const meta = aiActionMeta(action)
  const targetDocs = useMemo(() => documents.filter((doc) => doc.id !== docId), [documents, docId])
  const [targetDocId, setTargetDocId] = useState(targetDocs[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const run = useCallback(async (): Promise<void> => {
    if (action === 'compare' && !targetDocId) {
      setError(t("请选择要对比的文献"))
      return
    }
    setBusy(true)
    setError('')
    setResult('')
    setSaved(false)
    try {
      const output = await window.api.actions.run({
        action,
        text: selection.text,
        page: selection.page,
        docId,
        targetDocId: action === 'compare' ? targetDocId : undefined
      })
      setResult(output.content)
    } catch (err) {
      setError((err as Error).message || t("生成失败"))
    } finally {
      setBusy(false)
    }
  }, [action, targetDocId, selection.text, selection.page, docId])

  useEffect(() => {
    if (action === 'compare') return
    void run()
  }, [action, run])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(result)
      notify(t("已复制结果"), 'success')
    } catch {
      notify(t("复制失败"), 'error')
    }
  }

  const saveExcerpt = async (): Promise<void> => {
    if (!result) return
    try {
      await window.api.excerpts.add({
        docId,
        page: selection.page,
        source: `AI·${t(meta.label)}`,
        question: selection.text,
        answer: result
      })
      setSaved(true)
      notify(t("已存为摘录"), 'success')
      await onSaved()
    } catch (err) {
      notify(t("保存摘录失败：{0}", [(err as Error).message]), 'error')
    }
  }

  return (
    <aside className="ai-action-panel">
      <div className="ai-action-head">
        <span className="ai-action-title">
          <Sparkles size={14} /> {t(meta.label)}
          <span className="muted">{t("· 第")}{' '}{selection.page} {' '}{t("页")}</span>
        </span>
        <button className="icon-btn tiny" title={t("关闭")} onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="ai-action-source" title={docTitle}>
        {selection.text}
      </div>

      {meta.needsTarget && (
        <div className="ai-action-target">
          {targetDocs.length ? (
            <>
              <select value={targetDocId} onChange={(event) => setTargetDocId(event.target.value)}>
                {targetDocs.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title}
                  </option>
                ))}
              </select>
              <button className="btn primary small" disabled={busy} onClick={() => void run()}>
                {busy ? t("对比中…") : t("开始对比")}
              </button>
            </>
          ) : (
            <p className="muted">{t("文献库中只有这一篇文献，无法对比。")}</p>
          )}
        </div>
      )}

      <div className="ai-action-body">
        {busy && (
          <p className="muted ai-action-loading">
            <Loader2 size={14} className="ai-spin" /> {' '}{t("正在生成…")}{' '}</p>
        )}
        {error && <p className="ai-action-error">{error}</p>}
        {!busy && !error && !result && !meta.needsTarget && <p className="muted">{t("暂无结果。")}</p>}
        {result && <Markdown>{result}</Markdown>}
      </div>

      <div className="ai-action-actions">
        <button className="btn ghost small" disabled={!result} onClick={() => void copy()}>
          <Copy size={13} /> {' '}{t("复制")}{' '}</button>
        <button className="btn ghost small" disabled={!result || saved} onClick={() => void saveExcerpt()}>
          <NotebookPen size={13} /> {saved ? t("已存摘录") : t("存为摘录")}
        </button>
        <button className="btn ghost small" onClick={() => onContinueAsk(selection.text, selection.page)}>
          <MessageSquarePlus size={13} /> {' '}{t("继续追问")}{' '}</button>
      </div>
    </aside>
  )
}
