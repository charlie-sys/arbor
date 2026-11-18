import { useState } from 'react'
import type { Collection } from '@shared/types'
import type { DocumentBatchPatch } from '@shared/batch'
import { t } from '@shared/i18n'
import { collectionPath } from '@shared/collections'
import './batch.css'

type Mode = '' | 'add' | 'remove' | 'replace' | 'clear'
export default function DocumentBatchDialog({ count, collections, onClose, onSave }: {
  count: number; collections: Collection[]; onClose(): void; onSave(patch: DocumentBatchPatch): Promise<void>
}) {
  const [status, setStatus] = useState('')
  const [star, setStar] = useState('')
  const [mode, setMode] = useState<Mode>('')
  const [chosen, setChosen] = useState<string[]>([])
  const [tagMode, setTagMode] = useState<Mode>('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const tagValues = [...new Set(tags.split(/[,，\n]/).map(value => value.trim()).filter(Boolean))]
  const valid = !!(status || star || mode || tagMode) && (!mode || mode === 'clear' || chosen.length > 0) && (!tagMode || tagMode === 'clear' || tagValues.length > 0)
  const modes = <><option value="">{t('保持不变')}</option><option value="add">{t('追加')}</option><option value="remove">{t('移除')}</option><option value="replace">{t('替换全部')}</option><option value="clear">{t('清空')}</option></>
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || busy) return
    const patch: DocumentBatchPatch = {}
    if (status) patch.readingStatus = status as DocumentBatchPatch['readingStatus']
    if (star) patch.starred = star === 'yes'
    if (mode) patch.collections = { mode: mode === 'clear' ? 'replace' : mode, ids: mode === 'clear' ? [] : chosen }
    if (tagMode) patch.tags = { mode: tagMode === 'clear' ? 'replace' : tagMode, values: tagMode === 'clear' ? [] : tagValues }
    setBusy(true)
    try { await onSave(patch); onClose() } catch (err) { setError((err as Error).message); setBusy(false) }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <form className="modal batch-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-edit-title" onSubmit={event => void save(event)}>
      <div className="modal-head"><h3 id="batch-edit-title">{t('批量修改 {0} 篇文献', [count])}</h3></div>
      <fieldset className="batch-dialog-body" disabled={busy} style={{ border: 0, margin: 0 }}>
        <label className="batch-field">{t('阅读状态')}<select className="select" aria-label={t('批量阅读状态')} value={status} onChange={event => setStatus(event.target.value)}><option value="">{t('保持不变')}</option><option value="unread">{t('未读')}</option><option value="reading">{t('在读')}</option><option value="read">{t('已读')}</option></select></label>
        <label className="batch-field">{t('星标')}<select className="select" value={star} onChange={event => setStar(event.target.value)}><option value="">{t('保持不变')}</option><option value="yes">{t('设为星标')}</option><option value="no">{t('取消星标')}</option></select></label>
        <label className="batch-field">{t('分类')}<select className="select" aria-label={t('批量分类操作')} value={mode} onChange={event => setMode(event.target.value as Mode)}>{modes}</select></label>
        {mode && mode !== 'clear' && <div className="batch-collection-list">{collections.length ? collections.map(collection => <label key={collection.id}><input type="checkbox" checked={chosen.includes(collection.id)} onChange={() => setChosen(previous => previous.includes(collection.id) ? previous.filter(id => id !== collection.id) : [...previous, collection.id])} />{collectionPath(collections, collection.id)}</label>) : <p className="muted small">{t('请先在侧栏新建分类')}</p>}</div>}
        {mode === 'replace' && <p className="muted small">{t('将用所选分类替换每篇文献原有的全部分类。')}</p>}
        <label className="batch-field">{t('标签')}<select className="select" aria-label={t('批量标签操作')} value={tagMode} onChange={event => setTagMode(event.target.value as Mode)}>{modes}</select></label>
        {tagMode && tagMode !== 'clear' && <input className="input" aria-label={t('批量标签')} placeholder={t('多个标签用逗号分隔')} value={tags} onChange={event => setTags(event.target.value)} />}
        {error && <div role="alert">{error}</div>}
      </fieldset>
      <div className="modal-foot"><button className="btn ghost" type="button" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="btn primary" type="submit" disabled={busy || !valid}>{busy ? t('保存中…') : t('应用修改')}</button></div>
    </form>
  </div>
}
