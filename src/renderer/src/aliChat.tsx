import './polyfills'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import AliView from './components/AliView'
import './styles.css'
import './themes.css'
import './ali.css'
import { installUiFontSize } from './appearance'
import type { AccountState } from '@shared/account'
import { hasAccountAccess } from '@shared/account'

installUiFontSize()
import { applyTheme, readTheme } from './themes'
import { getLocale, localeFromStored, setLocale, subscribeLocale, t } from '@shared/i18n'
import { installUiLocale } from './locale'

try {
  setLocale(localeFromStored(window.localStorage.getItem('arbor-locale')))
} catch {
  /* use the default locale */
}
applyTheme(readTheme())
installUiLocale('阿栗 — Arbor')

interface Toast {
  message: string
  kind: 'info' | 'success' | 'error'
}

function AliChatWindow(): React.JSX.Element {
  useSyncExternalStore(subscribeLocale, getLocale)
  const [toast, setToast] = useState<Toast | null>(null)
  const [account, setAccount] = useState<AccountState | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    void window.api.account.state().then(setAccount)
    const offChanged = window.api.events.onAccountChanged(setAccount)
    const offReplaced = window.api.events.onSessionReplaced(setAccount)
    return () => {
      offChanged()
      offReplaced()
    }
  }, [])
  const notify = (message: string, kind: 'info' | 'success' | 'error' = 'info'): void => {
    if (timer.current) window.clearTimeout(timer.current)
    setToast({ message, kind })
    timer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 7000 : 4000)
  }

  if (!hasAccountAccess(account)) {
    return (
      <div className="ali-chat-window ali-chat-locked">
        <div className="ali-chat-lock-card">
          <strong>{t('阿栗已锁定')}</strong>
          <p>{t('请先登录 Arbor 账号后再继续聊天。')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ali-chat-window">
      <AliView compact notify={notify} />
      {toast && <div className={`toast ${toast.kind} ali-chat-toast`}>{toast.message}</div>}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<AliChatWindow />)
