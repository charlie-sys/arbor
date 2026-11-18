import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, X } from 'lucide-react'
import { t } from '@shared/i18n'
import './settingsList.css'

export const SettingsDialogContext = createContext({
  active: null as string | null,
  open: (_id: string | null): void => {},
  busy: false,
  save: async (): Promise<void> => {}
})

export default function SettingsSection({ id, title, description, children, className = '' }: {
  id: string; title: string; description: string; children: ReactNode; className?: string
}) {
  const context = useContext(SettingsDialogContext)
  const opened = context.active === id
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const latest = useRef(context)
  latest.current = context
  useEffect(() => {
    if (!opened) return
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])].filter(node => node.getClientRects().length)
    focusable()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (!latest.current.busy) latest.current.open(null)
      }
      if (event.key === 'Tab') {
        const items = focusable(), index = items.indexOf(document.activeElement as HTMLElement)
        if (!items.length) { event.preventDefault(); dialog.current?.focus(); return }
        if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus() }
        else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0].focus() }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (trigger.current?.isConnected) trigger.current.focus()
      else if (previous?.isConnected) previous.focus()
    }
  }, [opened])
  return <>
    <button type="button" ref={trigger} className="settings-list-item" data-settings-section={id} aria-haspopup="dialog" aria-expanded={opened} onClick={() => context.open(id)}>
      <span><strong>{t(title)}</strong><small>{t(description)}</small></span><ChevronRight size={20} aria-hidden="true" />
    </button>
    {opened && createPortal(<div className="modal-backdrop settings-dialog-backdrop" data-web-overlay onMouseDown={event => {
      if (event.target === event.currentTarget && !context.busy) context.open(null)
    }}>
      <div className="modal settings-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`settings-${id}-title`} tabIndex={-1}>
        <div className="modal-head"><h2 id={`settings-${id}-title`}>{t(title)}</h2><button type="button" className="icon-btn" aria-label={t('关闭')} disabled={context.busy} onClick={() => context.open(null)}><X size={18} /></button></div>
        <div className={`card settings-section-content ${className}`}>{children}</div>
        <div className="modal-foot">
          {(id === 'models' || id === 'agent') && <button type="button" className="btn primary" disabled={context.busy} onClick={() => void context.save()}>{context.busy ? t('保存中…') : t('保存设置')}</button>}
          <button type="button" className="btn ghost" disabled={context.busy} onClick={() => context.open(null)}>{t('完成')}</button>
        </div>
      </div>
    </div>, document.body)}
  </>
}
