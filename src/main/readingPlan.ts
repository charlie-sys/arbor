import { completeText } from './llm'
import { store, uid } from './store'
import type { LibraryData, ReadingPlan, ReadingPlanItem } from '../shared/types'
import { outputLanguageName, t } from '../shared/i18n'

interface RawItem {
  docId?: unknown
  focus?: unknown
  questions?: unknown
  order?: unknown
}

function parseItems(raw: string): RawItem[] {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error(t("模型返回的阅读计划不是有效 JSON 数组"))
  let data: unknown
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error(t("模型返回的阅读计划解析失败"))
  }
  if (!Array.isArray(data)) throw new Error(t("模型返回的阅读计划格式不正确"))
  return data.filter((item): item is RawItem => !!item && typeof item === 'object')
}

async function buildPayload(data: LibraryData): Promise<string> {
  const parts: string[] = []
  for (const doc of data.documents.slice(0, 20)) {
    const pages = await store.getDocumentTexts(doc.id)
    const sample = pages.slice(0, 2).join('\n').replace(/\s+/g, ' ').slice(0, 900)
    parts.push(
      JSON.stringify({
        docId: doc.id,
        title: doc.title,
        authors: doc.authors,
        year: doc.year,
        abstract: doc.abstract.slice(0, 500),
        sample
      })
    )
  }
  return `[${parts.join(',')}]`
}

export async function generateReadingPlan(goal: string): Promise<ReadingPlan> {
  const trimmedGoal = goal.trim()
  if (!trimmedGoal) throw new Error(t("请先填写学习目标"))
  const settings = store.data.settings
  if (!settings.apiKey) throw new Error(t("尚未配置 API Key，请打开「设置」完成配置"))
  if (!store.data.documents.length) throw new Error(t("文献库还没有文献，请先导入 PDF"))

  const docs = await buildPayload(store.data)
  const prompt = t("用户的学习目标是：「{0}」。\n\n下面是文献库中的文献信息（JSON 数组）。请据此生成一份{2}阅读计划：\n1. 从这些文献中挑选最相关的 1-20 篇，按推荐阅读顺序排列；\n2. 为每篇给出阅读关注点（focus，1-2 句，说明该文献在实现学习目标中的作用）；\n3. 为每篇给出 2-4 个阅读时思考的问题（questions）；\n4. docId 必须直接取自输入，不得编造；\n5. 不要输出解释，只输出 JSON 数组，元素格式：\n{\"docId\":\"...\",\"order\":1,\"focus\":\"...\",\"questions\":[\"...\",\"...\"]}\n\n{1}", [trimmedGoal, docs, outputLanguageName()])

  const raw = await completeText(
    [
      { role: 'system', content: t("你是严谨的学术阅读规划助手，严格只输出 JSON，不输出任何解释。") },
      { role: 'user', content: prompt }
    ],
    { temperature: 0.3, kind: 'plan' }
  )

  const known = new Map(store.data.documents.map((doc) => [doc.id, doc]))
  const seen = new Set<string>()
  const items: ReadingPlanItem[] = []
  for (const rawItem of parseItems(raw)) {
    const docId = typeof rawItem.docId === 'string' ? rawItem.docId : ''
    if (!known.has(docId) || seen.has(docId)) continue
    seen.add(docId)
    const focus = typeof rawItem.focus === 'string' ? rawItem.focus.trim() : ''
    const questions = Array.isArray(rawItem.questions)
      ? rawItem.questions.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim())
      : []
    const order = typeof rawItem.order === 'number' && Number.isFinite(rawItem.order) ? rawItem.order : items.length + 1
    items.push({ docId, order, focus, questions })
  }
  if (!items.length) throw new Error(t("模型未返回有效的阅读计划"))

  items.sort((a, b) => a.order - b.order)
  return {
    id: uid(),
    goal: trimmedGoal,
    items,
    model: settings.chatModel,
    createdAt: Date.now()
  }
}
