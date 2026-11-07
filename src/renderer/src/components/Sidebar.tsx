import { useState } from 'react'
import { BookOpen, MessagesSquare, ScanLine, Settings, Plus, Upload, Trash2, Loader2, Keyboard } from 'lucide-react'
import type { LibraryData } from '@shared/types'
import type { View } from '../nav'
import { cx } from '../ui'

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

  const counts = new Map<string, number>()
  for (const doc of data.documents) {
    for (const collectionId of doc.collections) {
      counts.set(collectionId, (counts.get(collectionId) ?? 0) + 1)
    }
  }

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

  const deleteCollection = async (id: string, title: string): Promise<void> => {
    if (!window.confirm(`删除分类「${title}」？文献本身不会被删除。`)) return
    try {
      await window.api.collections.remove(id)
      await onChanged()
      if (view.name === 'library' && view.collectionId === id) onNavigate({ name: 'library' })
    } catch (err) {
      notify(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">Z</div>
        <div>
          <div className="brand-name">ZotAgent</div>
          <div className="brand-sub">文献 · Agent 工作台</div>
        </div>
      </div>

      <button className="btn import-btn" onClick={onImport} disabled={!!importing}>
        {importing ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
        {importing ? `导入中 ${importing.done}/${importing.total}` : '导入 PDF 文献'}
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
        <button className={cx('nav-item', view.name === 'translations' && 'active')} onClick={() => onNavigate({ name: 'translations' })}>
          <ScanLine size={17} />
          <span>截图翻译</span>
          <span className="nav-count">{data.translations.length}</span>
        </button>
        <button className={cx('nav-item', view.name === 'settings' && 'active')} onClick={() => onNavigate({ name: 'settings' })}>
          <Settings size={17} />
          <span>设置</span>
        </button>
      </nav>

      <div className="collections">
        <div className="collections-head">
          <span>分类</span>
          <button className="icon-btn tiny" title="新建分类" onClick={() => setAdding(true)}>
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
        {data.collections.map((collection) => (
          <div
            key={collection.id}
            className={cx('collection-item', view.name === 'library' && view.collectionId === collection.id && 'active')}
            onClick={() => onNavigate({ name: 'library', collectionId: collection.id })}
          >
            <span className="collection-dot" />
            <span className="collection-name">{collection.name}</span>
            <span className="nav-count">{counts.get(collection.id) ?? 0}</span>
            <button
              className="icon-btn tiny collection-delete"
              title="删除分类"
              onClick={(event) => {
                event.stopPropagation()
                void deleteCollection(collection.id, collection.name)
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
