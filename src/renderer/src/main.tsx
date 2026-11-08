import './polyfills'
import { createRoot } from 'react-dom/client'
import App from './App'
import DetachedPanel from './DetachedPanel'
import type { ReaderPanelTab } from '@shared/api'
import './styles.css'
import './themes.css'

const params = new URLSearchParams(window.location.search)
const docId = params.get('docId')
const tabParam = params.get('tab')
const tabs: ReaderPanelTab[] = ['agent', 'info', 'notes', 'highlights', 'outline', 'excerpts', 'tasks']
const initialTab = tabs.find((tab) => tab === tabParam) ?? 'agent'

createRoot(document.getElementById('root') as HTMLElement).render(
  params.get('panel') === '1' && docId ? <DetachedPanel docId={docId} tab={initialTab} /> : <App />
)
