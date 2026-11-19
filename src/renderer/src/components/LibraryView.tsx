import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  BookOpen,
  ExternalLink,
  FolderPlus,
  Folder,
  Plus,
  Globe,
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
import type { UpdateInfo } from '@shared/api'
import CollectionPicker from './CollectionPicker'
import { BatchDeleteDialog, useBatchSelection } from './batch'
import DocumentBatchDialog from './DocumentBatchDialog'
import CollectionTree from './CollectionTree'
import FolderEditor from './FolderEditor'
import { collectionPath } from '@shared/collections'
import './folders.css'
import PropertyCell from './PropertyCell'
import './properties.css'
import LibraryPagination, { LIBRARY_PAGE_SIZE_KEY, LIBRARY_PAGE_SIZES, loadLibraryPageSize } from './LibraryPagination'
import { cx, formatTime } from '../ui'
import { localeTag, t } from '@shared/i18n'

interface Props {
  data: LibraryData
  collectionId?: string
  savedViewId?: string
  initialStatus?: ReadingStatus | 'all'
  initialStarredOnly?: boolean
  importing: { done: number; total: number } | null
  onOpen(docId: string): void
  onChat(docId: string): Promise<void> | void
  onImport(collectionId?: string): void
  onImportWeb(collectionId?: string): void
  onChanged(): Promise<void> | void
  onClearCollection(): void
  onSelectCollection?(collectionId?: string): void
  onManageProperties(): void
  updateInfo: UpdateInfo | null
  updateChecking: boolean
  onOpenUpdate(): void
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

function optionLabel(property: Property, optionId: string): string {
  return property.options?.find((option) => option.id === optionId)?.name ?? optionId
}

export default function LibraryView({
  data,
  collectionId,
  savedViewId,
  initialStatus,
  initialStarredOnly,
  importing,
  onOpen,
  onChat,
  onImport,
  onImportWeb,
  onChanged,
  onClearCollection,
  onSelectCollection,
  onManageProperties,
  updateInfo,
  updateChecking,
  onOpenUpdate,
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
  const [starredOnly, setStarredOnly] = useState(savedConfig?.starredOnly ?? initialStarredOnly ?? false)
  const [pickerDoc, setPickerDoc] = useState<DocumentMeta | null>(null)
  const [batchEditing, setBatchEditing] = useState(false)
  const [newFolder, setNewFolder] = useState(false)
  const [deleting, setDeleting] = useState<DocumentMeta[] | null>(null)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | 'all'>(savedConfig?.status ?? initialStatus ?? 'all')
  const [yearFilter, setYearFilter] = useState(savedConfig?.year ?? 'all')
  const [tagFilter, setTagFilter] = useState(savedConfig?.tag ?? 'all')
  const [propertyFilters, setPropertyFilters] = useState<Record<string, string>>(
    savedConfig?.propertyFilters ?? {}
  )
  const [tableSort, setTableSort] = useState(initialTableSort)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths)
  const [pageSize, setPageSize] = useState(loadLibraryPageSize)
  const [pagination, setPagination] = useState({ scope: '', page: 1 })
  const tableScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialStatus !== undefined) setStatusFilter(initialStatus)
  }, [initialStatus])

  useEffect(() => {
    if (initialStarredOnly !== undefined) setStarredOnly(initialStarredOnly)
  }, [initialStarredOnly])

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
        b.localeCompare(a, localeTag())
      ),
    [data.documents]
  )

  const tagOptions = useMemo(
    () => Array.from(new Set(data.documents.flatMap((doc) => doc.tags))).sort((a, b) => a.localeCompare(b, localeTag())),
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
        .map((id) => collectionPath(data.collections, id))
        .filter(Boolean)
        .join(t('、'))

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
      if (Array.isArray(value)) return value.map((id) => optionLabel(sortProperty, id)).join(t('、'))
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
            : propertyText(a).localeCompare(propertyText(b), localeTag())
      } else {
        switch (tableSort.key) {
        case 'title':
          result = a.title.localeCompare(b.title, localeTag())
          break
        case 'authors':
          result = a.authors.localeCompare(b.authors, localeTag())
          break
        case 'year':
          result = (Number(a.year) || 0) - (Number(b.year) || 0)
          break
        case 'journal':
          result = a.journal.localeCompare(b.journal, localeTag())
          break
        case 'collections':
          result = collectionLabels(a).localeCompare(collectionLabels(b), localeTag())
          break
        case 'tags':
          result = a.tags.join(t('、')).localeCompare(b.tags.join(t('、')), localeTag())
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

  const scope = JSON.stringify([query, starredOnly, activeCollection, savedViewId, statusFilter, yearFilter, tagFilter, propertyFilters, tableSort, pageSize])
  const totalPages = Math.ceil(documents.length / pageSize)
  const currentPage = pagination.scope === scope ? Math.min(Math.max(1, totalPages), pagination.page) : 1
  const pageDocuments = documents.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const pageIds = pageDocuments.map(doc => doc.id)
  useEffect(() => {
    setPagination(previous => previous.scope === scope && previous.page === currentPage ? previous : { scope, page: currentPage })
    tableScrollRef.current?.scrollTo({ top: 0 })
  }, [scope, currentPage])
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => { if (event.key === LIBRARY_PAGE_SIZE_KEY) setPageSize(loadLibraryPageSize()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const changePageSize = (size: number): void => {
    if (!(LIBRARY_PAGE_SIZES as readonly number[]).includes(size)) return
    setPageSize(size)
    try { localStorage.setItem(LIBRARY_PAGE_SIZE_KEY, String(size)) } catch { /* Optional preference. */ }
  }
  const selection = useBatchSelection(documents.map(doc => doc.id))
  const selectedIds = new Set(selection.ids)
  const selectedOnPage = pageIds.filter(id => selectedIds.has(id)).length
  const selectedDocuments = documents.filter(doc => selectedIds.has(doc.id))
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
      notify(t("保存「{0}」失败：{1}", [property.name, (err as Error).message]), 'error')
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
    setSaveViewName(savedView?.name ? t("{0} 副本", [savedView.name]) : t("我的视图"))
    setSaveViewOpen(true)
  }

  const totalColumnWidth =
    TABLE_COLUMNS.reduce((sum, column) => sum + columnWidthOf(columnWidths, column.key), 0) +
    data.properties.reduce((sum, property) => sum + columnWidthOf(columnWidths, `prop:${property.id}`), 0) +
    PROPERTY_COLUMN_WIDTH + 44

  const saveView = async (): Promise<void> => {
    const name = saveViewName.trim()
    if (!name) return
    try {
      await window.api.views.add(name, currentConfig())
      await onChanged()
      setSaveViewOpen(false)
      notify(t("已保存视图「{0}」，可在左侧栏切换", [name]), 'success')
    } catch (err) {
      notify(t("保存视图失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const remove = async (doc: DocumentMeta): Promise<void> => {
    if (!window.confirm(t("删除《{0}》？该操作会同时删除本地 PDF 与提取的文本，且不可恢复。", [doc.title]))) return
    try {
      await window.api.library.remove(doc.id)
      await onChanged()
      notify(t("文献已删除"), 'success')
    } catch (err) {
      notify(t("删除失败：{0}", [(err as Error).message]), 'error')
    }
  }

  const collectionNames = (doc: DocumentMeta): string =>
    doc.collections
      .map((id) => collectionPath(data.collections, id))
      .filter(Boolean)
      .join(t('、'))

  const updateState = updateInfo?.error
    ? 'error'
    : updateInfo?.hasUpdate
      ? 'new'
      : updateInfo
        ? 'latest'
        : updateChecking
          ? 'checking'
          : 'error'
  const updateLabel =
    updateState === 'checking'
      ? t("检查中…")
      : updateState === 'error'
        ? t("更新检查失败")
        : updateState === 'new'
          ? t("新版本 v{0}", [updateInfo?.latestVersion])
          : t("已是最新")

  return (
    <div className="view library-view">
      <header className="view-head">
        <div>
          <h1>{collectionName ? collectionName : t("文献库")}</h1>
          <p className="muted">
            {' '}{t("共")}{' '}{data.documents.length} {' '}{t("篇文献")}{' '}{collectionName ? t(" · 分类「{0}」", [collectionName]) : ''}
            {documents.length !== data.documents.length ? t(' · 筛选结果 {0} 篇', [documents.length]) : ''}
          </p>
        </div>
        <div className="view-head-actions">
          <button
            className={cx('version-pill', updateState)}
            onClick={onOpenUpdate}
            title={updateState === 'new' ? t("发现新版本 v{0}，打开设置更新", [updateInfo?.latestVersion]) : t("打开设置检查更新")}
          >
            <span className="version-dot" />
            <span className="version-number">v{updateInfo?.currentVersion ?? '—'}</span>
            <span className="version-status">{updateLabel}</span>
          </button>
          <button className="btn" onClick={() => onImportWeb(activeCollection)} disabled={!!importing}><Globe size={16} />{t('导入网页')}</button>
          <button className="btn primary" onClick={() => onImport(activeCollection)} disabled={!!importing}>
            {importing ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            {importing ? t("导入中 {0}/{1}", [importing.done, importing.total]) : t("导入文献")}
          </button>
        </div>
      </header>

      <div className="library-workspace">
        <aside className="library-folder-panel" aria-label={t('文件夹目录')}>
          <div className="library-folder-head"><strong>{t('文献文件夹')}</strong><button className="icon-btn" title={t('新建文件夹')} onClick={() => setNewFolder(true)}><Plus size={16} /></button></div>
          <button className="btn ghost small" onClick={() => onSelectCollection?.(undefined)}><BookOpen size={15} />{t('全部文献')}</button>
          <CollectionTree collections={data.collections} documents={data.documents} activeId={activeCollection} onNavigate={id => onSelectCollection?.(id)} onChanged={onChanged} onActiveRemoved={id => { if (activeCollection === id) onClearCollection() }} notify={notify} />
          {!data.collections.length && <div className="collections-empty">{t('点击 + 新建文件夹，可继续创建子文件夹')}</div>}
        </aside>
        <section className="library-documents">
          {activeCollection && <div className="folder-breadcrumbs"><button className="link-btn" onClick={() => onSelectCollection?.(undefined)}>{t('全部文献')}</button><span>/</span><Folder size={14} style={{ color: data.collections.find(item => item.id === activeCollection)?.color || 'var(--accent)' }} /><span>{collectionPath(data.collections, activeCollection)}</span></div>}
      <div className="library-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索标题、作者、期刊、标签…")} />
        </div>
        <div className="library-filters">
          <select className="select" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
            <option value="all">{t("全部年份")}</option>
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
            <option value="">{t("全部分类")}</option>
            {data.collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collectionPath(data.collections, collection.id)}
              </option>
            ))}
          </select>
          <select className="select" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
            <option value="all">{t("全部标签")}</option>
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
            <option value="all">{t("全部阅读状态")}</option>
            <option value="unread">{t("未读")}</option>
            <option value="reading">{t("阅读中")}</option>
            <option value="read">{t("已读")}</option>
          </select>
          <button className={cx('btn ghost', starredOnly && 'active')} onClick={() => setStarredOnly((value) => !value)}>
            <Star size={15} fill={starredOnly ? 'currentColor' : 'none'} /> {' '}{t("星标")}{' '}</button>
          <button className="btn ghost" onClick={openSaveView} title={t("保存当前筛选、排序与属性条件")}>
            <Save size={15} /> {' '}{t("保存视图")}{' '}</button>
          <button className="btn ghost" onClick={onManageProperties} title={t("新建、编辑或删除文献属性")}>
            <Settings2 size={15} /> {' '}{t("属性")}{' '}</button>
        </div>
      </div>

      {data.properties.length > 0 && (
        <div className="property-filter-bar">
          <span className="property-filter-label">
            <SlidersHorizontal size={14} /> {' '}{t("属性筛选")}{' '}</span>
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
                    <option value="">{t("全部")}</option>
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
                    <option value="">{t("全部")}</option>
                    <option value="yes">{t("是")}</option>
                    <option value="no">{t("否")}</option>
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
                  placeholder={t("筛选…")}
                  onChange={(event) => update(event.target.value)}
                />
              </label>
            )
          })}
          {Object.values(propertyFilters).some(Boolean) && (
            <button className="btn ghost small" onClick={() => setPropertyFilters({})}>
              {' '}{t("清除属性筛选")}{' '}</button>
          )}
        </div>
      )}

      <div className="batch-toolbar" aria-label={t('文献批量操作')}>
        <button className="btn ghost small" disabled={!pageDocuments.length} onClick={() => selection.select(pageIds)}>{t('全选当前页')}</button>
        {documents.length > pageSize && <button className="btn ghost small" disabled={selection.ids.length === documents.length} onClick={selection.all}>{t('全选筛选结果')}</button>}
        <button className="btn ghost small" disabled={!selection.ids.length} onClick={selection.clear}>{t('全不选')}</button>
        <span className="batch-count">{t('已选择 {0} / {1} 项（当前筛选结果）', [selection.ids.length, documents.length])}</span>
        <button className="btn small" disabled={!selection.ids.length} onClick={() => setBatchEditing(true)}>{t('批量修改')}</button>
        <button className="btn small" disabled={!selection.ids.length} onClick={() => setDeleting(selectedDocuments)}>{t('批量删除')}</button>
      </div>
      {documents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <BookOpen size={28} />
          </div>
          <h2>
            {data.documents.length === 0
              ? t("先把文献放进来")
              : activeCollection && !collectionHasDocs
                ? t("该分类还没有文献")
                : t("没有匹配的文献")}
          </h2>
          <p className="muted">
            {data.documents.length === 0
              ? t("导入 PDF、Word、Markdown 或 TXT 后，Arbor 会自动提取全文，用于阅读、检索、问答和翻译。")
              : activeCollection && !collectionHasDocs
                ? t("在列表行中点击「分类」按钮，即可把文献加入该分类。")
                : t("当前筛选条件下没有结果，试试更换关键词或清除筛选条件。")}
          </p>
          {data.documents.length === 0 && (
            <button className="btn primary" onClick={() => onImport(activeCollection)}>
              <Upload size={16} /> {' '}{t("导入文献")}{' '}</button>
          )}
          {data.documents.length > 0 && hasFilters && (
            <button className="btn" onClick={clearFilters}>
              {' '}{t("清除筛选")}{' '}</button>
          )}
        </div>
      ) : (
        <div className="library-list-region">
          <div className="library-list-shell">
            <div className="doc-table-wrap" ref={tableScrollRef}>
              <table
                className="doc-table table-view"
                style={{ tableLayout: 'fixed', minWidth: totalColumnWidth }}
              >
                <colgroup>
                  <col style={{ width: 44 }} />
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
                <th className="batch-selection-cell"><input type="checkbox" aria-label={t('全选当前页文献')} checked={pageIds.length > 0 && selectedOnPage === pageIds.length} ref={node => { if (node) node.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length }} onChange={event => event.target.checked ? selection.select(pageIds) : selection.unselect(pageIds)} /></th>
                {TABLE_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={cx('sortable', tableSort.key === column.key && 'sorted')}
                    onClick={() => toggleTableSort(column.key)}
                    title={t("按{0}排序", [t(column.label)])}
                  >
                    {t(column.label)}
                    <span className="sort-arrow">
                      {tableSort.key === column.key ? (tableSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                    <span
                      className="col-resizer"
                      title={t("拖动调整列宽，双击恢复默认")}
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
                      title={t("按{0}排序", [property.name])}
                    >
                      {property.name}
                      <span className="sort-arrow">
                        {tableSort.key === key ? (tableSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                      <span
                        className="col-resizer"
                        title={t("拖动调整列宽，双击恢复默认")}
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
                <th className="actions-head">{t("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {pageDocuments.map((doc) => (
                <tr key={doc.id} className={cx('doc-row', selectedIds.has(doc.id) && 'batch-selected')} onClick={() => onOpen(doc.id)}>
                  <td className="batch-selection-cell" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={t('选择文献：{0}', [doc.title])} checked={selectedIds.has(doc.id)} onChange={() => selection.toggle(doc.id)} /></td>
                  <td className="cell-title">
                    <div className="cell-title-inner">
                      <button
                        className={cx('icon-btn star-btn', doc.starred && 'starred')}
                        title={doc.starred ? t("取消星标") : t("设为星标")}
                        onClick={(event) => {
                          event.stopPropagation()
                          void toggleStar(doc)
                        }}
                      >
                        <Star size={14} fill={doc.starred ? 'currentColor' : 'none'} />
                      </button>
                      {doc.sourceFormat === 'web' && <span className="web-source-label" title={doc.url}><Globe size={13} /></span>}
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
                          {t(STATUS_LABEL[status])}
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
                      <button className="icon-btn tiny" title={t('在新窗口打开')} onClick={() => void window.api.app.newWindow(doc.id).catch((err: Error) => notify(err.message, 'error'))}>
                        <ExternalLink size={14} />
                      </button>
                      <button className="icon-btn tiny" title={t("加入分类")} onClick={() => setPickerDoc(doc)}>
                        <FolderPlus size={14} />
                      </button>
                      <button className="icon-btn tiny" title={t("与文献对话")} onClick={() => void onChat(doc.id)}>
                        <MessageSquare size={14} />
                      </button>
                      <button className="icon-btn tiny" title={t("删除文献")} onClick={() => void remove(doc)}>
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <LibraryPagination total={documents.length} page={currentPage} pageSize={pageSize} onPage={page => setPagination({ scope, page: Math.min(Math.max(1, totalPages), Math.max(1, page)) })} onPageSize={changePageSize} />

        </section>
      </div>
      {newFolder && <FolderEditor collections={data.collections} parentId={activeCollection} onClose={() => setNewFolder(false)} onChanged={onChanged} />}
      {saveViewOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSaveViewOpen(false)}>
          <div className="modal save-view-modal">
            <div className="modal-head">
              <div>
                <h3>{t("保存视图")}</h3>
                <p className="muted">{t("保存当前筛选、排序与属性条件，之后可在左侧栏一键恢复。")}</p>
              </div>
              <button className="icon-btn" title={t("关闭")} onClick={() => setSaveViewOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="field">
              <label>{t("视图名称")}</label>
              <input
                autoFocus
                value={saveViewName}
                onChange={(event) => setSaveViewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveView()
                }}
                placeholder={t("例如：未读方法学文献")}
              />
            </div>
            <div className="modal-foot">
              <div className="muted small">{t("视图保存在本机文献库中")}</div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setSaveViewOpen(false)}>
                  {' '}{t("取消")}{' '}</button>
                <button className="btn primary" onClick={() => void saveView()} disabled={!saveViewName.trim()}>
                  {' '}{t("保存")}{' '}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {batchEditing && <DocumentBatchDialog count={selection.ids.length} collections={data.collections} onClose={() => setBatchEditing(false)} onSave={async patch => {
        const count = await window.api.library.batchUpdate(selection.ids, patch)
        selection.clear()
        await onChanged()
        notify(t('已更新 {0} 篇文献', [count]), 'success')
      }} />}
      {deleting && <BatchDeleteDialog titles={deleting.map(doc => doc.title)} kind="documents" onClose={() => setDeleting(null)} onConfirm={async () => {
        const count = await window.api.library.batchRemove(deleting.map(doc => doc.id))
        selection.clear()
        await onChanged()
        notify(t('已删除 {0} 篇文献', [count]), 'success')
      }} />}
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
