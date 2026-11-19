import { useEffect, useRef, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  Cloud,
  CloudOff,
  FileText,
  Globe,
  Inbox,
  Layers,
  Loader2,
  Menu,
  MessagesSquare,
  PenTool,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Wrench,
  X
} from 'lucide-react'
import type { AccountState } from '@shared/account'
import type { SyncStatus } from '@shared/sync'
import type { LibraryData, ReadingStatus } from '@shared/types'
import type { View } from '../nav'
import { cx } from '../ui'
import { t } from '@shared/i18n'
import AccountView from './AccountView'
import CollectionTree from './CollectionTree'
import FolderEditor from './FolderEditor'
import '../webShell.css'

interface Notify {
  (message: string, kind?: 'info' | 'success' | 'error'): void
}

function inboxUnread(data: LibraryData): number {
  return data.inbox.filter((item) => !item.archived).length
}

function sectionOf(view: View): string {
  if (view.name === 'library') return 'library'
  if (view.name === 'reader') return 'reader'
  if (view.name === 'chats') return 'chats'
  if (view.name === 'inbox') return 'inbox'
  if (view.name === 'ali') return 'ali'
  if (view.name === 'settings') return 'settings'
  if (view.name === 'translations' || view.name === 'usage') return 'tools'
  if (view.name === 'topics' || view.name === 'canvas' || view.name === 'readingPlan') return 'topics'
  return ''
}

function userInitial(account: AccountState | null): string {
  const name = account?.user?.displayName || account?.user?.email || 'A'
  return name.trim().slice(0, 1).toUpperCase()
}

export function WebRail({
  view,
  data,
  account,
  desktop = false,
  lastReaderDocId,
  onNavigate,
  onSearch,
  onSettings,
  onNewWindow,
  notify
}: {
  view: View
  data: LibraryData
  account: AccountState | null
  desktop?: boolean
  lastReaderDocId: string | null
  onNavigate(next: View): void
  onSearch(): void
  onSettings(): void
  onNewWindow?(): void
  notify: Notify
}): React.JSX.Element {
  const [toolsOpen, setToolsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const active = sectionOf(view)

  useEffect(() => {
    if (!toolsOpen) return
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setToolsOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [toolsOpen])

  const go = (next: View): void => {
    setToolsOpen(false)
    onNavigate(next)
  }

  const openReader = (): void => {
    if (lastReaderDocId) onNavigate({ name: 'reader', docId: lastReaderDocId })
    else notify(t('先从文献库打开一篇文献'), 'info')
  }

  return (
    <aside className="web-rail" aria-label={t('全局导航')}>
      <button className="web-rail-logo" title="Arbor" onClick={() => onNavigate({ name: 'library' })}>
        <img src="./arbor-logo.svg" alt="Arbor" />
      </button>
      <button className={cx('web-rail-item', active === 'library' && 'active')} onClick={() => onNavigate({ name: 'library' })}>
        <BookOpen size={19} />
        <span>{t('文献')}</span>
      </button>
      <button className={cx('web-rail-item', active === 'reader' && 'active')} onClick={openReader}>
        <FileText size={19} />
        <span>{t('阅读')}</span>
      </button>
      <button className={cx('web-rail-item', active === 'chats' && 'active')} onClick={() => onNavigate({ name: 'chats' })}>
        <MessagesSquare size={19} />
        <span>{t('对话')}</span>
        <i className="web-rail-count">{data.chats.length}</i>
      </button>
      <button className={cx('web-rail-item', active === 'topics' && 'active')} onClick={() => onNavigate({ name: 'topics' })}>
        <Layers size={19} />
        <span>{t('主题')}</span>
        <i className="web-rail-count">{data.researchTopics.length}</i>
      </button>
      <button className={cx('web-rail-item', active === 'inbox' && 'active')} onClick={() => onNavigate({ name: 'inbox' })}>
        <Inbox size={19} />
        <span>{t('收集')}</span>
        {inboxUnread(data) > 0 && <i className="web-rail-count">{inboxUnread(data)}</i>}
      </button>
      <div className="web-rail-spacer" />
      <button className={cx('web-rail-item', active === 'ali' && 'active')} onClick={() => onNavigate({ name: 'ali' })}>
        <Sparkles size={19} />
        <span>{t('阿栗')}</span>
      </button>
      <div className="web-rail-tools" ref={menuRef}>
        <button
          className={cx('web-rail-item', active === 'tools' && 'active')}
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((open) => !open)}
        >
          <Wrench size={19} />
          <span>{t('工具')}</span>
        </button>
        {toolsOpen && (
          <div className="web-rail-menu" role="menu">
            {desktop && (
              <button role="menuitem" onClick={() => { setToolsOpen(false); onNewWindow?.() }}>
                <Plus size={15} />{t('新建窗口')}<span className="kbd">Ctrl+Shift+N</span>
              </button>
            )}
            <button role="menuitem" onClick={() => go({ name: 'canvas' })}><PenTool size={15} />{t('主题画布')}</button>
            <button role="menuitem" onClick={() => go({ name: 'readingPlan' })}><Layers size={15} />{t('阅读计划')}</button>
            <button role="menuitem" onClick={() => go({ name: 'translations' })}><ScanLine size={15} />{t('截图翻译')}</button>
            <button role="menuitem" onClick={() => go({ name: 'usage' })}><BarChart3 size={15} />{t('用量仪表盘')}</button>
            <button role="menuitem" onClick={() => { setToolsOpen(false); onSearch() }}><Search size={15} />{t('全局搜索')}<span className="kbd">⌘O</span></button>
          </div>
        )}
      </div>
      <button className={cx('web-rail-item', active === 'settings' && 'active')} onClick={onSettings}>
        <Settings size={19} />
        <span>{t('设置')}</span>
      </button>
      <div className="web-rail-spacer small" />
      <button className="web-rail-avatar" title={t('账户与同步')} onClick={onSettings}>
        <span>{userInitial(account)}</span>
      </button>
    </aside>
  )
}

export function WebContextPanel({
  data,
  view,
  open,
  desktop = false,
  importing = null,
  onClose,
  onNavigate,
  onImport,
  onImportWeb,
  onChanged,
  notify
}: {
  data: LibraryData
  view: View
  open: boolean
  desktop?: boolean
  importing?: { done: number; total: number } | null
  onClose(): void
  onNavigate(next: View): void
  onImport(collectionId?: string): void
  onImportWeb(collectionId?: string): void
  onChanged(): Promise<void> | void
  notify: Notify
}): React.JSX.Element {
  const [folderEditor, setFolderEditor] = useState(false)
  const activeCollection = view.name === 'library' ? view.collectionId : undefined
  const activeStatus = view.name === 'library' ? view.status : undefined
  const activeStarred = view.name === 'library' ? Boolean(view.starred) : false
  const activeSavedView = view.name === 'library' ? view.savedViewId : undefined
  const allActive = !activeCollection && !activeStatus && !activeStarred && !activeSavedView

  const quick = (status?: ReadingStatus, starred = false): void => {
    onNavigate({ name: 'library', collectionId: activeCollection, status, starred: starred || undefined })
    onClose()
  }

  const removeSavedView = async (id: string, title: string): Promise<void> => {
    if (!window.confirm(t('删除保存视图「{0}」？', [title]))) return
    try {
      await window.api.views.remove(id)
      await onChanged()
      if (activeSavedView === id) onNavigate({ name: 'library' })
    } catch (err) {
      notify(t('删除失败：{0}', [(err as Error).message]), 'error')
    }
  }

  return (
    <>
      <aside className={cx('web-context', open && 'open')} aria-label={t('文献库分区栏')}>
        <div className="web-context-head">
          <div>
            <h1 className="web-context-title">{t('文献库')}</h1>
            <p className="web-context-sub">{t('共')} {data.documents.length} {t('篇文献')} · {data.collections.length} {t('个文件夹')}</p>
          </div>
          <button className="web-context-close" onClick={onClose} title={t('关闭目录')}><X size={17} /></button>
        </div>

        <div className="web-context-actions">
          <button className="btn primary web-import-btn" disabled={!!importing} onClick={() => { onImport(activeCollection); onClose() }}>
            {importing ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
            {importing ? t('导入中 {0}/{1}', [importing.done, importing.total]) : t('导入文献')}
          </button>
          <button className="btn web-context-icon-btn" title={t('导入网页')} onClick={() => { onImportWeb(activeCollection); onClose() }}>
            <Globe size={15} />
          </button>
        </div>

        <div className="web-context-section">{t('智能视图')}</div>
        <div className="web-context-nav">
          <button className={cx('web-context-link', allActive && 'active')} onClick={() => { onNavigate({ name: 'library' }); onClose() }}>
            <BookOpen size={15} />{t('全部文献')}<span>{data.documents.length}</span>
          </button>
          <button className={cx('web-context-link', activeStatus === 'reading' && 'active')} onClick={() => quick('reading')}>
            <FileText size={15} />{t('在读')}<span>{data.documents.filter((doc) => doc.readingStatus === 'reading').length}</span>
          </button>
          <button className={cx('web-context-link', activeStatus === 'unread' && 'active')} onClick={() => quick('unread')}>
            <Cloud size={15} />{t('未读')}<span>{data.documents.filter((doc) => (doc.readingStatus ?? 'unread') === 'unread').length}</span>
          </button>
          <button className={cx('web-context-link', activeStarred && 'active')} onClick={() => quick(undefined, true)}>
            <Sparkles size={15} />{t('星标')}<span>{data.documents.filter((doc) => doc.starred).length}</span>
          </button>
        </div>

        <div className="web-context-section">
          <span>{t('文件夹')}</span>
          <button className="web-context-mini" title={t('新建文件夹')} onClick={() => setFolderEditor(true)}><Plus size={13} /></button>
        </div>
        <div className="web-context-tree">
          <CollectionTree
            collections={data.collections}
            documents={data.documents}
            activeId={activeCollection}
            onNavigate={(id) => { onNavigate({ name: 'library', collectionId: id }); onClose() }}
            onChanged={onChanged}
            onActiveRemoved={(id) => {
              if (activeCollection === id) onNavigate({ name: 'library' })
            }}
            notify={notify}
          />
          {!data.collections.length && <div className="web-context-empty">{t('点击 + 新建文件夹，可继续创建子文件夹')}</div>}
        </div>

        <div className="web-context-section">{t('保存视图')}</div>
        <div className="web-context-nav">
          {data.savedViews.length === 0 && <div className="web-context-empty">{t('在文献库中保存当前筛选与排序')}</div>}
          {data.savedViews.map((saved) => (
            <div
              key={saved.id}
              className={cx('web-context-link web-saved-view', activeSavedView === saved.id && 'active')}
              role="button"
              tabIndex={0}
              onClick={() => { onNavigate({ name: 'library', savedViewId: saved.id }); onClose() }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onNavigate({ name: 'library', savedViewId: saved.id })
                  onClose()
                }
              }}
            >
              <Search size={14} />
              <span className="web-saved-name">{saved.name}</span>
              <button
                className="web-saved-delete"
                title={t('删除保存视图')}
                onClick={(event) => { event.stopPropagation(); void removeSavedView(saved.id, saved.name) }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="web-context-foot">
          {desktop ? t('数据保存在本机，模型调用使用你配置的 API') : t('数据保存在此浏览器，登录后与云端合并')}。
        </div>
      </aside>
      {open && <div className="web-context-backdrop" onClick={onClose} />}
      {folderEditor && (
        <FolderEditor
          collections={data.collections}
          parentId={activeCollection}
          onClose={() => setFolderEditor(false)}
          onChanged={onChanged}
        />
      )}
    </>
  )
}

export function WebTopbar({
  view,
  data,
  account,
  syncStatus,
  onSearch,
  onSettings,
  onToggleContext,
  contextOpen,
  showContextToggle
}: {
  view: View
  data: LibraryData
  account: AccountState | null
  syncStatus: SyncStatus | null
  onSearch(): void
  onSettings(): void
  onToggleContext(): void
  contextOpen: boolean
  showContextToggle: boolean
}): React.JSX.Element {
  const label = ((): string => {
    if (view.name === 'library') {
      if (view.savedViewId) return data.savedViews.find((item) => item.id === view.savedViewId)?.name ?? t('保存视图')
      if (view.collectionId) return data.collections.find((item) => item.id === view.collectionId)?.name ?? t('文献库')
      if (view.status === 'reading') return t('在读')
      if (view.status === 'unread') return t('未读')
      if (view.starred) return t('星标')
      return t('全部文献')
    }
    if (view.name === 'reader') return t('阅读')
    if (view.name === 'chats') return t('AI 对话')
    if (view.name === 'ali') return t('阿栗')
    if (view.name === 'topics') return t('研究主题')
    if (view.name === 'canvas') return t('主题画布')
    if (view.name === 'readingPlan') return t('主题阅读计划')
    if (view.name === 'inbox') return t('灵感收集')
    if (view.name === 'translations') return t('截图翻译')
    if (view.name === 'usage') return t('用量仪表盘')
    return t('设置')
  })()

  const syncLabel = !syncStatus
    ? t('准备同步')
    : syncStatus.status === 'syncing'
      ? t('同步中')
      : syncStatus.status === 'error'
        ? t('同步异常')
        : syncStatus.status === 'signedOut'
          ? t('未登录')
          : syncStatus.pending > 0
            ? t('待同步 {0}', [syncStatus.pending])
            : t('已同步')
  const syncKind = !syncStatus || syncStatus.status === 'syncing'
    ? 'pending'
    : syncStatus.status === 'error'
      ? 'error'
      : syncStatus.status === 'signedOut'
        ? 'offline'
        : 'ok'

  return (
    <header className="web-topbar">
      {showContextToggle && (
        <button
          className={cx('web-context-toggle', contextOpen && 'active')}
          onClick={onToggleContext}
          title={t('显示或隐藏文件夹目录')}
          aria-expanded={contextOpen}
        >
          <Menu size={16} />
          <span>{t('目录')}</span>
        </button>
      )}
      <div className="web-breadcrumb">
        <span>{t('Arbor')}</span>
        <span className="sep">/</span>
        <strong>{label}</strong>
      </div>
      <button className="web-search-trigger" onClick={onSearch}>
        <Search size={15} />
        <span className="web-search-label">{t('搜索文献、摘录或提问…')}</span>
        <span className="kbd">⌘K</span>
      </button>
      <button className={cx('web-sync-pill', syncKind)} onClick={onSettings} title={t('账户与同步')}>
        {syncKind === 'error' ? <CloudOff size={13} /> : syncKind === 'pending' ? <Loader2 size={13} className="spin" /> : <Cloud size={13} />}
        <span>{syncLabel}</span>
      </button>
      <button className="web-top-avatar" onClick={onSettings} title={t('账户与同步')}>
        {userInitial(account)}
      </button>
    </header>
  )
}

export function WebMobileNav({
  view,
  lastReaderDocId,
  onNavigate,
  onSettings,
  notify
}: {
  view: View
  lastReaderDocId: string | null
  onNavigate(next: View): void
  onSettings(): void
  notify: Notify
}): React.JSX.Element {
  const active = sectionOf(view)
  const openReader = (): void => {
    if (lastReaderDocId) onNavigate({ name: 'reader', docId: lastReaderDocId })
    else notify(t('先从文献库打开一篇文献'), 'info')
  }
  return (
    <nav className="web-mobile-nav" aria-label={t('移动端导航')}>
      <button className={cx(active === 'library' && 'active')} onClick={() => onNavigate({ name: 'library' })}><BookOpen size={18} /><span>{t('文献')}</span></button>
      <button className={cx(active === 'reader' && 'active')} onClick={openReader}><FileText size={18} /><span>{t('阅读')}</span></button>
      <button className={cx(active === 'chats' && 'active')} onClick={() => onNavigate({ name: 'chats' })}><MessagesSquare size={18} /><span>{t('对话')}</span></button>
      <button className={cx(active === 'topics' && 'active')} onClick={() => onNavigate({ name: 'topics' })}><Layers size={18} /><span>{t('主题')}</span></button>
      <button className={cx(active === 'inbox' && 'active')} onClick={() => onNavigate({ name: 'inbox' })}><Inbox size={18} /><span>{t('收集')}</span></button>
      <button className={cx(active === 'settings' && 'active')} onClick={onSettings}><UserRound size={18} /><span>{t('我的')}</span></button>
    </nav>
  )
}

export function WebAuthScreen({
  account,
  syncStatus,
  localCount,
  notify
}: {
  account: AccountState | null
  syncStatus: SyncStatus | null
  localCount: number
  notify: Notify
}): React.JSX.Element {
  const signedIn = Boolean(account?.user && (account.status === 'active' || account.status === 'offline'))
  const syncing = signedIn && (!syncStatus || !syncStatus.initialSyncReady)
  const syncError = syncing && syncStatus?.status === 'error' ? (syncStatus.lastError || t('同步暂不可用')) : ''
  const mode: 'login' | 'settings' = signedIn ? 'settings' : 'login'
  const loginView = !signedIn
  const title = !account
    ? t('正在准备 Arbor…')
    : account.status === 'pendingApproval'
      ? t('等待主设备确认')
      : syncing
        ? t('正在登录…')
        : account.status === 'revoked'
          ? t('会话已失效')
          : t('登录 Arbor')
  const lead = !account
    ? t('正在读取账户状态…')
    : account.status === 'pendingApproval'
      ? t('登录请求已发送到主设备。批准前不会上传此浏览器中的本地数据。')
      : syncing
        ? t('正在验证账号并同步云端数据，完成前不会进入文献库。')
        : account.status === 'revoked'
          ? t('账号已在另一台设备登录，或当前会话已被撤销。重新登录后继续。')
          : t('使用你的机构账号继续。登录后将先完成云端同步，再进入文献库。')

  return (
    <div className="web-auth">
      <section className="web-auth-brand" aria-label={t('Arbor 介绍')}>
        <div className="web-auth-brand-row">
          <div className="web-auth-logo"><img src="./arbor-logo.svg" alt="Arbor" /></div>
          <div>
            <div className="web-auth-brand-name">Arbor</div>
            <div className="web-auth-brand-sub">{t('文献 · AI 研究工坊')}</div>
          </div>
        </div>
        <div className="web-auth-copy">
          <div className="web-auth-eyebrow">{t('本地优先 · 可溯源的 AI 研究工坊')}</div>
          <h1>{t('让研究与阅读，')}<br />{t('自然生长。')}</h1>
          <p>{t('把文献、摘录、灵感与 AI 对话放进同一个安静的空间。每一条结论，都能回到原文页码。')}</p>
        </div>
        <div className="web-auth-preview" aria-hidden="true">
          <div className="web-auth-mini-side">
            <div className="web-auth-mini-brand"><img src="./arbor-logo.svg" alt="" />Arbor</div>
            <i style={{ width: '78%' }} className="active" /><i style={{ width: '62%' }} /><i style={{ width: '70%' }} /><i style={{ width: '55%' }} />
            <span />
            <i style={{ width: '46%', opacity: 0.55 }} /><i style={{ width: '64%', opacity: 0.55 }} /><i style={{ width: '52%', opacity: 0.55 }} />
          </div>
          <div className="web-auth-mini-main">
            <div className="web-auth-mini-bar"><b /><b /><b /><span /></div>
            <div className="web-auth-mini-title" />
            <div className="web-auth-mini-row active"><i /><i /><i /></div>
            <div className="web-auth-mini-row"><i /><i /><i /></div>
            <div className="web-auth-mini-row"><i /><i /><i /></div>
            <div className="web-auth-mini-row"><i /><i /><i /></div>
            <div className="web-auth-mini-float">
              <strong><Sparkles size={10} />{t('AI 助手')}</strong>
              {t('LFP 的电压平台较平坦，短窗口内区分度低，建议引入温度上下文。')}
              <em>p.3–4 · Table 1</em>
            </div>
          </div>
        </div>
        <div className="web-auth-trust">
          <span><Cloud size={14} />{t('云端同步')}</span>
          <span><Search size={14} />{t('引用可溯源')}</span>
          <span><UserRound size={14} />{t('本地优先')}</span>
          <span><RefreshCw size={14} />{t('多端继续')}</span>
        </div>
      </section>

      <section className="web-auth-side">
        <div className="web-auth-mobile-brand">
          <img src="./arbor-logo.svg" alt="Arbor" />
          <div><strong>Arbor</strong><span>{t('文献 · AI 研究工坊')}</span></div>
        </div>
        <div className="web-auth-card">
          <div className="web-auth-kicker">{signedIn ? 'SYNC' : 'WELCOME BACK'}</div>
          <h2>{title}</h2>
          <p className="web-auth-lead">{lead}</p>
          {syncing ? (
            <div className={cx('web-auth-progress', syncError && 'error')}>
              <div className="web-auth-progress-icon">
                {syncError ? <CloudOff size={22} /> : <Loader2 size={22} className="spin" />}
              </div>
              <strong>{syncError ? t('同步遇到问题') : t('正在登录…')}</strong>
              <p>{syncError || t('正在验证账号并同步云端数据，请稍候。完成前不会覆盖本地缓存。')}</p>
              {!syncError && <div className="web-auth-progress-bar"><i /></div>}
              {syncError && (
                <button className="btn" onClick={() => void window.api.sync.now().catch((err: Error) => notify(err.message, 'error'))}>
                  <RefreshCw size={14} />{t('重试同步')}
                </button>
              )}
            </div>
          ) : (
            <div className={cx('web-auth-account', loginView && 'web-auth-login')}>
              <AccountView visible embedded mode={mode} notify={notify} />
            </div>
          )}
          {loginView && !syncing && (
            <div className="web-auth-note">
              <Cloud size={15} />
              <span>
                {localCount > 0
                  ? t('此浏览器中有 {0} 篇本地文献。首次登录可选择使用云端数据或申请合并本地数据。', [localCount])
                  : t('首次登录会请求主设备批准。批准前不会上传此浏览器中的本地数据。')}
              </span>
            </div>
          )}
          {!syncing && <p className="web-auth-legal">
            {t('继续即表示你同意 Arbor 的服务条款与隐私说明。OIDC 登录由你的机构身份提供商完成。')}
          </p>}
        </div>
      </section>
    </div>
  )
}
