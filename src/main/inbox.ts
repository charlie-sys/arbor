import { store } from './store'
import { fetchWithRetry } from './http'
import { usage, usageFromApi } from './usage'
import { estimateTokens } from '../shared/usage'
import type { InboxSuggestion, InboxSuggestionType } from '../shared/types'
import { outputLanguageName, t } from '../shared/i18n'

const SUGGESTION_TYPES: InboxSuggestionType[] = ['tag', 'collection', 'excerpt', 'task']

function endpoint(base: string): string {
  let b = base.trim().replace(/\/+$/, '')
  if (!b) throw new Error(t("请先在设置中填写 API Base URL"))
  if (b.endsWith('/chat/completions')) b = b.slice(0, -'/chat/completions'.length)
  if (!/\/v\d+[a-z0-9.-]*$/i.test(b)) b += '/v1'
  return `${b}/chat/completions`
}

function parseSuggestions(raw: string, inboxIds: Set<string>): InboxSuggestion[] {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '')
  }
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error(t("模型返回的整理建议不是有效 JSON 数组"))
  let data: unknown
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error(t("模型返回的整理建议解析失败"))
  }
  if (!Array.isArray(data)) throw new Error(t("模型返回的整理建议格式不正确"))
  const seen = new Set<string>()
  const result: InboxSuggestion[] = []
  for (const entry of data as Record<string, unknown>[]) {
    const inboxId = typeof entry?.inboxId === 'string' ? entry.inboxId : ''
    const type = entry?.type as InboxSuggestionType
    const value = typeof entry?.value === 'string' ? entry.value.trim() : ''
    if (!inboxIds.has(inboxId) || !SUGGESTION_TYPES.includes(type) || !value) continue
    const key = `${inboxId}:${type}:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    const suggestion: InboxSuggestion = { inboxId, type, value }
    if (typeof entry.reason === 'string' && entry.reason.trim()) suggestion.reason = entry.reason.trim().slice(0, 200)
    result.push(suggestion)
    if (result.length >= 30) break
  }
  return result
}

export async function suggestInboxOrganization(): Promise<InboxSuggestion[]> {
  const settings = store.data.settings
  if (!settings.apiKey) throw new Error(t("尚未配置 API Key，请打开「设置」完成配置"))
  if (!settings.chatModel) throw new Error(t("尚未配置对话模型，请打开「设置」完成配置"))

  const items = store
    .getInbox()
    .filter((item) => !item.archived)
    .slice(0, 20)
  if (!items.length) return []

  const payload = items.map((item) => ({
    inboxId: item.id,
    kind: item.kind,
    title: item.title,
    content: item.content.slice(0, 1200),
    docId: item.docId ?? null
  }))

  const prompt = t("下面是用户的收件箱条目（JSON）。请为每条内容建议归类方式，type 只能取：\n- \"tag\"：建议一个简短标签名（value 为标签名，不加 #）\n- \"collection\"：建议一个文献分类名（value 为分类名）\n- \"excerpt\"：建议把内容沉淀为摘录（value 为摘录来源，如\"原文摘录\"）\n- \"task\"：建议一个可执行任务标题（value 为任务标题）\n\n只对确实合适的条目给出建议，每条最多 2 条建议；不要编造文献信息。reason 用一句{1}说明。\n只输出 JSON 数组，格式：[{\"inboxId\":\"...\",\"type\":\"tag\",\"value\":\"...\",\"reason\":\"...\"}]\n\n{0}", [JSON.stringify(payload), outputLanguageName()])

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
        temperature: 0.2,
        stream: false,
        messages: [
          { role: 'system', content: t("你是学术知识管理助手，严格只输出 JSON，不输出解释。") },
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
      kind: 'inbox',
      model: settings.chatModel,
      promptTokens: fromApi?.promptTokens ?? estimateTokens(prompt),
      completionTokens: fromApi?.completionTokens ?? estimateTokens(raw),
      ...(fromApi?.cachedTokens !== undefined ? { cachedTokens: fromApi.cachedTokens } : {}),
      estimated: !fromApi
    })
    if (!raw.trim()) throw new Error(t("模型未返回整理建议"))
    return parseSuggestions(raw, new Set(items.map((item) => item.id)))
  } catch (err) {
    if (controller.signal.aborted) throw new Error(t("AI 整理请求超时"))
    throw err
  } finally {
    clearTimeout(timer)
  }
}
