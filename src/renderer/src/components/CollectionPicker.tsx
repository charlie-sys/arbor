import { useEffect, useState } from 'react'
import { FolderPlus, Plus, X } from 'lucide-react'
import type { Collection, DocumentMeta } from '@shared/types'
import { cx } from '../ui'

interface Props {
  doc: DocumentMeta
  collections: Collection[]
  onClose(): void
  onChanged(): Promise<void> | void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

export default function CollectionPicker({ doc, collections, onClose, onChanged, notify }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>(doc.collections)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSelected(doc.collections)
  }, [doc.id])

  const toggle = (id: string): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  const createCollection = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const created = await window.api.collections.add(name)
      await onChanged()
      setSelected((prev) => [...prev, created.id])
      setNewName('')
    } catch (err) {
      notify(`新建分类失败：${(err as Error).message}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.library.update(doc.id, { collections: selected })
      await onChanged()
      notify(`《${doc.title}》分类已更新`, 'success')
      onClose()
    } catch (err) {
      notify(`保存分类失败：${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal collection-picker">
        <div className="modal-head">
          <div>
            <h3>归类文献</h3>
            <p className="muted">{doc.title.length > 70 ? `${doc.title.slice(0, 70)}…` : doc.title}</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="collection-picker-body">
          {collections.length === 0 && (
            <div className="muted small">还没有分类，可在下方直接新建一个。</div>
          )}
          <div className="collection-picker-list">
            {collections.map((collection) => (
              <label key={collection.id} className={cx('doc-pick-item', selected.includes(collection.id) && 'checked')}>
                <input
                  type="checkbox"
                  checked={selected.includes(collection.id)}
                  onChange={() => toggle(collection.id)}
                />
                <div>
                  <div className="doc-pick-title">{collection.name}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="create-collection-row">
            <div className="search-box">
              <FolderPlus size={15} />
              <input
                value={newName}
                placeholder="新建分类名称"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createCollection()
                  }
                }}
              />
            </div>
            <button className="btn" onClick={() => void createCollection()} disabled={!newName.trim() || creating}>
              <Plus size={14} /> {creating ? '创建中…' : '新建并选中'}
            </button>
          </div>
        </div>

        <div className="modal-foot">
          <div className="muted small">已选择 {selected.length} 个分类</div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存归类'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
