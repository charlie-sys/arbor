import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'

interface Props {
  title: string
  initialValue: string
  placeholder?: string
  confirmLabel?: string
  onCancel(): void
  onConfirm(value: string): void
}

export default function CanvasNameDialog({
  title,
  initialValue,
  placeholder,
  confirmLabel = t("确定"),
  onCancel,
  onConfirm
}: Props): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  const submit = (): void => {
    const name = value.trim()
    if (name) onConfirm(name)
  }

  return (
    <div
      className="modal-backdrop"
      data-canvas-dialog
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: 380 }}>
        <div className="modal-head">
          <h3>{title}</h3>
        </div>
        <div style={{ padding: '16px 24px' }}>
          <input
            ref={inputRef}
            className="input"
            data-canvas-dialog-input
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onCancel()
              }
            }}
          />
        </div>
        <div className="modal-foot">
          <div />
          <div className="modal-actions">
            <button className="btn ghost" data-canvas-dialog-cancel onClick={onCancel}>
              {' '}{t("取消")}{' '}</button>
            <button className="btn primary" data-canvas-dialog-confirm onClick={submit} disabled={!value.trim()}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
