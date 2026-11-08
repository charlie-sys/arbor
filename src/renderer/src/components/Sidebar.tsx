import { useState } from 'react'
import { BarChart3, BookOpen, Inbox, Layers, MessagesSquare, PenTool, ScanLine, Settings, Plus, Upload, Trash2, Loader2, Keyboard, Filter } from 'lucide-react'
import type { LibraryData } from '@shared/types'
import type { View } from '../nav'
import { cx } from '../ui'
import CollectionTree from './CollectionTree'

interface Props {
  data: LibraryData
  view: View
  importing: { done: number; total: number } | null
  onNavigate(view: View): void
  onImport(): void
  onChanged(): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function Sidebar({ data, view, importing, onNavigate, onImport, onChanged, notify }: Props): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const submitCollection = async (): Promise<void> => {
    const value = name.trim()
    if (!value) {
      setAdding(false)
      return
    }
    try {
      await window.api.collections.add(value)
      setName('')
      setAdding(false)
      await onChanged()
    } catch (err) {
      notify(`创建分类失败：${(err as Error).message}`, 'error')
    }
  }

  const deleteSavedView = async (id: string, title: string): Promise<void> => {
    if (!window.confirm(`删除保存视图「${title}」？`)) return
    try {
      await window.api.views.remove(id)
      await onChanged()
      if (view.name === 'library' && view.savedViewId === id) onNavigate({ name: 'library' })
    } catch (err) {
      notify(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-mark-img" src="./arbor-logo.svg" alt="Arbor" />
        <div>
          <div className="brand-name">Arbor</div>
          <div className="brand-sub">文献 · AI 研究工坊</div>
        </div>
      </div>

      <button className="btn import-btn" onClick={onImport} disabled={!!importing}>
        {importing ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
        {importing ? `导入中 ${importing.done}/${importing.total}` : '导入文献'}
      </button>

      <nav className="nav">
        <button className={cx('nav-item', view.name === 'library' && 'active')} onClick={() => onNavigate({ name: 'library' })}>
          <BookOpen size={17} />
          <span>文献库</span>
          <span className="nav-count">{data.documents.length}</span>
        </button>
        <button className={cx('nav-item', view.name === 'chats' && 'active')} onClick={() => onNavigate({ name: 'chats' })}>
          <MessagesSquare size={17} />
          <span>AI 对话</span>
          <span className="nav-count">{data.chats.length}</span>
        </button>
        <button className={cx('nav-item', view.name === 'topics' && 'active')} onClick={() => onNavigate({ name: 'topics' })}>
          <Layers size={17} />
          <span>研究主题</span>
          <span className="nav-count">{data.researchTopics.length}</span>
        </button>
        <button className={cx('nav-item', view.name === 'canvas' && 'active')} onClick={() => onNavigate({ name: 'canvas' })}>
          <PenTool size={17} />
          <span>主题画布</span>
          <span className="nav-count">{data.canvases.length}</span>
        </button>
        <button className={cx('nav-item', view.name === 'inbox' && 'active')} onClick={() => onNavigate({ name: 'inbox' })}>
          <Inbox size={17} />
          <span>灵感收集</span>
          <span className="nav-count">{data.inbox.filter((item) => !item.archived).length}</span>
        </button>
        <button className={cx('nav-item', view.name === 'translations' && 'active')} onClick={() => onNavigate({ name: 'translations' })}>
          <ScanLine size={17} />
          <span>截图翻译</span>
          <span className="nav-count">{data.translations.length}</span>
        </button>
        <button className={cx('nav-item', view.name === 'usage' && 'active')} onClick={() => onNavigate({ name: 'usage' })}>
          <BarChart3 size={17} />
          <span>用量仪表盘</span>
        </button>
        <button className={cx('nav-item', view.name === 'settings' && 'active')} onClick={() => onNavigate({ name: 'settings' })}>
          <Settings size={17} />
          <span>设置</span>
        </button>
      </nav>

      <div className="collections">
        <div className="collections-head">
          <span>分类</span>
          <button className="icon-btn tiny" title="新建分类（支持层级）" onClick={() => setAdding(true)}>
            <Plus size={14} />
          </button>
        </div>
        {adding && (
          <input
            className="collection-input"
            autoFocus
            value={name}
            placeholder="分类名称，回车确认"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitCollection()
              if (event.key === 'Escape') {
                setAdding(false)
                setName('')
              }
            }}
            onBlur={() => {
              if (!name.trim()) setAdding(false)
            }}
          />
        )}
        {data.collections.length === 0 && !adding && <div className="collections-empty">暂无分类，点击 + 新建</div>}
        <CollectionTree
          collections={data.collections}
          documents={data.documents}
          activeId={view.name === 'library' ? view.collectionId : undefined}
          onNavigate={(collectionId) => onNavigate({ name: 'library', collectionId })}
          onChanged={onChanged}
          onActiveRemoved={(collectionId) => {
            if (view.name === 'library' && view.collectionId === collectionId) onNavigate({ name: 'library' })
          }}
          notify={notify}
        />
      </div>

      <div className="collections">
        <div className="collections-head">保存视图</div>
        {data.savedViews.length === 0 && <div className="collections-empty">在文献库表格中保存当前筛选与排序</div>}
        {data.savedViews.map((savedView) => (
          <div
            key={savedView.id}
            className={cx(
              'collection-item',
              view.name === 'library' && view.savedViewId === savedView.id && 'active'
            )}
            onClick={() => onNavigate({ name: 'library', savedViewId: savedView.id })}
          >
            <Filter size={13} className="collection-dot" />
            <span className="collection-name">{savedView.name}</span>
            <button
              className="icon-btn tiny collection-delete"
              title="删除保存视图"
              onClick={(event) => {
                event.stopPropagation()
                void deleteSavedView(savedView.id, savedView.name)
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="shortcut">
          <Keyboard size={14} />
          <span>截图翻译 {data.settings ? 'Ctrl + Shift + T' : ''}</span>
        </div>
        <div className="sidebar-note">数据保存在本机，模型调用使用你配置的 API</div>
      </div>
    </aside>
  )
}
