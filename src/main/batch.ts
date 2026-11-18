import { store } from './store'
import { removeAnnotations } from './annotationStore'
import { cancelChats } from './llm'
import type { DocumentBatchPatch } from '../shared/batch'
import type { DocumentMeta } from '../shared/types'
import { t } from '../shared/i18n'

function idsFrom(input: string[]): string[] {
  if (!Array.isArray(input) || input.some(id => typeof id !== 'string')) throw new Error(t('批量操作参数无效'))
  return [...new Set(input)]
}

function merge(current: string[], values: string[], mode: 'add' | 'remove' | 'replace'): string[] {
  if (mode === 'replace') return [...new Set(values)]
  if (mode === 'remove') return current.filter(value => !values.includes(value))
  return [...new Set([...current, ...values])]
}

export async function updateDocuments(input: string[], patch: DocumentBatchPatch): Promise<number> {
  const ids = idsFrom(input)
  if (!patch || typeof patch !== 'object') throw new Error(t('批量操作参数无效'))
  if (patch.readingStatus !== undefined && !['unread', 'reading', 'read'].includes(patch.readingStatus)) throw new Error(t('批量操作参数无效'))
  if (patch.starred !== undefined && typeof patch.starred !== 'boolean') throw new Error(t('批量操作参数无效'))
  for (const change of [patch.collections, patch.tags]) {
    if (change && !['add', 'remove', 'replace'].includes(change.mode)) throw new Error(t('批量操作参数无效'))
  }
  if (patch.collections && (!Array.isArray(patch.collections.ids) || patch.collections.ids.some(id => !store.data.collections.some(c => c.id === id)))) throw new Error(t('分类不存在，请刷新后重试'))
  if (patch.tags && (!Array.isArray(patch.tags.values) || patch.tags.values.some(value => typeof value !== 'string' || !value.trim()))) throw new Error(t('批量操作参数无效'))
  const selected = new Set(ids)
  const docs = store.data.documents.filter(doc => selected.has(doc.id))
  for (const doc of docs) {
    const next: Partial<DocumentMeta> = {}
    if (patch.readingStatus !== undefined) next.readingStatus = patch.readingStatus
    if (patch.starred !== undefined) next.starred = patch.starred
    if (patch.collections) next.collections = merge(doc.collections, patch.collections.ids, patch.collections.mode)
    if (patch.tags) next.tags = merge(doc.tags, patch.tags.values.map(value => value.trim()), patch.tags.mode)
    await store.updateDocument(doc.id, next, false)
  }
  if (docs.length) await store.save()
  return docs.length
}

export async function deleteDocuments(input: string[]): Promise<number> {
  const ids = idsFrom(input).filter(id => !!store.getDocument(id))
  try {
    for (const id of ids) {
      await store.deleteDocument(id, false)
      await removeAnnotations(id)
    }
  } finally { if (ids.length) await store.save() }
  return ids.length
}

export async function deleteChats(input: string[]): Promise<number> {
  const ids = idsFrom(input).filter(id => !!store.getChat(id))
  cancelChats(ids)
  try { for (const id of ids) await store.deleteChat(id, false) }
  finally { if (ids.length) await store.save() }
  return ids.length
}
