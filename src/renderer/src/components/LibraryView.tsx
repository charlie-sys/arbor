import { useMemo, useState } from 'react'
import { BookOpen, FileText, FolderPlus, Loader2, MessageSquare, Search, Star, Trash2, Upload } from 'lucide-react'
import type { DocumentMeta, LibraryData } from '@shared/types'
import CollectionPicker from './CollectionPicker'
import { cx, formatTime } from '../ui'

interface Props {
  data: LibraryData
  collectionId?: string
  importing: { done: number; total: number } | null
  onOpen(docId: string): void
  onChat(docId: string): Promise<void> | void
  onImport(): void
  onChanged(): Promise<void> | void
  onClearCollection(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

type SortKey = 'recent' | 'title' | 'year'

export default function LibraryView({
  data,
  collectionId,
  importing,
  onOpen,
  onChat,
  onImport,
  onChanged,
  onClearCollection,
  notify
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [starredOnly, setStarredOnly] = useState(false)
  const [pickerDoc, setPickerDoc] = useState<DocumentMeta | null>(null)

  const activeCollection = collectionId
  const collectionName = data.collections.find((collection) => collection.id === activeCollection)?.name
  const collectionHasDocs = activeCollection
    ? data.documents.some((doc) => doc.collections.includes(activeCollection))
    : false

  const documents = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    let list = data.documents.filter((doc) => {
      if (activeCollection && !doc.collections.includes(activeCollection)) return false
      if (starredOnly && !doc.starred) return false
      if (!keyword) return true
      return (
        doc.title.toLowerCase().includes(keyword) ||
        doc.authors.toLowerCase().includes(keyword) ||
        doc.journal.toLowerCase().includes(keyword) ||
        doc.abstract.toLowerCase().includes(keyword) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(keyword))
      )
    })
    list = [...list].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN')
      if (sort === 'year') return (b.year || '0').localeCompare(a.year || '0')
      return b.addedAt - a.addedAt
    })
    return list
  }, [data.documents, query, sort, starredOnly, activeCollection])

  const toggleStar = async (doc: DocumentMeta): Promise<void> => {
    await window.api.library.update(doc.id, { starred: !doc.starred })
    await onChanged()
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
        <select className="select" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
          <option value="recent">最近添加</option>
          <option value="title">按标题</option>
          <option value="year">按年份</option>
        </select>
        <button className={cx('btn ghost', starredOnly && 'active')} onClick={() => setStarredOnly((value) => !value)}>
          <Star size={15} fill={starredOnly ? 'currentColor' : 'none'} /> 星标
        </button>
        {activeCollection && (
          <button className="chip-button" onClick={onClearCollection}>
            分类：{collectionName} ×
          </button>
        )}
      </div>

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
              ? '导入 PDF 后，ZotAgent 会自动提取全文，用于阅读、检索、问答和翻译。'
              : activeCollection && !collectionHasDocs
                ? '在文献卡片上点击「分类」按钮，即可把文献加入该分类。'
                : '试试更换关键词，或清除分类与星标筛选。'}
          </p>
          {data.documents.length === 0 && (
            <button className="btn primary" onClick={onImport}>
              <Upload size={16} /> 导入 PDF 文献
            </button>
          )}
          {data.documents.length > 0 && activeCollection && !collectionHasDocs && (
            <button className="btn" onClick={onClearCollection}>
              查看全部文献
            </button>
          )}
        </div>
      ) : (
        <div className="doc-list">
          {documents.map((doc) => (
            <div className="doc-card" key={doc.id} onClick={() => onOpen(doc.id)}>
              <button
                className={cx('icon-btn star-btn', doc.starred && 'starred')}
                title={doc.starred ? '取消星标' : '设为星标'}
                onClick={(event) => {
                  event.stopPropagation()
                  void toggleStar(doc)
                }}
              >
                <Star size={16} fill={doc.starred ? 'currentColor' : 'none'} />
              </button>

              <div className="doc-main">
                <div className="doc-title">{doc.title}</div>
                <div className="doc-meta">
                  {[doc.authors, doc.year, doc.journal].filter(Boolean).join(' · ') || '未填写作者 / 年份 / 期刊'}
                </div>
                {doc.abstract && <div className="doc-abstract">{doc.abstract}</div>}
                <div className="doc-tags">
                  {doc.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                  {doc.collections.map((id) => {
                    const collection = data.collections.find((item) => item.id === id)
                    return collection ? (
                      <span className="tag collection-tag" key={id}>
                        {collection.name}
                      </span>
                    ) : null
                  })}
                </div>
              </div>

              <div className="doc-side">
                <div className="doc-stat">
                  <FileText size={13} />
                  {doc.pageCount > 0 ? `${doc.pageCount} 页` : '待提取文本'}
                </div>
                <div className="doc-stat">{formatTime(doc.addedAt)}</div>
                <div className="doc-actions">
                  <button
                    className="btn ghost small"
                    onClick={(event) => {
                      event.stopPropagation()
                      setPickerDoc(doc)
                    }}
                  >
                    <FolderPlus size={14} /> 分类
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={(event) => {
                      event.stopPropagation()
                      void onChat(doc.id)
                    }}
                  >
                    <MessageSquare size={14} /> 对话
                  </button>
                  <button
                    className="icon-btn"
                    title="删除文献"
                    onClick={(event) => {
                      event.stopPropagation()
                      void remove(doc)
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
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
