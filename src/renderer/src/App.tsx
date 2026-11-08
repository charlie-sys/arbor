import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { ImportResult, LibraryData, SearchResult } from '@shared/types'
import type { TranslateEvent, UpdateInfo, UpdateProgress } from '@shared/api'
import type { View } from './nav'
import Sidebar from './components/Sidebar'
import LibraryView from './components/LibraryView'
import ReaderView from './components/ReaderView'
import ChatPage from './components/ChatPage'
import AliView from './components/AliView'
import TranslationsView from './components/TranslationsView'
import SettingsView from './components/SettingsView'
import UsageView from './components/UsageView'
import CommandPalette from './components/CommandPalette'
import type { PaletteCommand } from './components/CommandPalette'
import PropertyManager from './components/PropertyManager'
import InboxView, { QuickCapture } from './components/InboxView'
import TopicsView from './components/TopicsView'
import CanvasView from './components/CanvasView'
import ReadingPlanView from './components/ReadingPlanView'
import PaneResizer from './components/PaneResizer'
import { hasUnsavedChanges } from './unsaved'
import { extractPdf } from './pdf'
import { documentFormatOf } from '@shared/documents'
import { renderTranslatedImage } from './renderTranslated'
import { applyTheme, persistTheme, readTheme, themeById } from './themes'
import type { ThemeId } from './themes'
import { reportPetView, startPetActivity } from './petActivity'
import { getLocale, localeTag, setLocale, subscribeLocale, t } from '@shared/i18n'

interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
}

function ViewSlot({ active, children }: { active: boolean; children: ReactNode }): React.JSX.Element {
  return <div className={`view-slot${active ? ' active' : ''}`}>{children}</div>
}

export default function App(): React.JSX.Element {
  const locale = useSyncExternalStore(subscribeLocale, getLocale)
  const [data, setData] = useState<LibraryData | null>(null)
  const [view, setViewState] = useState<View>({ name: 'library' })
  const notifyRef = useRef<(message: string, kind?: 'info' | 'success' | 'error') => void>(() => {})
  const setView = useCallback((next: View | ((prev: View) => View)) => {
    if (hasUnsavedChanges()) {
      notifyRef.current(t("有未保存的修改，请先保存"), 'info')
      return
    }
    setViewState(next)
  }, [])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [translateStatus, setTranslateStatus] = useState<TranslateEvent | null>(null)
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null)
  const [paletteMode, setPaletteMode] = useState<'search' | 'command' | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [sidebarPeek, setSidebarPeek] = useState(false)
  const sidebarHideTimer = useRef<number | null>(null)
  const cancelSidebarHide = (): void => {
    if (sidebarHideTimer.current !== null) {
      window.clearTimeout(sidebarHideTimer.current)
      sidebarHideTimer.current = null
    }
  }
  const showSidebar = (): void => {
    cancelSidebarHide()
    setSidebarPeek(true)
  }
  const scheduleSidebarHide = (): void => {
    cancelSidebarHide()
    sidebarHideTimer.current = window.setTimeout(() => {
      sidebarHideTimer.current = null
      setSidebarPeek(false)
    }, 220)
  }
  useEffect(() => () => cancelSidebarHide(), [])
  const [sidebarRatio, setSidebarRatio] = useState(() => {
    const raw = Number(window.localStorage.getItem('zotagent-sidebar-ratio'))
    return Number.isFinite(raw) && raw > 0 ? raw : 0.15
  })
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const sidebarWidth = Math.min(380, Math.max(200, Math.round(viewportWidth * sidebarRatio)))
  const setSidebarWidth = (value: number): void => {
    const ratio = Math.min(0.3, Math.max(0.1, value / viewportWidth))
    setSidebarRatio(ratio)
    window.localStorage.setItem('zotagent-sidebar-ratio', String(ratio))
  }
  const [readerTranslationId, setReaderTranslationId] = useState<string | null>(null)
  const [lastReaderTranslationId, setLastReaderTranslationId] = useState<string | null>(null)
  const [lastReaderDocId, setLastReaderDocId] = useState<string | null>(null)
  const [lastTopicId, setLastTopicId] = useState<string | undefined>(undefined)
  const [lastCanvasId, setLastCanvasId] = useState<string | undefined>(undefined)
  const [lastTranslationId, setLastTranslationId] = useState<string | undefined>(undefined)
  const [lastLibraryViewId, setLastLibraryViewId] = useState<string | undefined>(undefined)
  const [lastLibraryCollectionId, setLastLibraryCollectionId] = useState<string | undefined>(undefined)
  useEffect(() => {
    setReaderTranslationId(null)
    setLastReaderTranslationId(null)
  }, [lastReaderDocId])
  useEffect(() => {
    if (view.name === 'reader') setLastReaderDocId(view.docId)
    if (view.name === 'topics') setLastTopicId(view.topicId)
    if (view.name === 'canvas') setLastCanvasId(view.canvasId)
    if (view.name === 'translations') setLastTranslationId(view.selectedId)
    if (view.name === 'library') {
      setLastLibraryViewId(view.savedViewId)
      setLastLibraryCollectionId(view.collectionId)
    }
  }, [view])
  const [theme, setTheme] = useState<ThemeId>(readTheme)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateChecking, setUpdateChecking] = useState(true)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const updateNotifiedVersion = useRef('')
  const lastUpdateCheck = useRef(0)
  const lastPetCelebrate = useRef(0)
  const toastId = useRef(0)

  const notify = useCallback((message: string, kind: 'info' | 'success' | 'error' = 'info') => {
    toastId.current += 1
    const id = toastId.current
    setToasts((prev) => [...prev, { id, message, kind }])
    if (kind === 'success' && Date.now() - lastPetCelebrate.current > 12000) {
      lastPetCelebrate.current = Date.now()
      window.api.pet.celebrate()
    }
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, kind === 'error' ? 7000 : 4000)
  }, [])
  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  const checkUpdates = useCallback(
    async (force = false): Promise<UpdateInfo | null> => {
      // 窗口每次获得焦点都会触发，过于频繁的检查会让整个界面重复渲染并卡住输入
      if (!force && Date.now() - lastUpdateCheck.current < 10 * 60 * 1000) return null
      lastUpdateCheck.current = Date.now()
      setUpdateChecking(true)
      try {
        const info = await window.api.updates.check(force)
        setUpdateInfo(info)
        if (info.hasUpdate && updateNotifiedVersion.current !== info.latestVersion) {
          updateNotifiedVersion.current = info.latestVersion
          notify(t("发现新版本 v{0}，可在设置中更新", [info.latestVersion]), 'success')
        }
        return info
      } catch (err) {
        notify(t("检查更新失败：{0}", [(err as Error).message]), 'error')
        return null
      } finally {
        setUpdateChecking(false)
      }
    },
    [notify]
  )

  useEffect(() => {
    void checkUpdates()
    const timer = window.setInterval(() => void checkUpdates(), 30 * 60 * 1000)
    const onFocus = (): void => {
      void checkUpdates()
    }
    const onOnline = (): void => {
      void checkUpdates()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [checkUpdates])

  useEffect(
    () =>
      window.api.events.onUpdateProgress((progress) => {
        setUpdateProgress(progress)
        if (progress.phase === 'ready') setUpdateReady(true)
        if (progress.phase === 'error') setUpdateReady(false)
      }),
    []
  )

  const checkUpdatesManually = useCallback(async (): Promise<void> => {
    const info = await checkUpdates(true)
    if (!info) return
    if (info.error) notify(info.error, 'error')
    else if (!info.hasUpdate) notify(t("当前已是最新版本"), 'success')
  }, [checkUpdates, notify])

  const updateToLatest = useCallback(async (): Promise<void> => {
    if (updateBusy) return
    setUpdateBusy(true)
    try {
      if (!updateReady) {
        const downloaded = await window.api.updates.download()
        if (!downloaded.ok) {
          notify(downloaded.message ?? t("下载更新失败"), 'error')
          return
        }
      }
      const installed = await window.api.updates.install()
      if (!installed.ok) {
        setUpdateReady(true)
        notify(installed.message ?? t("安装已取消"), 'info')
      }
    } catch (err) {
      notify(t("更新失败：{0}", [(err as Error).message]), 'error')
    } finally {
      setUpdateBusy(false)
    }
  }, [updateBusy, updateReady, notify])

  const refresh = useCallback(async (): Promise<LibraryData> => {
    const state = await window.api.library.getState()
    setData(state)
    return state
  }, [])

  const onChanged = useCallback(async (): Promise<void> => {
    await refresh()
    window.api.readerPanel.refresh()
  }, [refresh])

  useEffect(() => {
    return window.api.events.onReaderPanelDataChanged(() => {
      void refresh()
    })
  }, [refresh])

  useEffect(() => {
    void refresh().catch((err: Error) => notify(t("加载数据失败：{0}", [err.message]), 'error'))
  }, [refresh, notify])

  useEffect(() => {
    if (!data) return
    setLocale(data.settings.language)
    window.localStorage.setItem('arbor-locale', data.settings.language)
    setToasts([])
  }, [data?.settings.language])

  useEffect(() => {
    return window.api.events.onSettingsChanged((next) => {
      setData((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...next } } : prev))
    })
  }, [])

  useEffect(() => {
    document.documentElement.lang = localeTag(locale)
    document.title = t('Arbor — 文献阅读与 AI 研究工坊')
  }, [locale])

  useEffect(() => {
    applyTheme(theme)
    persistTheme(theme)
    window.api.pet.setTheme(theme)
  }, [theme])

  useEffect(() => startPetActivity(), [])

  useEffect(() => {
    reportPetView(view.name)
  }, [view.name])

  useEffect(() => {
    return window.api.pet.onOpenSettings(() => setView({ name: 'settings' }))
  }, [setView])

  useEffect(() => {
    return window.api.pet.onOpenAli(() => setView({ name: 'ali' }))
  }, [setView])

  useEffect(() => {
    return window.api.pet.onSettingsChanged((next) => {
      setData((prev) =>
        prev ? { ...prev, settings: { ...prev.settings, petEnabled: next.enabled, petBubbles: next.bubbles } } : prev
      )
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.shiftKey) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setCaptureOpen(true)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        setPaletteMode('search')
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteMode('command')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const off = window.api.events.onTranslate((event) => {
      if (event.type === 'result' && event.result) {
        const result = event.result
        setTranslateStatus(null)
        setReaderTranslationId(result.id)
        setLastReaderTranslationId(result.id)
        setView((prev) =>
          prev.name === 'reader' ? prev : { name: 'translations', selectedId: result.id }
        )
        void refresh()
        notify(t("截图翻译完成"), 'success')
        return
      }
      if (event.status === 'canceled') {
        setTranslateStatus(null)
        return
      }
      if (event.status === 'error') {
        setTranslateStatus(null)
        notify(event.message || t("截图翻译失败"), 'error')
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

  const importDocuments = async (): Promise<void> => {
    if (importing) return
    try {
      const candidates = await window.api.library.pickDocuments()
      if (!candidates.length) return
      setImporting({ done: 0, total: candidates.length })
      let succeeded = 0
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]
        try {
          const doc = await window.api.library.importDocument(candidate.filePath, candidate.title)
          succeeded += 1
          try {
            if (documentFormatOf(doc) === 'pdf') {
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
              if (extracted.journal) patch.journal = extracted.journal
              if (extracted.year) patch.year = extracted.year
              if (extracted.doi) patch.doi = extracted.doi
              if (extracted.abstract) patch.abstract = extracted.abstract
              if (Object.keys(patch).length) await window.api.library.update(doc.id, patch)
            } else {
              const extracted = await window.api.library.extractText(doc.id)
              await window.api.library.setText(doc.id, extracted.pages)
            }
          } catch (err) {
            notify(t("《{0}》文本提取失败：{1}", [candidate.title, (err as Error).message]), 'error')
          }
        } catch (err) {
          notify(t("导入《{0}》失败：{1}", [candidate.title, (err as Error).message]), 'error')
        }
        setImporting({ done: index + 1, total: candidates.length })
      }
      await refresh()
      if (succeeded) notify(t("已导入 {0} 篇文献", [succeeded]), 'success')
    } catch (err) {
      notify(t("导入失败：{0}", [(err as Error).message]), 'error')
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
      notify(t("创建对话失败：{0}", [(err as Error).message]), 'error')
    }
  }

  if (!data) {
    return (
      <div className="splash">
        <img className="brand-mark-img large" src="./arbor-logo.svg" alt="Arbor" />
        <Loader2 size={18} className="spin" />
        <span>{t("正在加载文献库…")}</span>
      </div>
    )
  }

  const activeDoc = view.name === 'reader' ? data.documents.find((doc) => doc.id === view.docId) : undefined
  const readerDoc = data.documents.find(
    (doc) => doc.id === (view.name === 'reader' ? view.docId : lastReaderDocId)
  )
  const translateBusy = ['selecting', 'capturing', 'translating'].includes(translateStatus?.status ?? '')

  const openSearchResult = (result: SearchResult, locate: boolean): void => {
    if (result.type === 'collection' && result.collectionId) {
      setView({ name: 'library', collectionId: result.collectionId })
      return
    }
    if ((result.type === 'chat' || result.type === 'message') && result.chatId) {
      setView({ name: 'chats', chatId: result.chatId })
      return
    }
    if (result.docMissing) {
      notify(t("来源文献已删除，无法跳转"), 'error')
      return
    }
    if (result.docId) {
      setView({ name: 'reader', docId: result.docId, page: locate ? result.page : undefined })
      return
    }
    notify(t("该结果暂无可打开的目标"), 'error')
  }

  const createCollection = async (name: string): Promise<void> => {
    const collection = await window.api.collections.add(name)
    await refresh()
    setView({ name: 'library', collectionId: collection.id })
    notify(t("已创建分类「{0}」", [name]), 'success')
  }

  const newChat = async (): Promise<void> => {
    const chat = await window.api.chats.create(activeDoc ? [activeDoc.id] : [])
    await refresh()
    setView({ name: 'chats', chatId: chat.id })
  }

  const exportCurrentDocument = async (): Promise<void> => {
    if (view.name !== 'reader' || !activeDoc) {
      notify(t("请先在阅读器中打开一篇文献"), 'info')
      return
    }
    const meta = [activeDoc.authors, activeDoc.year, activeDoc.journal].filter(Boolean).join(' · ')
    const statusText = activeDoc.readingStatus === 'read' ? t("已读") : activeDoc.readingStatus === 'reading' ? t("在读") : t("未读")
    const markdown = [
      `# ${activeDoc.title}`,
      '',
      meta ? `> ${meta}` : '',
      '',
      t("## 摘要"),
      activeDoc.abstract.trim() || t("（无摘要）"),
      '',
      t("## 我的笔记"),
      activeDoc.notes.trim() || t("（无笔记）"),
      '',
      t("## 阅读信息"),
      t("- 阅读状态：{0}", [statusText]),
      t("- 当前页码：{0} / {1}", [activeDoc.lastPage || 1, activeDoc.pageCount || '未知']),
      activeDoc.doi ? t('- DOI：{0}', [activeDoc.doi]) : ''
    ]
      .filter((line) => line !== undefined)
      .join('\n')
    try {
      const result = await window.api.documents.exportMarkdown(activeDoc.title, markdown, 'md')
      if (!result.canceled && result.filePath) notify(t("已导出：{0}", [result.filePath]), 'success')
    } catch (err) {
      notify(t("导出失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const runImport = async (task: () => Promise<ImportResult>, label: string): Promise<void> => {
    try {
      const result = await task()
      if (result.canceled) return
      await refresh()
      const summary = result.summary
      notify(
        summary
          ? t("{0}导入完成：新增文献 {1}，合并 {2}，新增摘录 {3}，跳过 {4}", [label, summary.documentsAdded, summary.documentsMerged, summary.excerptsAdded, summary.skipped])
          : t("{0}导入完成", [label]),
        'success'
      )
    } catch (err) {
      notify(t("{0}导入失败：{1}", [label, (err as Error).message]), 'error')
    }
  }

  const runExport = async (
    task: () => Promise<{ canceled: boolean; filePath?: string }>,
    label: string
  ): Promise<void> => {
    try {
      const result = await task()
      if (!result.canceled && result.filePath) notify(t("已导出{0}：{1}", [label, result.filePath]), 'success')
    } catch (err) {
      notify(t("导出失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const commands: PaletteCommand[] = [
    { id: 'capture', label: t("快速收集灵感"), hint: t("Ctrl+N，记录想法、链接或待办"), keywords: 'inbox 灵感 收集 捕获 capture 待办 todo', run: () => setCaptureOpen(true) },
    { id: 'inbox', label: t("打开灵感收集"), hint: t("查看收集内容与 AI 归类建议"), keywords: 'inbox 收件箱 灵感收集', run: () => setView({ name: 'inbox' }) },
    { id: 'topics', label: t("打开研究主题"), hint: t("聚合成员文献、摘录、建议问题与主题对话"), keywords: 'topics 研究主题 主题空间', run: () => setView({ name: 'topics' }) },
    { id: 'canvas', label: t("打开主题画布"), hint: t("文献、摘录、问答卡片与连线的无限画布"), keywords: 'canvas 画布 主题 白板', run: () => setView({ name: 'canvas' }) },
    { id: 'reading-plan', label: t("打开主题阅读计划"), hint: t("按学习目标生成文献阅读顺序与问题清单"), keywords: 'reading plan 阅读计划 学习目标', run: () => setView({ name: 'readingPlan' }) },
    { id: 'import', label: t("导入文献"), hint: t("选择 PDF、Word、Markdown 或 TXT 加入文献库"), keywords: '导入 import pdf word docx markdown txt', run: () => importDocuments() },
    {
      id: 'import-bibtex',
      label: t("导入 BibTeX（Zotero 导出）"),
      hint: t("读取 .bib 文献元数据，按 DOI/标题合并已有文献"),
      keywords: '导入 import bibtex zotero 文献',
      run: () => runImport(() => window.api.imports.bibtex(), 'BibTeX')
    },
    {
      id: 'import-readwise',
      label: t("导入 Readwise 高亮"),
      hint: t("读取 Readwise JSON 高亮，按书名关联已有文献"),
      keywords: '导入 import readwise 高亮 highlight',
      run: () => runImport(() => window.api.imports.readwise(), 'Readwise')
    },
    { id: 'new-chat', label: t("新建对话"), hint: activeDoc ? t("围绕《{0}》提问", [activeDoc.title]) : t("创建空白对话"), keywords: '对话 chat new', run: () => newChat() },
    { id: 'ali', label: t("和阿栗聊天"), hint: t("陪伴聊天、记住偏好、解答 Arbor 使用问题"), keywords: '阿栗 ali 陪伴 助手 chat', run: () => setView({ name: 'ali' }) },
    { id: 'new-collection', label: t("新建分类"), hint: t("为文献创建新的分类"), keywords: '分类 collection folder', run: () => undefined },
    { id: 'properties', label: t("属性管理"), hint: t("新建文献属性（文本/数字/单选/多选/日期/复选框/URL）"), keywords: '属性 property 字段 自定义', run: () => setPropertiesOpen(true) },
    { id: 'translate', label: t("截图翻译"), hint: t("Ctrl+Shift+T，框选区域翻译"), keywords: '翻译 translate ocr', run: () => window.api.translate.start().then((res) => !res.ok && notify(res.reason || t("截图翻译不可用"), 'error')) },
    { id: 'settings', label: t("打开设置"), hint: t("配置模型、API Key 与数据目录"), keywords: '设置 settings', run: () => setView({ name: 'settings' }) },
    { id: 'usage', label: t("用量仪表盘"), hint: t("查看输入 / 输出 Token、缓存命中率与调用趋势"), keywords: '用量 usage token 缓存 命中 统计 仪表盘 图表', run: () => setView({ name: 'usage' }) },
    {
      id: 'pet',
      label: data.settings.petEnabled ? t("让阿栗休息") : t("唤回阿栗"),
      hint: t("桌面哈士奇会感知打字、阅读、思考与摸鱼"),
      keywords: '宠物 pet 哈士奇 阿栗 伙伴 桌面 桌面宠物',
      run: () => {
        void (async () => {
          try {
            const next = await window.api.pet.setEnabled(!data.settings.petEnabled)
            setData((prev) =>
              prev
                ? { ...prev, settings: { ...prev.settings, petEnabled: next.enabled, petBubbles: next.bubbles } }
                : prev
            )
            notify(next.enabled ? t("阿栗回来啦") : t("阿栗先去休息了"), 'success')
          } catch (err) {
            notify(t("切换宠物失败：{0}", [(err as Error).message]), 'error')
          }
        })()
      }
    },
    {
      id: 'pet-reset',
      label: t("重置阿栗的位置"),
      hint: t("把桌面宠物放回屏幕右下角"),
      keywords: '宠物 pet 阿栗 位置 重置 归位',
      run: () => void window.api.pet.window.reset()
    },
    {
      id: 'theme',
      label: t("切换主题"),
      hint: t("当前：{0} · {1}", [t(themeById(theme).name), themeById(theme).latin]),
      keywords: '主题 切换主题 theme 外观 skin 配色 暖砂 澄蓝 柔光 暖夜 深空',
      run: () => undefined
    },
    {
      id: 'export',
      label: t("导出当前文档"),
      hint: activeDoc ? t("导出《{0}》的摘要与笔记", [activeDoc.title]) : t("仅在阅读器中可用"),
      keywords: '导出 export markdown',
      disabled: !activeDoc,
      run: () => exportCurrentDocument()
    },
    {
      id: 'export-library-md',
      label: t("导出整库 Markdown"),
      hint: t("文献元数据、笔记、摘录与对话汇总为一个 Markdown 文件"),
      keywords: '导出 export library 整库 markdown',
      run: () => runExport(() => window.api.documents.exportLibrary('md'), t("整库 Markdown"))
    },
    {
      id: 'export-library-zip',
      label: t("导出整库 ZIP"),
      hint: t("Markdown 汇总 + BibTeX 打包为 ZIP"),
      keywords: '导出 export library 整库 zip',
      run: () => runExport(() => window.api.documents.exportLibrary('zip'), t("整库 ZIP"))
    },
    {
      id: 'export-bibtex',
      label: t("导出 BibTeX"),
      hint: t("按文献元数据生成 .bib 文件"),
      keywords: '导出 export bibtex 参考文献 citation',
      run: () => runExport(() => window.api.documents.exportBibtex(), 'BibTeX')
    },
    {
      id: 'export-package',
      label: t("导出单篇文献包"),
      hint: activeDoc ? t("打包《{0}》的 PDF、笔记、摘录与对话", [activeDoc.title]) : t("仅在阅读器中可用"),
      keywords: '导出 export package 文献包 zip',
      disabled: !activeDoc,
      run: () => (activeDoc ? runExport(() => window.api.documents.exportPackage(activeDoc.id), t("文献包")) : undefined)
    }
  ]

  return (
    <div className="app-shell">
      <div className="sidebar-edge" title={t("移动到左侧显示侧栏")} onMouseEnter={showSidebar} />
      {sidebarPeek && (
        <>
          <div className="sidebar-backdrop" />
          <div
            className="sidebar-host drawer"
            style={{ width: sidebarWidth }}
            onMouseEnter={cancelSidebarHide}
            onMouseLeave={scheduleSidebarHide}
          >
            <Sidebar
              data={data}
              view={view}
              importing={importing}
              onNavigate={setView}
              onImport={() => void importDocuments()}
              onChanged={onChanged}
              notify={notify}
            />
            <div className="sidebar-drawer-resizer">
              <PaneResizer
                value={sidebarWidth}
                onChange={setSidebarWidth}
                min={200}
                max={380}
                label={t("调整侧栏宽度")}
              />
            </div>
          </div>
        </>
      )}

      <main className="main-area">
        <ViewSlot active={view.name === 'library'}>
          <LibraryView
            key={(view.name === 'library' ? view.savedViewId : lastLibraryViewId) ?? 'library'}
            data={data}
            collectionId={view.name === 'library' ? view.collectionId : lastLibraryCollectionId}
            savedViewId={view.name === 'library' ? view.savedViewId : lastLibraryViewId}
            importing={importing}
            onOpen={(docId) => setView({ name: 'reader', docId })}
            onChat={startDocChat}
            onImport={() => void importDocuments()}
            onChanged={onChanged}
            onClearCollection={() => setView({ name: 'library' })}
            onSelectCollection={(collectionId) => setView({ name: 'library', collectionId })}
            onManageProperties={() => setPropertiesOpen(true)}
            updateInfo={updateInfo}
            updateChecking={updateChecking}
            onOpenUpdate={() => setView({ name: 'settings' })}
            notify={notify}
          />
        </ViewSlot>

        {readerDoc && (
          <ViewSlot active={view.name === 'reader'}>
            <ReaderView
              key={readerDoc.id}
              doc={readerDoc}
              documents={data.documents}
              chats={data.chats}
              collections={data.collections}
              highlights={data.highlights}
              excerpts={data.excerpts}
              tasks={data.tasks}
              initialPage={view.name === 'reader' ? view.page : undefined}
              translateBusy={translateBusy}
              translation={data.translations.find((item) => item.id === readerTranslationId) ?? null}
              hasTranslation={
                Boolean(lastReaderTranslationId) &&
                data.translations.some((item) => item.id === lastReaderTranslationId)
              }
              onCloseTranslation={() => setReaderTranslationId(null)}
              onRestoreTranslation={() => {
                if (lastReaderTranslationId) setReaderTranslationId(lastReaderTranslationId)
              }}
              onOpenTranslations={() => {
                if (readerTranslationId) setView({ name: 'translations', selectedId: readerTranslationId })
              }}
              onBack={() => setView({ name: 'library' })}
              onChanged={onChanged}
              onOpenDoc={(docId, page) => setView({ name: 'reader', docId, page })}
              notify={notify}
            />
          </ViewSlot>
        )}

        <ViewSlot active={view.name === 'chats'}>
          <ChatPage
            data={data}
            visible={view.name === 'chats'}
            initialChatId={view.name === 'chats' ? view.chatId : undefined}
            initialQuestion={view.name === 'chats' ? view.question : undefined}
            onChanged={onChanged}
            onOpenDoc={(docId, page) => setView({ name: 'reader', docId, page })}
            onOpenSettings={() => setView({ name: 'settings' })}
            notify={notify}
          />
        </ViewSlot>

        <ViewSlot active={view.name === 'ali'}>
          <AliView visible={view.name === 'ali'} notify={notify} />
        </ViewSlot>

        <ViewSlot active={view.name === 'topics'}>
          <TopicsView
            data={data}
            topicId={view.name === 'topics' ? view.topicId : lastTopicId}
            onSelectTopic={(topicId) => setView({ name: 'topics', topicId })}
            onOpenChat={(chatId, question) => setView({ name: 'chats', chatId, question })}
            onOpenDoc={(docId, page) => setView({ name: 'reader', docId, page })}
            onChanged={onChanged}
            notify={notify}
          />
        </ViewSlot>

        <ViewSlot active={view.name === 'canvas'}>
          <CanvasView
            key={(view.name === 'canvas' ? view.canvasId : lastCanvasId) ?? 'canvas'}
            data={data}
            canvasId={view.name === 'canvas' ? view.canvasId : lastCanvasId}
            onSelectCanvas={(canvasId) => setView({ name: 'canvas', canvasId })}
            onOpenDoc={(docId, page) => setView({ name: 'reader', docId, page })}
            onChanged={onChanged}
            notify={notify}
          />
        </ViewSlot>

        <ViewSlot active={view.name === 'readingPlan'}>
          <ReadingPlanView
            documents={data.documents}
            onOpenDoc={(docId) => setView({ name: 'reader', docId })}
            notify={notify}
          />
        </ViewSlot>

        <ViewSlot active={view.name === 'inbox'}>
          <InboxView
            items={data.inbox}
            onCapture={() => setCaptureOpen(true)}
            onChanged={onChanged}
            notify={notify}
          />
        </ViewSlot>

        <ViewSlot active={view.name === 'translations'}>
          <TranslationsView
            records={data.translations}
            selectedId={view.name === 'translations' ? view.selectedId : lastTranslationId}
            status={translateStatus}
            onChanged={onChanged}
            notify={notify}
          />
        </ViewSlot>

        <ViewSlot active={view.name === 'usage'}>
          <UsageView notify={notify} />
        </ViewSlot>

        <ViewSlot active={view.name === 'settings'}>
          <SettingsView
            settings={data.settings}
            onSaved={(settings) => setData((prev) => (prev ? { ...prev, settings } : prev))}
            updateInfo={updateInfo}
            updateBusy={updateBusy}
            updateProgress={updateProgress}
            updateReady={updateReady}
            onCheckUpdate={checkUpdatesManually}
            onUpdate={updateToLatest}
            notify={notify}
          />
        </ViewSlot>
      </main>

      {paletteMode && (
        <CommandPalette
          mode={paletteMode}
          commands={commands}
          themeId={theme}
          onSelectTheme={setTheme}
          onClose={() => setPaletteMode(null)}
          onOpenResult={openSearchResult}
          onCreateCollection={createCollection}
          notify={notify}
        />
      )}

      {captureOpen && (
        <QuickCapture onClose={() => setCaptureOpen(false)} onSaved={refresh} notify={notify} />
      )}

      {propertiesOpen && data && (
        <PropertyManager
          properties={data.properties}
          onClose={() => setPropertiesOpen(false)}
          onChanged={onChanged}
          notify={notify}
        />
      )}

      {translateBusy && view.name !== 'translations' && (
        <div className="global-status">
          <Loader2 size={15} className="spin" />
          {translateStatus?.status === 'selecting' ? t("请拖拽选择翻译区域…") : translateStatus?.message || t("正在翻译截图…")}
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
