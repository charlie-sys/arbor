import { useCallback, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, MoreHorizontal, Plus, Palette, ListTree, Trash2 } from 'lucide-react'
import type { Collection, DocumentMeta } from '@shared/types'
import { collectionDescendants, collectionPath } from '@shared/collections'
import { cx } from '../ui'
import { t } from '@shared/i18n'
import FolderEditor from './FolderEditor'
import FolderMenu from './FolderMenu'
import './folders.css'

interface Props {
  collections: Collection[]; documents: DocumentMeta[]; activeId?: string
  onNavigate(id: string): void; onChanged(): Promise<void> | void; onActiveRemoved(id: string): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function CollectionTree({ collections, documents, activeId, onNavigate, onChanged, onActiveRemoved, notify }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const [editor, setEditor] = useState<{ folder?: Collection; parentId?: string } | null>(null)
  const known = new Set(collections.map(item => item.id))
  const children = (id: string) => collections.filter(item => item.parentId === id)
  const nodes: { folder: Collection; depth: number }[] = []
  const seen = new Set<string>()
  const flatten = (folder: Collection, depth: number, hidden = false) => {
    if (seen.has(folder.id)) return
    seen.add(folder.id)
    if (!hidden) nodes.push({ folder, depth })
    for (const child of children(folder.id)) flatten(child, depth + 1, hidden || collapsed.has(folder.id))
  }
  collections.filter(item => !item.parentId || !known.has(item.parentId)).forEach(item => flatten(item, 0))
  collections.filter(item => !seen.has(item.id)).forEach(item => flatten(item, 0))
  const edit = (value: { folder?: Collection; parentId?: string }) => { setMenu(null); setEditor(value) }
  const remove = async (folder: Collection) => {
    setMenu(null)
    if (!window.confirm(t('删除文件夹「{0}」？子文件夹会上移一级，文献本身不会被删除。', [folder.name]))) return
    try { await window.api.collections.remove(folder.id); await onChanged(); onActiveRemoved(folder.id); setMenu(null) }
    catch (err) { notify((err as Error).message, 'error') }
  }
  return <div className="collection-tree folder-tree" role="tree" aria-label={t('文献文件夹')}>
    {nodes.map(({ folder, depth }) => {
      const hasChildren = children(folder.id).length > 0
      const isCollapsed = collapsed.has(folder.id)
      const scope = folder.includeChildren === false ? new Set([folder.id]) : collectionDescendants(collections, folder.id)
      const count = documents.filter(doc => doc.collections.some(id => scope.has(id))).length
      return <div key={folder.id}>
        <div className={cx('collection-item', activeId === folder.id && 'active')} role="treeitem" aria-level={depth + 1} aria-selected={activeId === folder.id} aria-expanded={hasChildren ? !isCollapsed : undefined} data-folder-id={folder.id} tabIndex={0} title={collectionPath(collections, folder.id)} style={{ paddingLeft: 6 + Math.min(depth, 10) * 14 }} onClick={() => onNavigate(folder.id)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onNavigate(folder.id) } }}>
          {hasChildren ? <button className="icon-btn tiny folder-chevron" aria-label={t(isCollapsed ? '展开文件夹：{0}' : '收起文件夹：{0}', [folder.name])} onClick={event => { event.stopPropagation(); setCollapsed(previous => { const next = new Set(previous); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next }) }}>{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button> : <span className="folder-chevron" />}
          {activeId === folder.id ? <FolderOpen className="folder-icon" size={16} style={{ color: folder.color || 'var(--accent)' }} /> : <Folder className="folder-icon" size={16} style={{ color: folder.color || 'var(--accent)' }} />}
          <span className="collection-name">{folder.name}</span><span className="nav-count">{count}</span>
          <button className="icon-btn tiny folder-actions" aria-label={t('管理文件夹：{0}', [folder.name])} aria-expanded={menu === folder.id} onClick={event => { event.stopPropagation(); anchor.current = event.currentTarget; setMenu(menu === folder.id ? null : folder.id) }}><MoreHorizontal size={15} /></button>
        </div>
        {menu === folder.id && anchor.current && <FolderMenu anchor={anchor.current} onClose={closeMenu}>
          <button role="menuitem" className="btn ghost small" onClick={() => edit({ parentId: folder.id })}><Plus size={13} />{t('新建子文件夹')}</button>
          <button role="menuitem" className="btn ghost small" onClick={() => edit({ folder })}><Palette size={13} />{t('编辑名称、颜色与位置')}</button>
          <button role="menuitem" className="btn ghost small" onClick={async () => { setMenu(null); try { await window.api.collections.update(folder.id, { includeChildren: folder.includeChildren === false }); await onChanged() } catch (err) { notify((err as Error).message, 'error') } }}><ListTree size={13} />{folder.includeChildren === false ? t('包含子文件夹文献') : t('仅显示本文件夹文献')}</button>
          <button role="menuitem" className="btn ghost small" onClick={() => void remove(folder)}><Trash2 size={13} />{t('删除文件夹')}</button>
        </FolderMenu>}
      </div>
    })}
    {editor && <FolderEditor collections={collections} {...editor} onClose={() => setEditor(null)} onChanged={async () => {
      if (editor.parentId) setCollapsed(previous => { const next = new Set(previous); next.delete(editor.parentId!); return next })
      await onChanged()
    }} />}
  </div>
}
