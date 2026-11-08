import { store } from './store'
import type { ChatContext } from '../shared/types'
import { t } from '../shared/i18n'

interface Chunk {
  page: number
  order: number
  text: string
  score: number
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function queryTerms(query: string): string[] {
  const terms = new Set<string>()
  const lower = query.toLowerCase()
  for (const word of lower.match(/[a-z][a-z0-9-]{2,}/g) ?? []) terms.add(word)
  const cjk = lower.replace(/[^\u4e00-\u9fff]/g, ' ')
  for (const run of cjk.split(/\s+/)) {
    for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2))
  }
  return [...terms]
}

function splitPage(text: string, maxLen: number): string[] {
  const clean = normalize(text)
  if (clean.length <= maxLen) return clean ? [clean] : []
  const parts: string[] = []
  let cursor = 0
  while (cursor < clean.length) {
    let end = Math.min(clean.length, cursor + maxLen)
    if (end < clean.length) {
      const breakAt = clean.lastIndexOf(' ', end)
      const sentence = Math.max(clean.lastIndexOf('. ', end), clean.lastIndexOf('。', end), clean.lastIndexOf('！', end), clean.lastIndexOf('？', end))
      if (sentence > cursor + maxLen * 0.55) end = sentence + 1
      else if (breakAt > cursor + maxLen * 0.7) end = breakAt
    }
    parts.push(clean.slice(cursor, end).trim())
    cursor = end
  }
  return parts.filter(Boolean)
}

function scoreChunk(text: string, terms: string[]): number {
  if (!terms.length) return 0
  const lower = text.toLowerCase()
  let score = 0
  for (const term of terms) {
    let from = 0
    let hits = 0
    while (hits < 8) {
      const idx = lower.indexOf(term, from)
      if (idx === -1) break
      hits++
      from = idx + term.length
    }
    score += hits
  }
  return score / Math.sqrt(Math.max(40, text.length / 40))
}

export function resolveContextBudget(chars: number | undefined, cap = Number.POSITIVE_INFINITY): number {
  const value =
    typeof chars === 'number' && Number.isFinite(chars) && chars > 0 ? chars : Number.POSITIVE_INFINITY
  return Math.min(value, cap)
}

export async function buildContext(
  docIds: string[],
  query: string,
  budget: number,
  options?: ChatContext
): Promise<{ context: string; usedDocIds: string[] }> {
  if (options?.contextMode === 'none') return { context: '', usedDocIds: [] }
  const docs = docIds.map((id) => store.getDocument(id)).filter((d): d is NonNullable<ReturnType<typeof store.getDocument>> => !!d)
  if (!docs.length) return { context: '', usedDocIds: [] }

  const totalBudget = resolveContextBudget(budget)
  const perDocBudget = Math.max(
    3000,
    Math.floor((totalBudget - (options?.contextMode === 'selection' ? options.selection?.trim().length ?? 0 : 0)) / docs.length)
  )
  const terms = queryTerms(query)
  const blocks: string[] = []
  const usedDocIds: string[] = []

  if (options?.contextMode === 'selection' && options.selection?.trim()) {
    const selPage = options.page ? t("（第 {0} 页）", [options.page]) : ''
    blocks.push(t("===== 用户选中的原文{0}（最高优先级，回答必须依据此段） =====\n{1}", [selPage, options.selection.trim()]))
  }

  const pageMode = options?.contextMode === 'page' ? Math.max(1, Math.round(options.page ?? 1)) : null

  for (const doc of docs) {
    const pages = await store.getDocumentTexts(doc.id)
    if (!pages.length) continue

    const info = [doc.authors, doc.year, doc.journal].filter(Boolean).join(' · ')
    const header = t("===== 文献：《{0}》{1} =====", [doc.title, info ? t('（{0}）', [info]) : ''])

    if (options?.includeNotes && doc.notes.trim()) {
      blocks.push(t("{0}\n【文献笔记】\n{1}", [header, doc.notes.trim()]))
    }

    if (pageMode !== null) {
      const pageText = pages[pageMode - 1]
      if (!pageText) continue
      blocks.push(t("{0}\n[第{1}页] {2}", [header, pageMode, normalize(pageText)]))
      usedDocIds.push(doc.id)
      continue
    }

    const chunks: Chunk[] = []
    pages.forEach((pageText, pageIndex) => {
      splitPage(pageText, 1400).forEach((text, order) => {
        chunks.push({ page: pageIndex + 1, order, text, score: scoreChunk(text, terms) })
      })
    })
    if (!chunks.length) continue

    const totalLen = chunks.reduce((sum, c) => sum + c.text.length, 0)
    let selected: Chunk[]
    if (totalLen <= perDocBudget) {
      selected = chunks
    } else {
      selected = [...chunks].sort((a, b) => b.score - a.score).slice(0, Math.max(2, Math.ceil(perDocBudget / 1300)))
      selected.sort((a, b) => a.page - b.page || a.order - b.order)
      let len = 0
      const kept: Chunk[] = []
      for (const chunk of selected) {
        if (len + chunk.text.length > perDocBudget && kept.length) break
        kept.push(chunk)
        len += chunk.text.length
      }
      selected = kept
    }

    const body = selected.map((c) => t("[第{0}页] {1}", [c.page, c.text])).join('\n')
    blocks.push(`${header}\n${body}`)
    usedDocIds.push(doc.id)
  }

  return { context: blocks.join('\n\n'), usedDocIds }
}

export async function buildChatTranscript(chatId: string, limit = 40000): Promise<string> {
  const chat = store.getChat(chatId)
  if (!chat) return ''
  const lines: string[] = []
  for (const msg of chat.messages) {
    if (msg.role === 'system') continue
    if (msg.role === 'assistant' && msg.error) continue
    const label = msg.role === 'user' ? t("用户") : t("助手")
    lines.push(t('{0}：{1}', [label, msg.content]))
  }
  let text = lines.join('\n\n')
  if (text.length > limit) text = text.slice(text.length - limit)
  return text
}
