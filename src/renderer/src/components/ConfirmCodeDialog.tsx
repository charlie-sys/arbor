import { useState } from 'react'
import type { ReactNode } from 'react'
import { t } from '@shared/i18n'
import './batch.css'

interface Props {
  title: string
  description: ReactNode
  confirmLabel: string
  busyLabel?: string
  onClose(): void
  onConfirm(): Promise<void>
}

export default function ConfirmCodeDialog({
  title,
  description,
  confirmLabel,
  busyLabel,
  onClose,
  onConfirm
}: Props): React.JSX.Element {
  const [code] = useState(() =>
    String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
  )
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (input.trim() !== code || busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
    >
      <form
        className="modal batch-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-code-title"
        onSubmit={(event) => void submit(event)}
      >
        <div className="modal-head">
          <h3 id="confirm-code-title">{title}</h3>
        </div>
        <div className="batch-dialog-body">
          <div>{description}</div>
          <label htmlFor="confirm-code-input">
            {t('请输入下方随机数字以确认操作')}
          </label>
          <strong className="batch-delete-code">{code}</strong>
          <input
            id="confirm-code-input"
            className="input"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={input}
            maxLength={6}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
          />
          {error ? <div role="alert" className="web-error">{error}</div> : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
            {t('取消')}
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={busy || input.trim() !== code}
          >
            {busy ? busyLabel ?? t('处理中…') : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
