import { useEffect, useRef, useState } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import { normalizeWebUrl } from '@shared/web'

export default function WebImportDialog({ onClose, onImported }: {
  onClose(): void
  onImported(docId: string): Promise<void>
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [canceling, setCanceling] = useState(false)
  const request = useRef<string | null>(null)
  const alive = useRef(true)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    alive.current = true
    input.current?.focus()
    return () => {
      alive.current = false
      if (request.current) void window.api.library.cancelImport(request.current).catch(() => undefined)
    }
  }, [])
  const cancel = async (): Promise<void> => {
    if (!request.current) { onClose(); return }
    if (canceling) return
    setCanceling(true)
    try {
      const result = await window.api.library.cancelImport(request.current)
      if (result.canceled) {
        request.current = null
        onClose()
      }
    } catch (err) { if (alive.current) setError((err as Error).message) }
    finally { if (alive.current) setCanceling(false) }
  }
  const submit = async (): Promise<void> => {
    if (busy) return
    setError('')
    setBusy(true)
    const requestId = crypto.randomUUID()
    request.current = requestId
    try {
      const doc = await window.api.library.importUrl(normalizeWebUrl(url), requestId)
      if (!alive.current || request.current !== requestId) return
      await onImported(doc.id)
    } catch (err) { if (alive.current && request.current === requestId) setError((err as Error).message) }
    finally {
      if (request.current === requestId) request.current = null
      if (alive.current) setBusy(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <form className="modal web-import-dialog" role="dialog" aria-modal="true" aria-label={t('导入网页')}
      onSubmit={(e) => { e.preventDefault(); void submit() }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); void cancel() } }}>
      <div className="modal-head"><h3><Globe size={18} /> {t('导入网页')}</h3></div>
      <div className="web-import-body">
        <label htmlFor="web-import-url">{t('网页地址')}</label>
        <input id="web-import-url" ref={input} className="input" value={url} disabled={busy}
          onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" autoComplete="url" />
        <p className="muted">{t('添加网页地址，直接在原网页中阅读和问答；需要离线使用时可保存包含图片和样式的网页归档。')}</p>
        {error && <p className="web-error" role="alert">{error}</p>}
      </div>
      <div className="modal-foot"><span className="muted">{busy ? t('正在读取网页，请稍候…') : ''}</span><div className="modal-actions">
        <button type="button" className="btn ghost" disabled={canceling} onClick={() => void cancel()}>{t(canceling ? '正在取消…' : busy ? '取消导入' : '取消')}</button>
        <button type="submit" className="btn primary" disabled={busy || !url.trim()}>
          {busy && <Loader2 size={15} className="spin" />}{t('导入网页')}
        </button>
      </div></div>
    </form>
  </div>
}
