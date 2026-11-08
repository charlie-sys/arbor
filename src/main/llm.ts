import { promises as fs } from 'fs'
import path from 'path'
import { store } from './store'
import { fetchWithRetry } from './http'
import { isSpreadsheetFile, spreadsheetToText } from './spreadsheet'
import { buildChatTranscript, buildContext } from './context'
import { ChatArtifactParser, chatArtifactPrompt } from './chatArtifacts'
import type { ChatRequest, InboxAttachment, UsageKind } from '../shared/types'
import { estimateTokens } from '../shared/usage'
import { usage, usageFromApi } from './usage'
import { DEFAULT_COMPOSE_SCOPE, defaultComposeOutline } from '../shared/compose'
import type { ComposeScope } from '../shared/compose'

const controllers = new Map<string, AbortController>()

function endpoint(base: string, path: string): string {
  let b = base.trim().replace(/\/+$/, '')
  if (!b) throw new Error('请先在设置中填写 API Base URL')
  if (b.endsWith('/chat/completions')) b = b.slice(0, -'/chat/completions'.length)
  if (!/\/v\d+[a-z0-9.-]*$/i.test(b)) b += '/v1'
  return `${b}/${path}`
}

function contentOf(json: any): string {
  const content = json?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('')
  }
  return ''
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : typeof (part as { text?: unknown })?.text === 'string' ? String((part as { text: string }).text) : ''))
      .join('\n')
  }
  return ''
}

function estimatePromptTokens(messages: unknown[]): number {
  return estimateTokens(messages.map((message) => contentToText((message as { content?: unknown })?.content)).join('\n'))
}

function recordJsonUsage(
  kind: UsageKind,
  model: string,
  json: unknown,
  promptText: string,
  completionText: string
): void {
  const fromApi = usageFromApi(json)
  usage.add({
    kind,
    model,
    promptTokens: fromApi?.promptTokens ?? estimateTokens(promptText),
    completionTokens: fromApi?.completionTokens ?? estimateTokens(completionText),
    ...(fromApi?.cachedTokens !== undefined ? { cachedTokens: fromApi.cachedTokens } : {}),
    estimated: !fromApi
  })
}

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c',
  '.cpp', '.h', '.hpp', '.tex', '.bib', '.log', '.ini', '.toml'
])

function attachmentMime(extension: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  }
  return map[extension.toLowerCase()] ?? 'application/octet-stream'
}

async function buildModelMessage(
  message: ChatRequest['messages'][number],
  chatId: string,
  includeImages: boolean
): Promise<{ role: 'user' | 'assistant'; content: string | unknown[] }> {
  if (!message.attachments?.length || message.role !== 'user') {
    return { role: message.role, content: message.content }
  }
  let text = message.content
  const parts: unknown[] = []
  for (const attachment of message.attachments) {
    const filePath = path.join(store.attachmentsDir, chatId, attachment.file)
    const extension = path.extname(attachment.file)
    if (attachment.kind === 'image' && includeImages) {
      try {
        const data = await fs.readFile(filePath)
        if (data.length <= 8 * 1024 * 1024) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${attachmentMime(extension)};base64,${data.toString('base64')}` }
          })
        }
        text += `\n\n[图片附件：${attachment.name}]`
        continue
      } catch {
        // 图片读取失败时退化为文件名提示
      }
    }
    if (isSpreadsheetFile(attachment.file)) {
      try {
        const table = await spreadsheetToText(filePath)
        text += `\n\n【表格附件 ${attachment.name}】\n${table}`
        continue
      } catch {
        // 解析失败时只保留附件名
      }
    }
    if (TEXT_ATTACHMENT_EXTENSIONS.has(extension.toLowerCase())) {
      try {
        const content = await fs.readFile(filePath, 'utf8')
        text += `\n\n【附件 ${attachment.name}】\n${content.slice(0, 12000)}`
        continue
      } catch {
        // 读取失败时只保留附件名
      }
    }
    text += `\n\n[附件：${attachment.name}]`
  }
  if (!parts.length) return { role: message.role, content: text }
  return { role: message.role, content: [{ type: 'text', text }, ...parts] }
}

async function buildModelMessages(
  messages: ChatRequest['messages'],
  chatId: string,
  system: string
): Promise<{ messages: unknown[]; hasImages: boolean }> {
  const sliced = messages.slice(-16)
  let lastUserIndex = -1
  sliced.forEach((message, index) => {
    if (message.role === 'user') lastUserIndex = index
  })
  const converted = []
  for (let index = 0; index < sliced.length; index += 1) {
    converted.push(await buildModelMessage(sliced[index], chatId, index === lastUserIndex))
  }
  const hasImages = converted.some((message) => Array.isArray(message.content))
  return { messages: [{ role: 'system', content: system }, ...converted], hasImages }
}


async function postJson(payload: unknown, timeoutMs = 120000, signal?: AbortSignal): Promise<any> {
  const settings = store.data.settings
  if (!settings.apiKey) throw new Error('尚未配置 API Key，请打开「设置」完成配置')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetchWithRetry(endpoint(settings.apiBaseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    return await res.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export function cancelChat(requestId: string): void {
  controllers.get(requestId)?.abort()
  controllers.delete(requestId)
}

export async function completeText(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: { temperature?: number; timeoutMs?: number; kind?: UsageKind } = {}
): Promise<string> {
  const settings = store.data.settings
  if (!settings.chatModel) throw new Error('尚未配置对话模型，请打开「设置」完成配置')
  const json = await postJson(
    {
      model: settings.chatModel,
      temperature: options.temperature ?? settings.temperature,
      stream: false,
      messages
    },
    options.timeoutMs ?? 180000
  )
  const content = contentOf(json)
  recordJsonUsage(
    options.kind ?? 'action',
    settings.chatModel,
    json,
    messages.map((message) => message.content).join('\n'),
    content
  )
  if (!content.trim()) throw new Error('模型返回了空结果')
  return content.trim()
}

export interface ChatHandlers {
  onDelta: (delta: string) => void
  onAttachment: (attachment: InboxAttachment) => void
  onDone: (content: string) => void
  onError: (message: string) => void
}

export async function streamChat(req: ChatRequest, handlers: ChatHandlers): Promise<void> {
  const settings = store.data.settings
  const controller = new AbortController()
  controllers.set(req.requestId, controller)
  let usedModel = settings.chatModel
  let promptEstimate = 0
  let apiUsage: { promptTokens: number; completionTokens: number; cachedTokens?: number } | null = null
  let outputText = ''
  let requestStartedAt = 0
  let firstTokenAt = 0
  const parser = new ChatArtifactParser(
    req.chatId,
    (name, data, kind) => store.saveChatAttachment(req.chatId, name, data, kind),
    { onText: handlers.onDelta, onAttachment: handlers.onAttachment }
  )
  try {
    if (!settings.apiKey) throw new Error('尚未配置 API Key，请打开「设置」完成配置')
    if (!settings.chatModel) throw new Error('尚未配置对话模型，请打开「设置」完成配置')

    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    let context = ''
    const chatContext = req.context ?? { contextMode: 'auto' as const }
    if (chatContext.contextMode !== 'none' && req.docIds.length) {
      const built = await buildContext(req.docIds, lastUser, settings.maxContextChars, chatContext)
      context = built.context
    }
    const mathNote =
      '输出要求：数学公式使用 LaTeX 写法，行内公式用 $...$，独立公式用 $$...$$；不要仅使用 \\( \\) 或 \\[ \\] 作为定界符。'
    const contextRule =
      chatContext.contextMode === 'selection'
        ? '以下是用户选中的原文（最高优先级）与相关文献片段，请优先依据选中原文回答，并标注其所在页码：'
        : chatContext.contextMode === 'page'
          ? '以下是用户指定的当前页原文，回答只能依据该页内容；如该页无法回答，请直接说明：'
          : '以下是检索到的文献原文片段（带页码），请严格依据这些内容回答；引用原文时标注页码：'
    const system = context
      ? `${settings.systemPrompt}\n\n${mathNote}\n\n${chatArtifactPrompt()}\n\n${contextRule}\n\n${context}`
      : `${settings.systemPrompt}\n\n${mathNote}\n\n${chatArtifactPrompt()}`
    const built = await buildModelMessages(req.messages, req.chatId, system)
    const model = built.hasImages ? settings.visionModel || settings.chatModel : settings.chatModel
    usedModel = model
    promptEstimate = estimatePromptTokens(built.messages)
    usage.begin(req.requestId, 'chat', model, promptEstimate)

    requestStartedAt = Date.now()
    const res = await fetchWithRetry(endpoint(settings.apiBaseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: settings.temperature,
        stream: true,
        stream_options: { include_usage: true },
        messages: built.messages
      }),
      signal: controller.signal
    })

    if (!res.body) throw new Error('API 未返回流式数据')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false

    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        if (payload === '[DONE]') {
          finished = true
          break
        }
        try {
          const json = JSON.parse(payload)
          const chunkUsage = usageFromApi(json)
          if (chunkUsage) apiUsage = chunkUsage
          const delta = json?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) {
            if (!firstTokenAt) firstTokenAt = Date.now()
            outputText += delta
            parser.push(delta)
          } else if (Array.isArray(delta)) {
            for (const part of delta) {
              const text = typeof part === 'string' ? part : part?.type === 'text' ? part.text : ''
              if (typeof text === 'string' && text) {
                if (!firstTokenAt) firstTokenAt = Date.now()
                outputText += text
                parser.push(text)
              }
            }
          }
          usage.progress(req.requestId, estimateTokens(outputText))
        } catch {
          // ignore malformed keep-alive lines
        }
      }
    }

    handlers.onDone(await parser.flush())
  } catch (err) {
    const partial = await parser.flush().catch(() => parser.content)
    if (controller.signal.aborted) {
      handlers.onDone(partial)
    } else {
      handlers.onError((err as Error).message || '请求失败')
    }
  } finally {
    const finishedAt = Date.now()
    if (apiUsage || outputText.trim()) {
      const firstTokenMs = firstTokenAt && requestStartedAt ? firstTokenAt - requestStartedAt : undefined
      const generationMs = firstTokenAt ? finishedAt - firstTokenAt : undefined
      usage.finish(req.requestId, {
        kind: 'chat',
        model: usedModel,
        chatId: req.chatId,
        promptTokens: apiUsage?.promptTokens ?? promptEstimate,
        completionTokens: apiUsage?.completionTokens ?? estimateTokens(outputText),
        ...(apiUsage?.cachedTokens !== undefined ? { cachedTokens: apiUsage.cachedTokens } : {}),
        ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
        ...(generationMs !== undefined ? { generationMs } : {}),
        estimated: !apiUsage
      })
    } else {
      usage.cancel(req.requestId)
    }
    controllers.delete(req.requestId)
  }
}

function parseTranslation(raw: string): { structured: string; plain: string } {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '')
  }
  const sIdx = text.indexOf('<<<STRUCTURED>>>')
  const pIdx = text.indexOf('<<<PLAIN>>>')
  if (sIdx >= 0 && pIdx > sIdx) {
    let structured = text.slice(sIdx + '<<<STRUCTURED>>>'.length, pIdx).trim()
    let plain = text.slice(pIdx + '<<<PLAIN>>>'.length).trim()
    structured = structured.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim()
    plain = plain.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim()
    return { structured, plain }
  }
  const plainText = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/^[-*+]\s+/gm, '')
    .trim()
  return { structured: text, plain: plainText }
}

const TRANSLATE_PROMPT = `你是专业的学术文献翻译助手。请识别图片中的全部文字（可能是论文段落、表格、公式、图表标题等），并翻译为简体中文；若原文已是中文则翻译为英文。

要求：
1. 不要遗漏、不要总结、不要解释，只做忠实翻译。
2. 数学公式保留 LaTeX 写法（$...$ 或 $$...$$）。
3. 严格按以下格式输出，不要输出任何额外说明：

<<<STRUCTURED>>>
（这里输出保留原文结构的译文：Markdown 格式，保留标题层级、段落、列表、表格、分栏阅读顺序；表格用 Markdown 表格还原）
<<<PLAIN>>>
（这里输出纯文本译文：连续可读的段落，不要 Markdown 标记，不要表格符号）`

export async function translateImage(imagePath: string): Promise<{ structured: string; plain: string; model: string }> {
  const settings = store.data.settings
  const model = settings.visionModel || settings.chatModel
  if (!model) throw new Error('尚未配置视觉模型（可在设置中填写视觉模型，或让其留空使用对话模型）')
  const data = await fs.readFile(imagePath)
  const dataUrl = `data:image/png;base64,${data.toString('base64')}`
  const json = await postJson(
    {
      model,
      temperature: 0.2,
      stream: false,
      messages: [
        { role: 'system', content: '你是一名专业的学术翻译，输出必须严格遵循用户给定的格式。' },
        {
          role: 'user',
          content: [
            { type: 'text', text: TRANSLATE_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    },
    180000
  )
  const raw = contentOf(json)
  recordJsonUsage('translate', model, json, TRANSLATE_PROMPT, raw)
  if (!raw.trim()) throw new Error('模型返回了空翻译结果')
  const parsed = parseTranslation(raw)
  return { ...parsed, model }
}

export async function translateLayoutBlocks(
  blocks: { id: number; text: string }[]
): Promise<Map<number, string>> {
  const settings = store.data.settings
  if (!settings.apiKey) throw new Error('尚未配置 API Key，无法生成译文截图')
  if (!blocks.length) return new Map()

  const limited = blocks.slice(0, 120).map((block) => ({ id: block.id, text: block.text.slice(0, 1200) }))
  const prompt = `请将下面按编号给出的图片文字块翻译为简体中文；若原文已是中文则翻译为英文。保持学术表达、公式与专有名词准确，不要合并、拆分或改写编号。

只输出 JSON，格式为：{"translations":[{"id":1,"text":"译文"}]}

${JSON.stringify(limited)}`

  const json = await postJson(
    {
      model: settings.chatModel,
      temperature: 0.1,
      stream: false,
      messages: [
        { role: 'system', content: '你是学术图片翻译器，严格只输出 JSON，不输出任何解释。' },
        { role: 'user', content: prompt }
      ]
    },
    180000
  )

  const raw = contentOf(json).trim()
  recordJsonUsage('translate', settings.chatModel, json, prompt, raw)
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('译文排版结果不是有效 JSON')
  let data: unknown
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new Error('译文排版结果解析失败')
  }
  const list = Array.isArray(data) ? data : (data as { translations?: unknown[] }).translations
  const map = new Map<number, string>()
  for (const item of (list ?? []) as { id?: unknown; text?: unknown }[]) {
    const id = Number(item?.id)
    const text = typeof item?.text === 'string' ? item.text.trim() : ''
    if (Number.isFinite(id) && text) map.set(id, text)
  }
  if (!map.size) throw new Error('模型未返回有效译文')
  return map
}

export async function composeDocument(
  chatId: string,
  title: string,
  extraInstruction: string,
  scope: ComposeScope = DEFAULT_COMPOSE_SCOPE,
  outline = ''
): Promise<string> {
  const settings = store.data.settings
  if (!settings.apiKey) throw new Error('尚未配置 API Key，请打开「设置」完成配置')
  const chat = store.getChat(chatId)
  if (!chat) throw new Error('对话不存在')

  const transcript = scope.includeChat ? await buildChatTranscript(chatId) : ''

  const docs = chat.docIds
    .map((id) => store.getDocument(id))
    .filter((d): d is NonNullable<ReturnType<typeof store.getDocument>> => !!d)
  const docInfo = docs
    .map((d) => `- 《${d.title}》 ${[d.authors, d.year, d.journal].filter(Boolean).join('，')}${d.doi ? `，DOI: ${d.doi}` : ''}`)
    .join('\n')

  const notes = scope.includeNotes
    ? docs
        .filter((d) => d.notes.trim())
        .map((d) => `《${d.title}》\n${d.notes.trim()}`)
        .join('\n\n')
    : ''

  let excerptBlock = ''
  if (scope.includeExcerpts) {
    const selected = new Set(scope.excerptIds)
    const excerpts = store
      .getExcerpts()
      .filter((item) => (selected.size ? selected.has(item.id) : !!item.docId && chat.docIds.includes(item.docId)))
      .sort((a, b) => a.createdAt - b.createdAt)
    excerptBlock = excerpts
      .map((item) => {
        const where = item.page ? `第 ${item.page} 页` : '页码未知'
        const missing = item.docMissing ? '（来源文献已删除）' : ''
        const ask = item.question.trim() ? `\n问题：${item.question.trim()}` : ''
        const answer = item.answer.trim() ? `\n回答：${item.answer.trim()}` : ''
        const source = item.source && item.source !== 'chat' ? `\n来源：${item.source}` : ''
        return `《${item.docTitle}》${where}${missing}${ask}${answer}${source}`
      })
      .join('\n\n')
  }

  const questions = chat.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
  const context = scope.includeChat
    ? (await buildContext(chat.docIds, questions, settings.maxContextChars)).context
    : ''

  if (!transcript.trim() && !notes && !excerptBlock && !context.trim()) {
    throw new Error('请至少勾选一项内容（对话记录、文献笔记或摘录），并确认所选内容非空')
  }

  const system = `你是一位学术编辑，擅长把研究对话、文献笔记与摘录整理成规范的阅读笔记/研究报告。输出简体中文 Markdown，结构清晰、内容严谨，不得编造文献中没有的事实。引用文献内容时标注《标题》第N页。`

  const outlineText = (outline.trim() || defaultComposeOutline()).replace(/^#\s+.*$/gm, '').trim()
  const user = `请根据下面的素材，整理生成一份完整、结构清晰的文档。

文档标题：${title}
${docInfo ? `\n涉及文献：\n${docInfo}\n` : ''}
${notes ? `\n文献笔记：\n${notes}\n` : ''}
${excerptBlock ? `\n已有摘录：\n${excerptBlock}\n` : ''}
${context ? `\n文献原文片段：\n${context}\n` : ''}
${transcript ? `\n问答记录：\n${transcript}\n` : ''}
${extraInstruction ? `额外要求：${extraInstruction}\n` : ''}
公式使用 LaTeX（行内 $...$，独立公式 $$...$$）。
请以「# ${title}」作为文档一级标题，按以下章节结构输出（可根据素材合理增删小节，但保持结构完整）：
${outlineText}

只输出文档正文，不要输出与文档无关的说明。`

  const json = await postJson(
    {
      model: settings.chatModel,
      temperature: settings.temperature,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    },
    300000
  )
  const markdown = contentOf(json)
  recordJsonUsage('compose', settings.chatModel, json, `${system}\n${user}`, markdown)
  if (!markdown.trim()) throw new Error('模型返回了空文档')
  return markdown
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const settings = store.data.settings
    const json = await postJson(
      {
        model: settings.chatModel,
        messages: [{ role: 'user', content: '请回复：OK' }],
        max_tokens: 16,
        stream: false
      },
      30000
    )
    const content = contentOf(json)
    recordJsonUsage('test', settings.chatModel, json, '请回复：OK', content)
    return { ok: true, message: `连接成功，模型响应：${content.trim().slice(0, 80) || 'OK'}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message || '连接失败' }
  }
}
