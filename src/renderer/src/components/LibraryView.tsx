import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  BookOpen,
  FolderPlus,
  Loader2,
  MessageSquare,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { DocumentMeta, LibraryData, Property, PropertyValue, ReadingStatus, SavedViewConfig } from '@shared/types'
import CollectionPicker from './CollectionPicker'
import PropertyCell from './PropertyCell'
import './properties.css'
import { cx, formatTime } from '../ui'

interface Props {
  data: LibraryData
  collectionId?: string
  savedViewId?: string
  importing: { done: number; total: number } | null
  onOpen(docId: string): void
  onChat(docId: string): Promise<void> | void
  onImport(): void
  onChanged(): Promise<void> | void
  onClearCollection(): void
  onSelectCollection?(collectionId?: string): void
  onManageProperties(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

type TableSortKey =
  | 'title'
  | 'authors'
  | 'year'
  | 'journal'
  | 'collections'
  | 'tags'
  | 'pageCount'
  | 'readingStatus'
  | 'addedAt'
  | `prop:${string}`

const STATUS_LABEL: Record<ReadingStatus, string> = {
  unread: '未读',
  reading: '阅读中',
  read: '已读'
}

const STATUS_ORDER: Record<ReadingStatus, number> = {
  unread: 0,
  reading: 1,
  read: 2
}

const TABLE_COLUMNS: { key: TableSortKey; label: string }[] = [
  { key: 'title', label: '标题' },
  { key: 'authors', label: '作者' },
  { key: 'year', label: '年份' },
  { key: 'journal', label: '期刊' },
  { key: 'collections', label: '分类' },
  { key: 'tags', label: '标签' },
  { key: 'pageCount', label: '页数' },
  { key: 'readingStatus', label: '阅读状态' },
  { key: 'addedAt', label: '添加时间' }
]

const COLUMN_WIDTH_KEY = 'arbor-list-column-widths'
const LIST_WIDTH_KEY = 'arbor-list-width-ratio'
const PROPERTY_COLUMN_WIDTH = 130
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  title: 360,
  authors: 150,
  year: 80,
  journal: 190,
  collections: 150,
  tags: 170,
  pageCount: 80,
  readingStatus: 112,
  addedAt: 112
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

function columnWidthOf(widths: Record<string, number>, key: string): number {
  return widths[key] ?? DEFAULT_COLUMN_WIDTHS[key] ?? PROPERTY_COLUMN_WIDTH
}

function loadColumnWidths(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLUMN_WIDTH_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 60 && entry[1] <= 720
      )
    )
  } catch {
    return {}
  }
}

function loadListWidthRatio(): number {
  const raw = Number(window.localStorage.getItem(LIST_WIDTH_KEY))
  return Number.isFinite(raw) && raw >= 0.55 && raw <= 1 ? raw : 1
}

function optionLabel(property: Property, optionId: string): string {
  return property.options?.find((option) => option.id === optionId)?.name ?? optionId
}

export default function LibraryView({
  data,
  collectionId,
  savedViewId,
  importing,
  onOpen,
  onChat,
  onImport,
  onChanged,
  onClearCollection,
  onSelectCollection,
  onManageProperties,
  notify
}: Props): React.JSX.Element {
  const savedView = savedViewId ? data.savedViews.find((item) => item.id === savedViewId) : undefined
  const savedConfig = savedView?.config
  const savedSort = savedConfig?.sorts?.[0]
  const initialTableSort: { key: TableSortKey; dir: 'asc' | 'desc' } =
    savedSort && (TABLE_COLUMNS.some((column) => column.key === savedSort.key) || savedSort.key.startsWith('prop:'))
      ? { key: savedSort.key as TableSortKey, dir: savedSort.dir }
      : { key: 'addedAt', dir: 'desc' }
  const [query, setQuery] = useState(savedConfig?.query ?? '')
  const [starredOnly, setStarredOnly] = useState(savedConfig?.starredOnly ?? false)
  const [pickerDoc, setPickerDoc] = useState<DocumentMeta | null>(null)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all'>(savedConfig?.status ?? 'all')
  const [yearFilter, setYearFilter] = useState(savedConfig?.year ?? 'all')
  const [tagFilter, setTagFilter] = useState(savedConfig?.tag ?? 'all')
  const [propertyFilters, setPropertyFilters] = useState<Record<string, string>>(
    savedConfig?.propertyFilters ?? {}
  )
  const [tableSort, setTableSort] = useState(initialTableSort)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths)
  const [listWidthRatio, setListWidthRatio] = useState<number>(loadListWidthRatio)
  const listRegionRef = useRef<HTMLDivElement>(null)

  const persistColumnWidths = (next: Record<string, number>): void => {
    try {
      window.localStorage.setItem(COLUMN_WIDTH_KEY, JSON.stringify(next))
    } catch {
      /* localStorage is best-effort */
    }
  }

  const setColumnWidth = (key: string, width: number): void => {
    setColumnWidths((prev) => {
      const next = { ...prev, [key]: width }
      persistColumnWidths(next)
      return next
    })
  }

  const resetColumnWidth = (key: string): void => {
    setColumnWidths((prev) => {
      const next = { ...prev }
      delete next[key]
      persistColumnWidths(next)
      return next
    })
  }

  const startColumnResize = (event: ReactPointerEvent<HTMLElement>, key: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = columnWidthOf(columnWidths, key)
    const onMove = (move: PointerEvent): void => {
      setColumnWidth(key, Math.round(clamp(startWidth + move.clientX - startX, 70, 720)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startListResize = (event: ReactPointerEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const region = listRegionRef.current
    if (!region) return
    const rect = region.getBoundingClientRect()
    const onMove = (move: PointerEvent): void => {
      if (rect.width <= 0) return
      setListWidthRatio(clamp((move.clientX - rect.left) / rect.width, 0.55, 1))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setListWidthRatio((current) => {
        try {
          window.localStorage.setItem(LIST_WIDTH_KEY, String(current))
        } catch {
          /* localStorage is best-effort */
        }
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const activeCollection = collectionId ?? savedConfig?.collectionId
  const collectionName = data.collections.find((collection) => collection.id === activeCollection)?.name
  const activeCollectionIds = useMemo(() => {
    if (!activeCollection) return null
    const ids = new Set<string>([activeCollection])
    const active = data.collections.find((collection) => collection.id === activeCollection)
    if (!active || active.includeChildren === false) return ids
    let changed = true
    while (changed) {
      changed = false
      for (const collection of data.collections) {
        if (collection.parentId && ids.has(collection.parentId) && !ids.has(collection.id)) {
          ids.add(collection.id)
          changed = true
        }
      }
    }
    return ids
  }, [activeCollection, data.collections])
  const collectionHasDocs = activeCollection
    ? data.documents.some((doc) => doc.collections.some((id) => activeCollectionIds?.has(id)))
    : false

  const yearOptions = useMemo(
    () =>
      Array.from(new Set(data.documents.map((doc) => doc.year.trim()).filter(Boolean))).sort((a, b) =>
        b.localeCompare(a, 'zh-CN')
      ),
    [data.documents]
  )

  const tagOptions = useMemo(
    () => Array.from(new Set(data.documents.flatMap((doc) => doc.tags))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [data.documents]
  )

  const matchesProperty = (doc: DocumentMeta, property: Property, needle: string): boolean => {
    const value = doc.propertyValues?.[property.id]
    if (value === null || value === undefined || value === '') return false
    if (property.type === 'checkbox') return needle === 'yes' ? value === true : value === false
    if (property.type === 'select') return value === needle
    if (property.type === 'multiselect') return Array.isArray(value) && value.includes(needle)
    const text = String(value).toLowerCase()
    return property.type === 'text' || property.type === 'url' ? text.includes(needle.toLowerCase()) : text === needle.toLowerCase()
  }

  const documents = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const list = data.documents.filter((doc) => {
      if (activeCollectionIds && !doc.collections.some((id) => activeCollectionIds.has(id))) return false
      if (starredOnly && !doc.starred) return false
      if (statusFilter !== 'all' && (doc.readingStatus ?? 'unread') !== statusFilter) return false
      if (yearFilter !== 'all' && doc.year !== yearFilter) return false
      if (tagFilter !== 'all' && !doc.tags.includes(tagFilter)) return false
      for (const [propertyId, needle] of Object.entries(propertyFilters)) {
        if (!needle) continue
        const property = data.properties.find((item) => item.id === propertyId)
        if (property && !matchesProperty(doc, property, needle)) return false
      }
      if (!keyword) return true
      return (
        doc.title.toLowerCase().includes(keyword) ||
        doc.authors.toLowerCase().includes(keyword) ||
        doc.journal.toLowerCase().includes(keyword) ||
        doc.abstract.toLowerCase().includes(keyword) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(keyword))
      )
    })

    const collectionLabels = (doc: DocumentMeta): string =>
      doc.collections
        .map((id) => data.collections.find((collection) => collection.id === id)?.name ?? '')
        .filter(Boolean)
        .join('、')

    const sorted = [...list]
    const dir = tableSort.dir === 'asc' ? 1 : -1
    const propertySortId = tableSort.key.startsWith('prop:') ? tableSort.key.slice(5) : null
    const sortProperty = propertySortId
      ? data.properties.find((property) => property.id === propertySortId)
      : undefined
    const propertyText = (doc: DocumentMeta): string => {
      if (!sortProperty) return ''
      const value = doc.propertyValues?.[sortProperty.id]
      if (value === null || value === undefined) return ''
      if (Array.isArray(value)) return value.map((id) => optionLabel(sortProperty, id)).join('、')
      if (typeof value === 'boolean') return value ? '1' : '0'
      return String(value)
    }
    sorted.sort((a, b) => {
      let result = 0
      if (sortProperty) {
        result =
          sortProperty.type === 'number'
            ? (Number(a.propertyValues?.[sortProperty.id]) || 0) -
              (Number(b.propertyValues?.[sortProperty.id]) || 0)
            : propertyText(a).localeCompare(propertyText(b), 'zh-CN')
      } else {
        switch (tableSort.key) {
        case 'title':
          result = a.title.localeCompare(b.title, 'zh-CN')
          break
        case 'authors':
          result = a.authors.localeCompare(b.authors, 'zh-CN')
          break
        case 'year':
          result = (Number(a.year) || 0) - (Number(b.year) || 0)
          break
        case 'journal':
          result = a.journal.localeCompare(b.journal, 'zh-CN')
          break
        case 'collections':
          result = collectionLabels(a).localeCompare(collectionLabels(b), 'zh-CN')
          break
        case 'tags':
          result = a.tags.join('、').localeCompare(b.tags.join('、'), 'zh-CN')
          break
        case 'pageCount':
          result = a.pageCount - b.pageCount
          break
        case 'readingStatus':
          result = STATUS_ORDER[a.readingStatus ?? 'unread'] - STATUS_ORDER[b.readingStatus ?? 'unread']
          break
        case 'addedAt':
          result = a.addedAt - b.addedAt
          break
        }
      }
      return result * dir
    })
    return sorted
  }, [
    data.documents,
    data.collections,
    data.properties,
    query,
    starredOnly,
    activeCollection,
    activeCollectionIds,
    statusFilter,
    yearFilter,
    tagFilter,
    propertyFilters,
    tableSort
  ])

  const hasFilters =
    !!query.trim() ||
    starredOnly ||
    statusFilter !== 'all' ||
    yearFilter !== 'all' ||
    tagFilter !== 'all' ||
    Object.values(propertyFilters).some(Boolean) ||
    !!activeCollection

  const clearFilters = (): void => {
    setQuery('')
    setStarredOnly(false)
    setStatusFilter('all')
    setYearFilter('all')
    setTagFilter('all')
    setPropertyFilters({})
    if (activeCollection) onClearCollection()
  }

  const toggleTableSort = (key: TableSortKey): void => {
    setTableSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const toggleStar = async (doc: DocumentMeta): Promise<void> => {
    await window.api.library.update(doc.id, { starred: !doc.starred })
    await onChanged()
  }

  const changeStatus = async (doc: DocumentMeta, status: ReadingStatus): Promise<void> => {
    await window.api.library.update(doc.id, { readingStatus: status })
    await onChanged()
  }

  const changePropertyValue = async (
    doc: DocumentMeta,
    property: Property,
    value: PropertyValue
  ): Promise<void> => {
    const next = { ...(doc.propertyValues ?? {}) }
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete next[property.id]
    } else {
      next[property.id] = value
    }
    try {
      await window.api.library.update(doc.id, { propertyValues: next })
      await onChanged()
    } catch (err) {
      notify(`保存「${property.name}」失败：${(err as Error).message}`, 'error')
    }
  }

  const currentConfig = (): SavedViewConfig => {
    return {
      query,
      starredOnly,
      status: statusFilter,
      year: yearFilter,
      tag: tagFilter,
      collectionId: activeCollection,
      propertyFilters,
      viewMode: 'table',
      sorts: [tableSort]
    }
  }

  const openSaveView = (): void => {
    setSaveViewName(savedView?.name ? `${savedView.name} 副本` : '我的视图')
    setSaveViewOpen(true)
  }

  const totalColumnWidth =
    TABLE_COLUMNS.reduce((sum, column) => sum + columnWidthOf(columnWidths, column.key), 0) +
    data.properties.reduce((sum, property) => sum + columnWidthOf(columnWidths, `prop:${property.id}`), 0) +
    PROPERTY_COLUMN_WIDTH

  const saveView = async (): Promise<void> => {
    const name = saveViewName.trim()
    if (!name) return
    try {
      await window.api.views.add(name, currentConfig())
      await onChanged()
      setSaveViewOpen(false)
      notify(`已保存视图「${name}」，可在左侧栏切换`, 'success')
    } catch (err) {
      notify(`保存视图失败：${(err as Error).message}`, 'error')
    }
  }

  const remove = async (doc: DocumentMeta): Promise<void> => {
    if (!window.confirm(`删除《${doc.title}》？该操作会同时删除本地 PDF 与提取的文本，且不可恢复。`)) return
    try {
      await window.api.library.remove(doc.id)
      await onChanged()
      notify('文献已删除', 'success')
    } catch (err) {
      notify(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  const collectionNames = (doc: DocumentMeta): string =>
    doc.collections
      .map((id) => data.collections.find((collection) => collection.id === id)?.name ?? '')
      .filter(Boolean)
      .join('、')

  return (
    <div className="view library-view">
      <header className="view-head">
        <div>
          <h1>{collectionName ? collectionName : '文献库'}</h1>
          <p className="muted">
            共 {data.documents.length} 篇文献
            {collectionName ? ` · 分类「${collectionName}」` : ''}
            {documents.length !== data.documents.length ? ` · 当前显示 ${documents.length} 篇` : ''}
          </p>
        </div>
        <button className="btn primary" onClick={onImport} disabled={!!importing}>
          {importing ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
          {importing ? `导入中 ${importing.done}/${importing.total}` : '导入 PDF'}
        </button>
      </header>

      <div className="library-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者、期刊、标签…" />
        </div>
        <div className="library-filters">
          <select className="select" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
            <option value="all">全部年份</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={activeCollection ?? ''}
            onChange={(event) => onSelectCollection?.(event.target.value || undefined)}
          >
            <option value="">全部分类</option>
            {data.collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
          <select className="select" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
            <option value="all">全部标签</option>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ReadingStatus | 'all')}
          >
            <option value="all">全部阅读状态</option>
            <option value="unread">未读</option>
            <option value="reading">阅读中</option>
            <option value="read">已读</option>
          </select>
          <button className={cx('btn ghost', starredOnly && 'active')} onClick={() => setStarredOnly((value) => !value)}>
            <Star size={15} fill={starredOnly ? 'currentColor' : 'none'} /> 星标
          </button>
          <button className="btn ghost" onClick={openSaveView} title="保存当前筛选、排序与属性条件">
            <Save size={15} /> 保存视图
          </button>
          <button className="btn ghost" onClick={onManageProperties} title="新建、编辑或删除文献属性">
            <Settings2 size={15} /> 属性
          </button>
        </div>
      </div>

      {data.properties.length > 0 && (
        <div className="property-filter-bar">
          <span className="property-filter-label">
            <SlidersHorizontal size={14} /> 属性筛选
          </span>
          {data.properties.map((property) => {
            const current = propertyFilters[property.id] ?? ''
            const update = (value: string): void => {
              setPropertyFilters((prev) => {
                const next = { ...prev }
                if (value) next[property.id] = value
                else delete next[property.id]
                return next
              })
            }
            if (property.type === 'select' || property.type === 'multiselect') {
              return (
                <label key={property.id} className="property-filter">
                  <span>{property.name}</span>
                  <select
                    className="select small"
                    value={current}
                    onChange={(event) => update(event.target.value)}
                  >
                    <option value="">全部</option>
                    {(property.options ?? []).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
              )
            }
            if (property.type === 'checkbox') {
              return (
                <label key={property.id} className="property-filter">
                  <span>{property.name}</span>
                  <select
                    className="select small"
                    value={current}
                    onChange={(event) => update(event.target.value)}
                  >
                    <option value="">全部</option>
                    <option value="yes">是</option>
                    <option value="no">否</option>
                  </select>
                </label>
              )
            }
            return (
              <label key={property.id} className="property-filter">
                <span>{property.name}</span>
                <input
                  className="property-filter-input"
                  type={property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : 'text'}
                  value={current}
                  placeholder="筛选…"
                  onChange={(event) => update(event.target.value)}
                />
              </label>
            )
          })}
          {Object.values(propertyFilters).some(Boolean) && (
            <button className="btn ghost small" onClick={() => setPropertyFilters({})}>
              清除属性筛选
            </button>
          )}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <BookOpen size={28} />
          </div>
          <h2>
            {data.documents.length === 0
              ? '先把文献放进来'
              : activeCollection && !collectionHasDocs
                ? '该分类还没有文献'
                : '没有匹配的文献'}
          </h2>
          <p className="muted">
            {data.documents.length === 0
              ? '导入 PDF 后，Arbor 会自动提取全文，用于阅读、检索、问答和翻译。'
              : activeCollection && !collectionHasDocs
                ? '在列表行中点击「分类」按钮，即可把文献加入该分类。'
                : '当前筛选条件下没有结果，试试更换关键词或清除筛选条件。'}
          </p>
          {data.documents.length === 0 && (
            <button className="btn primary" onClick={onImport}>
              <Upload size={16} /> 导入 PDF 文献
            </button>
          )}
          {data.documents.length > 0 && hasFilters && (
            <button className="btn" onClick={clearFilters}>
              清除筛选
            </button>
          )}
        </div>
      ) : (
        <div className="library-list-region" ref={listRegionRef}>
          <div className="library-list-shell" style={{ width: `${listWidthRatio * 100}%` }}>
            <div className="doc-table-wrap">
              <table
                className="doc-table table-view"
                style={{ tableLayout: 'fixed', minWidth: totalColumnWidth }}
              >
                <colgroup>
                  {TABLE_COLUMNS.map((column) => (
                    <col key={column.key} style={{ width: columnWidthOf(columnWidths, column.key) }} />
                  ))}
                  {data.properties.map((property) => (
                    <col
                      key={property.id}
                      style={{ width: columnWidthOf(columnWidths, `prop:${property.id}`) }}
                    />
                  ))}
                  <col style={{ width: PROPERTY_COLUMN_WIDTH }} />
                </colgroup>
                <thead>
              <tr>
                {TABLE_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={cx('sortable', tableSort.key === column.key && 'sorted')}
                    onClick={() => toggleTableSort(column.key)}
                    title={`按${column.label}排序`}
                  >
                    {column.label}
                    <span className="sort-arrow">
                      {tableSort.key === column.key ? (tableSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                    <span
                      className="col-resizer"
                      title="拖动调整列宽，双击恢复默认"
                      onPointerDown={(event) => startColumnResize(event, column.key)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => {
                        event.stopPropagation()
                        resetColumnWidth(column.key)
                      }}
                    />
                  </th>
                ))}
                {data.properties.map((property) => {
                  const key = `prop:${property.id}` as TableSortKey
                  return (
                    <th
                      key={property.id}
                      className={cx('sortable', tableSort.key === key && 'sorted')}
                      onClick={() => toggleTableSort(key)}
                      title={`按${property.name}排序`}
                    >
                      {property.name}
                      <span className="sort-arrow">
                        {tableSort.key === key ? (tableSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                      <span
                        className="col-resizer"
                        title="拖动调整列宽，双击恢复默认"
                        onPointerDown={(event) => startColumnResize(event, key)}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          resetColumnWidth(key)
                        }}
                      />
                    </th>
                  )
                })}
                <th className="actions-head">操作</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="doc-row" onClick={() => onOpen(doc.id)}>
                  <td className="cell-title">
                    <div className="cell-title-inner">
                      <button
                        className={cx('icon-btn star-btn', doc.starred && 'starred')}
                        title={doc.starred ? '取消星标' : '设为星标'}
                        onClick={(event) => {
                          event.stopPropagation()
                          void toggleStar(doc)
                        }}
                      >
                        <Star size={14} fill={doc.starred ? 'currentColor' : 'none'} />
                      </button>
                      <span className="cell-title-text">{doc.title}</span>
                    </div>
                  </td>
                  <td>{doc.authors || '—'}</td>
                  <td>{doc.year || '—'}</td>
                  <td>{doc.journal || '—'}</td>
                  <td>{collectionNames(doc) || '—'}</td>
                  <td>
                    {doc.tags.length ? (
                      <span className="cell-tags">
                        {doc.tags.map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{doc.pageCount > 0 ? doc.pageCount : '—'}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <select
                      className={cx('select small', `status-select status-${doc.readingStatus ?? 'unread'}`)}
                      value={doc.readingStatus ?? 'unread'}
                      onChange={(event) => void changeStatus(doc, event.target.value as ReadingStatus)}
                    >
                      {(Object.keys(STATUS_LABEL) as ReadingStatus[]).map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABEL[status]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="cell-time">{formatTime(doc.addedAt)}</td>
                  {data.properties.map((property) => (
                    <td
                      key={property.id}
                      className="prop-cell"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <PropertyCell
                        property={property}
                        value={doc.propertyValues?.[property.id]}
                        onChange={(value) => void changePropertyValue(doc, property, value)}
                      />
                    </td>
                  ))}
                  <td className="cell-actions" onClick={(event) => event.stopPropagation()}>
                    <span className="row-actions">
                      <button className="icon-btn tiny" title="加入分类" onClick={() => setPickerDoc(doc)}>
                        <FolderPlus size={14} />
                      </button>
                      <button className="icon-btn tiny" title="与文献对话" onClick={() => void onChat(doc.id)}>
                        <MessageSquare size={14} />
                      </button>
                      <button className="icon-btn tiny" title="删除文献" onClick={() => void remove(doc)}>
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
              </table>
            </div>
            <div
              className="list-width-handle"
              title="拖动调整列表宽度"
              onPointerDown={startListResize}
            />
          </div>
        </div>
      )}

      {saveViewOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSaveViewOpen(false)}>
          <div className="modal save-view-modal">
            <div className="modal-head">
              <div>
                <h3>保存视图</h3>
                <p className="muted">保存当前筛选、排序与属性条件，之后可在左侧栏一键恢复。</p>
              </div>
              <button className="icon-btn" title="关闭" onClick={() => setSaveViewOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="field">
              <label>视图名称</label>
              <input
                autoFocus
                value={saveViewName}
                onChange={(event) => setSaveViewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveView()
                }}
                placeholder="例如：未读方法学文献"
              />
            </div>
            <div className="modal-foot">
              <div className="muted small">视图保存在本机文献库中</div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setSaveViewOpen(false)}>
                  取消
                </button>
                <button className="btn primary" onClick={() => void saveView()} disabled={!saveViewName.trim()}>
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pickerDoc && (
        <CollectionPicker
          doc={pickerDoc}
          collections={data.collections}
          onClose={() => setPickerDoc(null)}
          onChanged={onChanged}
          notify={notify}
        />
      )}
    </div>
  )
}
