import { store } from './store'
import { fetchWithRetry } from './http'
import { usage, usageFromApi } from './usage'
import { estimateTokens } from '../shared/usage'
import type { ResearchTopic } from '../shared/types'
import { outputLanguageName, t } from '../shared/i18n'

function endpoint(base: string): string {
  let b = base.trim().replace(/\/+$/, '')
  if (!b) throw new Error(t("请先在设置中填写 API Base URL"))
  if (b.endsWith('/chat/completions')) b = b.slice(0, -'/chat/completions'.length)
  if (!/\/v\d+[a-z0-9.-]*$/i.test(b)) b += '/v1'
  return `${b}/chat/completions`
}

function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[\s，。！？、；：,.!?;:'"“”‘’()（）]/g, '')
}

export function dedupeQuestions(values: string[], limit = 8): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const text = raw.trim().replace(/^\d+[.、]\s*/, '')
    if (text.length < 6) continue
    const key = normalizeQuestion(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

function parseQuestions(raw: string): string[] {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '')
  }
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error(t("模型返回的建议问题不是有效 JSON 数组"))
  let data: unknown
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error(t("模型返回的建议问题解析失败"))
  }
  if (!Array.isArray(data)) throw new Error(t("模型返回的建议问题格式不正确"))
  const values = data.filter((item): item is string => typeof item === 'string')
  return dedupeQuestions(values)
}

async function buildDocPayload(topic: ResearchTopic): Promise<string> {
  const parts: string[] = []
  for (const docId of topic.docIds) {
    const doc = store.getDocument(docId)
    if (!doc) continue
    const pages = await store.getDocumentTexts(docId)
    const sample = pages.slice(0, 3).join('\n').replace(/\s+/g, ' ').slice(0, 1800)
    parts.push(
      JSON.stringify({
        title: doc.title,
        authors: doc.authors,
        year: doc.year,
        abstract: doc.abstract.slice(0, 600),
        sample
      })
    )
  }
  return `[${parts.join(',')}]`
}

export async function suggestTopicQuestions(topicId: string): Promise<string[]> {
  const topic = store.data.researchTopics.find((item) => item.id === topicId)
  if (!topic) throw new Error(t("研究主题不存在"))
  if (topic.docIds.length < 1) throw new Error(t("该主题还没有成员文献"))
  const settings = store.data.settings
  if (!settings.apiKey) throw new Error(t("尚未配置 API Key，请打开「设置」完成配置"))
  if (!settings.chatModel) throw new Error(t("尚未配置对话模型，请打开「设置」完成配置"))

  const docs = await buildDocPayload(topic)
  const prompt = t("下面是用户研究主题「{0}」的成员文献信息（JSON）。请基于各文献的摘要与前几页内容，生成 5-6 个{2}研究问题，要求：\n1. 必须与文献内容直接相关，覆盖共同主题、方法差异、结论对比、研究空白等角度；\n2. 每个问题互不重复，避免泛泛而谈；\n3. 不要编造文献中没有的信息，不要输出序号或解释。\n只输出 JSON 字符串数组，例如：[\"问题一？\",\"问题二？\"]\n\n{1}", [topic.name, docs, outputLanguageName()])

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  try {
    const res = await fetchWithRetry(endpoint(settings.apiBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.chatModel,
        temperature: 0.4,
        stream: false,
        messages: [
          { role: 'system', content: t("你是严谨的学术研究助手，严格只输出 JSON，不输出解释。") },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    })
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
    const content = json?.choices?.[0]?.message?.content
    const raw = typeof content === 'string' ? content : ''
    const fromApi = usageFromApi(json)
    usage.add({
      kind: 'topic',
      model: settings.chatModel,
      promptTokens: fromApi?.promptTokens ?? estimateTokens(prompt),
      completionTokens: fromApi?.completionTokens ?? estimateTokens(raw),
      ...(fromApi?.cachedTokens !== undefined ? { cachedTokens: fromApi.cachedTokens } : {}),
      estimated: !fromApi
    })
    if (!raw.trim()) throw new Error(t("模型未返回建议问题"))
    const questions = parseQuestions(raw)
    if (!questions.length) throw new Error(t("模型未返回有效的建议问题"))
    await store.updateResearchTopic(topic.id, { questions })
    return questions
  } catch (err) {
    if (controller.signal.aborted) throw new Error(t("生成建议问题超时"))
    throw err
  } finally {
    clearTimeout(timer)
  }
}
