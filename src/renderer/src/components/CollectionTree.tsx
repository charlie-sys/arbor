import { useState } from 'react'
import { ChevronDown, ChevronRight, ListTree, MoveRight, Plus, Trash2 } from 'lucide-react'
import type { Collection, DocumentMeta } from '@shared/types'
import { cx } from '../ui'

interface Props {
  collections: Collection[]
  documents: DocumentMeta[]
  activeId?: string
  onNavigate(id: string): void
  onChanged(): Promise<void> | void
  onActiveRemoved(id: string): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

interface Node {
  collection: Collection
  depth: number
}

export default function CollectionTree({
  collections,
  documents,
  activeId,
  onNavigate,
  onChanged,
  onActiveRemoved,
  notify
}: Props): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [movingId, setMovingId] = useState<string | null>(null)
  const [addingParentId, setAddingParentId] = useState<string | null>(null)
  const [childName, setChildName] = useState('')

  const known = new Set(collections.map((collection) => collection.id))
  const childrenOf = new Map<string, Collection[]>()
  const roots: Collection[] = []
  for (const collection of collections) {
    const parentId = collection.parentId && known.has(collection.parentId) ? collection.parentId : undefined
    if (!parentId) {
      roots.push(collection)
      continue
    }
    const list = childrenOf.get(parentId) ?? []
    list.push(collection)
    childrenOf.set(parentId, list)
  }

  const flatten = (list: Collection[], depth: number, out: Node[], guard: Set<string>): void => {
    for (const collection of list) {
      if (guard.has(collection.id)) continue
      guard.add(collection.id)
      out.push({ collection, depth })
      const children = childrenOf.get(collection.id)
      if (children) flatten(children, depth + 1, out, guard)
    }
  }

  const nodes: Node[] = []
  flatten(roots, 0, nodes, new Set())

  const ownCounts = new Map<string, number>()
  for (const doc of documents) {
    for (const collectionId of doc.collections) {
      ownCounts.set(collectionId, (ownCounts.get(collectionId) ?? 0) + 1)
    }
  }

  const effectiveCount = (id: string, guard = new Set<string>()): number => {
    if (guard.has(id)) return 0
    guard.add(id)
    const collection = collections.find((item) => item.id === id)
    if (!collection || collection.includeChildren === false) return ownCounts.get(id) ?? 0
    const children = childrenOf.get(id) ?? []
    return children.reduce((total, child) => total + effectiveCount(child.id, guard), ownCounts.get(id) ?? 0)
  }

  const descendantIds = (id: string): Set<string> => {
    const result = new Set<string>()
    const walk = (parentId: string): void => {
      for (const child of childrenOf.get(parentId) ?? []) {
        if (result.has(child.id)) continue
        result.add(child.id)
        walk(child.id)
      }
    }
    walk(id)
    return result
  }

  const toggleCollapsed = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const move = async (id: string, parentId: string): Promise<void> => {
    setMovingId(null)
    try {
      await window.api.collections.update(id, { parentId })
      await onChanged()
    } catch (err) {
      notify(`移动分类失败：${(err as Error).message}`, 'error')
    }
  }

  const toggleIncludeChildren = async (collection: Collection): Promise<void> => {
    try {
      await window.api.collections.update(collection.id, { includeChildren: collection.includeChildren === false })
      await onChanged()
    } catch (err) {
      notify(`更新分类失败：${(err as Error).message}`, 'error')
    }
  }

  const createChild = async (parentId: string): Promise<void> => {
    const name = childName.trim()
    if (!name) {
      setAddingParentId(null)
      return
    }
    try {
      await window.api.collections.add(name, parentId)
      setChildName('')
      setAddingParentId(null)
      setCollapsed((prev) => {
        const next = new Set(prev)
        next.delete(parentId)
        return next
      })
      await onChanged()
    } catch (err) {
      notify(`创建子分类失败：${(err as Error).message}`, 'error')
    }
  }

  const remove = async (collection: Collection): Promise<void> => {
    if (!window.confirm(`删除分类「${collection.name}」？子分类会上移一级，文献本身不会被删除。`)) return
    try {
      await window.api.collections.remove(collection.id)
      await onChanged()
      onActiveRemoved(collection.id)
    } catch (err) {
      notify(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  return (
    <div className="collection-tree">
      {nodes.map(({ collection, depth }) => {
        const children = childrenOf.get(collection.id) ?? []
        const hasChildren = children.length > 0
        const isCollapsed = collapsed.has(collection.id)
        const excluded = descendantIds(collection.id)
        const moveOptions = collections.filter((item) => item.id !== collection.id && !excluded.has(item.id))
        return (
          <div key={collection.id}>
            <div
              className={cx('collection-item', activeId === collection.id && 'active')}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onNavigate(collection.id)}
            >
              {hasChildren ? (
                <button
                  className="icon-btn tiny"
                  title={isCollapsed ? '展开子分类' : '收起子分类'}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleCollapsed(collection.id)
                  }}
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              ) : (
                <span className="collection-dot" />
              )}
              <span className="collection-name">{collection.name}</span>
              <span className="nav-count">{effectiveCount(collection.id)}</span>
              <button
                className="icon-btn tiny collection-delete"
                title="新建子分类"
                onClick={(event) => {
                  event.stopPropagation()
                  setMovingId(null)
                  setAddingParentId(addingParentId === collection.id ? null : collection.id)
                  setChildName('')
                }}
              >
                <Plus size={12} />
              </button>
              <button
                className="icon-btn tiny collection-delete"
                title="移动到其他分类"
                onClick={(event) => {
                  event.stopPropagation()
                  setAddingParentId(null)
                  setMovingId(movingId === collection.id ? null : collection.id)
                }}
              >
                <MoveRight size={12} />
              </button>
              {hasChildren && (
                <button
                  className={cx('icon-btn tiny collection-delete', collection.includeChildren !== false && 'active')}
                  title={collection.includeChildren === false ? '显示子分类文献（当前关闭）' : '显示子分类文献（当前开启）'}
                  onClick={(event) => {
                    event.stopPropagation()
                    void toggleIncludeChildren(collection)
                  }}
                >
                  <ListTree size={12} />
                </button>
              )}
              <button
                className="icon-btn tiny collection-delete"
                title="删除分类"
                onClick={(event) => {
                  event.stopPropagation()
                  void remove(collection)
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
            {movingId === collection.id && (
              <select
                className="collection-input"
                autoFocus
                value={collection.parentId ?? ''}
                onChange={(event) => void move(collection.id, event.target.value)}
                onBlur={() => setMovingId(null)}
              >
                <option value="">移到根级</option>
                {moveOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    移到「{item.name}」
                  </option>
                ))}
              </select>
            )}
            {addingParentId === collection.id && (
              <input
                className="collection-input"
                autoFocus
                value={childName}
                placeholder={`「${collection.name}」下的子分类，回车确认`}
                onChange={(event) => setChildName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createChild(collection.id)
                  if (event.key === 'Escape') {
                    setAddingParentId(null)
                    setChildName('')
                  }
                }}
                onBlur={() => {
                  if (!childName.trim()) setAddingParentId(null)
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
