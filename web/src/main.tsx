import { createRoot } from 'react-dom/client'
import { installBrowserApi } from './browserApi'
import '@renderer/polyfills'
import '@renderer/styles.css'
import '@renderer/themes.css'
import '@renderer/ali.css'
import { installUiFontSize } from '@renderer/appearance'
import { installUiLocale } from '@renderer/locale'
import App from '@renderer/App'
import DetachedPanel from '@renderer/DetachedPanel'
import type { ReaderPanelTab } from '@shared/api'
import {
  getLocale,
  localeFromStored,
  localeTag,
  setLocale,
  t
} from '@shared/i18n'

installBrowserApi()
installUiFontSize()

try {
  setLocale(localeFromStored(localStorage.getItem('arbor-locale')))
} catch {
  // Private browsing can disable storage.
}

document.documentElement.lang = localeTag(getLocale())
document.documentElement.dataset.shell = 'web'
document.body.classList.add('arbor-web')
document.title = t('Arbor — 文献阅读与 AI 研究工坊')
installUiLocale('Arbor — 文献阅读与 AI 研究工坊')

const params = new URLSearchParams(window.location.search)
const panelDocId = params.get('panelDoc')
const root = createRoot(document.getElementById('root') as HTMLElement)
if (panelDocId) {
  root.render(
    <DetachedPanel
      docId={panelDocId}
      tab={(params.get('panelTab') as ReaderPanelTab | null) ?? 'agent'}
    />
  )
} else {
  root.render(<App mode="web" />)
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/web-sw.js').catch((error) => {
      console.warn('Arbor Web service worker registration failed', error)
    })
  })
}
