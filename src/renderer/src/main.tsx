import './polyfills'
import { createRoot } from 'react-dom/client'
import App from './App'
import DetachedPanel from './DetachedPanel'
import type { ReaderPanelTab } from '@shared/api'
import './styles.css'
import './themes.css'
import './ali.css'
import { getLocale, localeFromStored, localeTag, setLocale, t } from '@shared/i18n'

try {
  setLocale(localeFromStored(window.localStorage.getItem('arbor-locale')))
} catch {
  /* 首次启动时使用简体中文，数据加载后按设置纠正 */
}
document.documentElement.lang = localeTag(getLocale())
document.title = t('Arbor — 文献阅读与 AI 研究工坊')

const params = new URLSearchParams(window.location.search)
const docId = params.get('docId')
const tabParam = params.get('tab')
const tabs: ReaderPanelTab[] = [
  'agent',
  'info',
  'notes',
  'highlights',
  'annotations',
  'outline',
  'excerpts',
  'tasks'
]
const initialTab = tabs.find((tab) => tab === tabParam) ?? 'agent'

createRoot(document.getElementById('root') as HTMLElement).render(
  params.get('panel') === '1' && docId ? <DetachedPanel docId={docId} tab={initialTab} /> : <App />
)
