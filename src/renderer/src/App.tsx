import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { LibraryData } from '@shared/types'
import type { TranslateEvent } from '@shared/api'
import type { View } from './nav'
import Sidebar from './components/Sidebar'
import LibraryView from './components/LibraryView'
import ReaderView from './components/ReaderView'
import ChatPage from './components/ChatPage'
import TranslationsView from './components/TranslationsView'
import SettingsView from './components/SettingsView'
import { extractPdf } from './pdf'
import { renderTranslatedImage } from './renderTranslated'

interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
}

export default function App(): React.JSX.Element {
  const [data, setData] = useState<LibraryData | null>(null)
  const [view, setView] = useState<View>({ name: 'library' })
  const [toasts, setToasts] = useState<Toast[]>([])
  const [translateStatus, setTranslateStatus] = useState<TranslateEvent | null>(null)
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null)
  const toastId = useRef(0)

  const notify = useCallback((message: string, kind: 'info' | 'success' | 'error' = 'info') => {
    toastId.current += 1
    const id = toastId.current
    setToasts((prev) => [...prev, { id, message, kind }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, kind === 'error' ? 7000 : 4000)
  }, [])

  const refresh = useCallback(async (): Promise<LibraryData> => {
    const state = await window.api.library.getState()
    setData(state)
    return state
  }, [])

  const onChanged = useCallback(async (): Promise<void> => {
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh().catch((err: Error) => notify(`加载数据失败：${err.message}`, 'error'))
  }, [refresh, notify])

  useEffect(() => {
    const off = window.api.events.onTranslate((event) => {
      if (event.type === 'result' && event.result) {
        setTranslateStatus(null)
        setView({ name: 'translations', selectedId: event.result.id })
        void refresh()
        notify('截图翻译完成', 'success')
        return
      }
      if (event.status === 'canceled') {
        setTranslateStatus(null)
        return
      }
      if (event.status === 'error') {
        setTranslateStatus(null)
        notify(event.message || '截图翻译失败', 'error')
        return
      }
      setTranslateStatus(event)
    })
    return off
  }, [notify, refresh])

  useEffect(() => {
    if (data && view.name === 'reader' && !data.documents.some((doc) => doc.id === view.docId)) {
      setView({ name: 'library' })
    }
  }, [data, view])

  useEffect(() => {
    return window.api.events.onRenderRequest((request) => {
      void (async () => {
        let dataUrl: string | null = null
        try {
          dataUrl = await renderTranslatedImage(request)
        } catch (err) {
          console.warn('渲染译文截图失败', err)
        }
        await window.api.translate.renderResponse(request.requestId, dataUrl).catch(() => undefined)
      })()
    })
  }, [])

  const importPdfs = async (): Promise<void> => {
    if (importing) return
    try {
      const candidates = await window.api.library.pickPdfs()
      if (!candidates.length) return
      setImporting({ done: 0, total: candidates.length })
      let succeeded = 0
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]
        try {
          const doc = await window.api.library.importPdf(candidate.filePath, candidate.title)
          succeeded += 1
          try {
            const extracted = await extractPdf(window.api.library.pdfUrl(doc.id))
            await window.api.library.setText(doc.id, extracted.pages, {
              title: extracted.title,
              authors: extracted.author
            })
            const patch: Record<string, string> = {}
            if (extracted.title && extracted.title.length > 6 && !/microsoft word|untitled|\.docx?$/i.test(extracted.title)) {
              patch.title = extracted.title
            }
            if (extracted.author && !/unknown/i.test(extracted.author)) patch.authors = extracted.author
            if (Object.keys(patch).length) await window.api.library.update(doc.id, patch)
          } catch (err) {
            notify(`《${candidate.title}》文本提取失败：${(err as Error).message}`, 'error')
          }
        } catch (err) {
          notify(`导入《${candidate.title}》失败：${(err as Error).message}`, 'error')
        }
        setImporting({ done: index + 1, total: candidates.length })
      }
      await refresh()
      if (succeeded) notify(`已导入 ${succeeded} 篇文献`, 'success')
    } catch (err) {
      notify(`导入失败：${(err as Error).message}`, 'error')
    } finally {
      setImporting(null)
    }
  }

  const startDocChat = async (docId: string): Promise<void> => {
    try {
      const chat = await window.api.chats.create([docId])
      await refresh()
      setView({ name: 'chats', chatId: chat.id })
    } catch (err) {
      notify(`创建对话失败：${(err as Error).message}`, 'error')
    }
  }

  if (!data) {
    return (
      <div className="splash">
        <div className="brand-mark large">Z</div>
        <Loader2 size={18} className="spin" />
        <span>正在加载文献库…</span>
      </div>
    )
  }

  const activeDoc = view.name === 'reader' ? data.documents.find((doc) => doc.id === view.docId) : undefined
  const translateBusy = ['selecting', 'capturing', 'translating'].includes(translateStatus?.status ?? '')

  return (
    <div className="app-shell">
      <Sidebar
        data={data}
        view={view}
        importing={importing}
        onNavigate={setView}
        onImport={() => void importPdfs()}
        onChanged={onChanged}
        notify={notify}
      />

      <main className="main-area">
        {view.name === 'library' && (
          <LibraryView
            data={data}
            collectionId={view.collectionId}
            importing={importing}
            onOpen={(docId) => setView({ name: 'reader', docId })}
            onChat={startDocChat}
            onImport={() => void importPdfs()}
            onChanged={onChanged}
            onClearCollection={() => setView({ name: 'library' })}
            notify={notify}
          />
        )}

        {view.name === 'reader' && activeDoc && (
          <ReaderView
            key={activeDoc.id}
            doc={activeDoc}
            chats={data.chats}
            collections={data.collections}
            translateBusy={translateBusy}
            onBack={() => setView({ name: 'library' })}
            onChanged={onChanged}
            notify={notify}
          />
        )}

        {view.name === 'chats' && (
          <ChatPage
            data={data}
            initialChatId={view.chatId}
            onChanged={onChanged}
            onOpenDoc={(docId) => setView({ name: 'reader', docId })}
            onOpenSettings={() => setView({ name: 'settings' })}
            notify={notify}
          />
        )}

        {view.name === 'translations' && (
          <TranslationsView
            records={data.translations}
            selectedId={view.selectedId}
            status={translateStatus}
            onChanged={onChanged}
            notify={notify}
          />
        )}

        {view.name === 'settings' && (
          <SettingsView
            settings={data.settings}
            onSaved={(settings) => setData((prev) => (prev ? { ...prev, settings } : prev))}
            notify={notify}
          />
        )}
      </main>

      {translateBusy && view.name !== 'translations' && (
        <div className="global-status">
          <Loader2 size={15} className="spin" />
          {translateStatus?.status === 'selecting' ? '请拖拽选择翻译区域…' : translateStatus?.message || '正在翻译截图…'}
        </div>
      )}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
