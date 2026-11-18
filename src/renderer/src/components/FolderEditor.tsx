import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Folder } from 'lucide-react'
import type { Collection } from '@shared/types'
import { collectionDescendants, collectionPath } from '@shared/collections'
import { t } from '@shared/i18n'
import './folders.css'

export default function FolderEditor({ collections, folder, parentId, onClose, onChanged }: {
  collections: Collection[]; folder?: Collection; parentId?: string; onClose(): void; onChanged(): Promise<void> | void
}) {
  const [name, setName] = useState(folder?.name ?? '')
  const [parent, setParent] = useState(folder?.parentId ?? parentId ?? '')
  const [color, setColor] = useState(folder?.color ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const excluded = folder ? collectionDescendants(collections, folder.id) : new Set<string>()
  const colors = ['#64748b', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899']
  const valid = !!name.trim() && (!color || /^#[0-9a-f]{6}$/i.test(color))
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      if (folder) await window.api.collections.update(folder.id, { name: name.trim(), parentId: parent, color })
      else await window.api.collections.add(name.trim(), parent || undefined, color || undefined)
      await onChanged()
      onClose()
    } catch (err) { setError((err as Error).message); setBusy(false) }
  }
  return createPortal(<div className="modal-backdrop" data-sidebar-overlay onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <form className="modal folder-editor" role="dialog" aria-modal="true" aria-labelledby="folder-editor-title" onSubmit={event => void save(event)}>
      <div className="modal-head"><h3 id="folder-editor-title">{folder ? t('编辑文件夹') : t('新建文件夹')}</h3></div>
      <fieldset disabled={busy} className="folder-editor-body">
        <label htmlFor="folder-name">{t('文件夹名称')}</label>
        <input id="folder-name" className="input" autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} />
        <label htmlFor="folder-parent">{t('父文件夹')}</label>
        <select id="folder-parent" className="select" value={parent} onChange={event => setParent(event.target.value)}>
          <option value="">{t('根目录')}</option>
          {collections.filter(item => !excluded.has(item.id)).map(item => <option value={item.id} key={item.id}>{collectionPath(collections, item.id)}</option>)}
        </select>
        <label htmlFor="folder-color">{t('文件夹颜色')}</label>
        <div className="folder-color-swatches">{colors.map(value => <button type="button" key={value} aria-label={t('选择颜色 {0}', [value])} aria-pressed={color.toLowerCase() === value} style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}</div>
        <div className="folder-custom-color">
          <input id="folder-color" type="color" aria-label={t('自定义文件夹颜色')} value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#64748b'} onChange={event => setColor(event.target.value)} />
          <input className="input" aria-label={t('文件夹 HEX 颜色')} placeholder={t('默认颜色或 #RRGGBB')} value={color} maxLength={7} onChange={event => setColor(event.target.value)} />
          <button className="btn ghost small" type="button" onClick={() => setColor('')}>{t('恢复默认')}</button>
        </div>
        <div className="folder-color-preview"><Folder size={22} style={{ color: /^#[0-9a-f]{6}$/i.test(color) ? color : 'var(--accent)' }} /><span>{name.trim() || t('文件夹预览')}</span></div>
        {error && <div role="alert">{error}</div>}
      </fieldset>
      <div className="modal-foot"><button className="btn ghost" type="button" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="btn primary" type="submit" disabled={!valid || busy}>{busy ? t('保存中…') : t('保存文件夹')}</button></div>
    </form>
  </div>, document.body)
}
