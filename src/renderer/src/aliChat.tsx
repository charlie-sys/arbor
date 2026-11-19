import './polyfills'
import { useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import AliView from './components/AliView'
import './styles.css'
import './themes.css'
import './ali.css'
import { installUiFontSize } from './appearance'

installUiFontSize()
import { applyTheme, readTheme } from './themes'
import { getLocale, localeFromStored, setLocale, subscribeLocale } from '@shared/i18n'
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
  const timer = useRef<number | null>(null)
  const notify = (message: string, kind: 'info' | 'success' | 'error' = 'info'): void => {
    if (timer.current) window.clearTimeout(timer.current)
    setToast({ message, kind })
    timer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 7000 : 4000)
  }

  return (
    <div className="ali-chat-window">
      <AliView compact notify={notify} />
      {toast && <div className={`toast ${toast.kind} ali-chat-toast`}>{toast.message}</div>}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<AliChatWindow />)
