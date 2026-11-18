import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { t } from '@shared/i18n'
import './libraryPagination.css'

export const LIBRARY_PAGE_SIZES = [10, 20, 50, 100] as const
export const LIBRARY_PAGE_SIZE_KEY = 'arbor-library-page-size'

export function loadLibraryPageSize(): number {
  try {
    const value = Number(localStorage.getItem(LIBRARY_PAGE_SIZE_KEY))
    if ((LIBRARY_PAGE_SIZES as readonly number[]).includes(value)) return value
  } catch { /* Optional local preference. */ }
  return 20
}

export default function LibraryPagination({ total, page, pageSize, onPage, onPageSize }: {
  total: number; page: number; pageSize: number; onPage(page: number): void; onPageSize(size: number): void
}) {
  const pages = Math.ceil(total / pageSize)
  const [jump, setJump] = useState(String(pages ? page : 0))
  useEffect(() => { setJump(String(pages ? page : 0)) }, [page, total, pages])
  return <nav className="library-pagination" aria-label={t('文献分页')}>
    <span className="pagination-summary" role="status">{t('显示 {0}–{1} 条，共 {2} 条', [total ? (page - 1) * pageSize + 1 : 0, Math.min(page * pageSize, total), total])}</span>
    <label className="pagination-size"><span>{t('每页条数')}</span><select className="select small" aria-label={t('每页条数')} value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>
      {LIBRARY_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
    </select></label>
    <div className="pagination-buttons">
      <button className="icon-btn" disabled={!total || page <= 1} title={t('第一页')} aria-label={t('第一页')} onClick={() => onPage(1)}><ChevronsLeft size={16} /></button>
      <button className="icon-btn" disabled={!total || page <= 1} title={t('上一页')} aria-label={t('上一页')} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
      <span className="pagination-pages" data-testid="library-page-count">{t('第 {0} / {1} 页', [pages ? page : 0, pages])}</span>
      <button className="icon-btn" disabled={!total || page >= pages} title={t('下一页')} aria-label={t('下一页')} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
      <button className="icon-btn" disabled={!total || page >= pages} title={t('最后一页')} aria-label={t('最后一页')} onClick={() => onPage(pages)}><ChevronsRight size={16} /></button>
    </div>
    <form className="pagination-jump" noValidate onSubmit={event => {
      event.preventDefault()
      const value = Number(jump)
      if (!pages) return
      const target = Number.isSafeInteger(value) ? Math.min(pages, Math.max(1, value)) : page
      setJump(String(target)); onPage(target)
    }}>
      <label htmlFor="library-jump-page">{t('跳转到')}</label>
      <input id="library-jump-page" className="input" type="number" inputMode="numeric" min={1} max={pages || 1} step={1} disabled={!total} aria-label={t('跳转页码')} value={jump} onChange={event => setJump(event.target.value)} />
      <button className="btn ghost small" type="submit" disabled={!total}>{t('跳转')}</button>
    </form>
  </nav>
}
