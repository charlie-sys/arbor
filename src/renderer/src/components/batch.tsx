import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import './batch.css'

export function useBatchSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const key = ids.join(',')
  useEffect(() => { setSelected(previous => new Set([...previous].filter(id => ids.includes(id)))) }, [key])
  return {
    ids: ids.filter(id => selected.has(id)),
    toggle: (id: string) => setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    }),
    all: () => setSelected(new Set(ids)),
    select: (subset: string[]) => setSelected(previous => new Set([...previous, ...subset.filter(id => ids.includes(id))])),
    unselect: (subset: string[]) => setSelected(previous => new Set([...previous].filter(id => !subset.includes(id)))),
    clear: () => setSelected(new Set())
  }
}

export function BatchDeleteDialog({ titles, kind, onClose, onConfirm }: {
  titles: string[]
  kind: 'documents' | 'chats' | 'ali'
  onClose(): void
  onConfirm(): Promise<void>
}) {
  const [code] = useState(() => String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (input.trim() !== code || busy) return
    setBusy(true)
    setError('')
    try { await onConfirm(); onClose() }
    catch (err) { setError((err as Error).message); setBusy(false) }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <form className="modal batch-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-delete-title" onSubmit={event => void confirm(event)}>
      <div className="modal-head"><h3 id="batch-delete-title">{t('确认批量删除')}</h3></div>
      <div className="batch-dialog-body">
        <p>{t(kind === 'documents' ? '将永久删除所选的 {0} 篇文献及其本地文件、提取文本和标注。此操作不可恢复。' : kind === 'ali' ? '将永久删除所选的 {0} 个阿栗会话及其消息。此操作不可恢复。' : '将永久删除所选的 {0} 个会话及其消息和附件。此操作不可恢复。', [titles.length])}</p>
        {kind === 'ali' && <p className="muted small">{t('阿栗的长期记忆不会随会话删除。')}</p>}
        <ul>{titles.slice(0, 5).map((title, index) => <li key={index}>{title}</li>)}</ul>
        {titles.length > 5 && <p className="muted small">{t('另有 {0} 项', [titles.length - 5])}</p>}
        <label htmlFor="batch-delete-code">{t('请输入下方随机数字以确认删除')}</label>
        <strong className="batch-delete-code" data-testid="batch-delete-challenge">{code}</strong>
        <input id="batch-delete-code" className="input" inputMode="numeric" autoComplete="off" autoFocus value={input} maxLength={6} disabled={busy} onChange={event => setInput(event.target.value)} />
        {error && <div role="alert" className="web-error">{error}</div>}
      </div>
      <div className="modal-foot"><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{t('取消')}</button><button type="submit" className="btn primary" disabled={busy || input.trim() !== code}>{busy ? t('删除中…') : t('确认删除')}</button></div>
    </form>
  </div>
}
