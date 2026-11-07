import { promises as fs } from 'fs'
import { store } from './store'
import { buildChatTranscript, buildContext } from './context'
import type { ChatRequest } from '../shared/types'

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

async function postJson(payload: unknown, timeoutMs = 120000, signal?: AbortSignal): Promise<any> {
  const settings = store.data.settings
  if (!settings.apiKey) throw new Error('尚未配置 API Key，请打开「设置」完成配置')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(endpoint(settings.apiBaseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`API 请求失败 (${res.status})：${text.slice(0, 600)}`)
    }
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

export interface ChatHandlers {
  onDelta: (delta: string) => void
  onDone: (content: string) => void
  onError: (message: string) => void
}

export async function streamChat(req: ChatRequest, handlers: ChatHandlers): Promise<void> {
  const settings = store.data.settings
  const controller = new AbortController()
  controllers.set(req.requestId, controller)
  let content = ''
  try {
    if (!settings.apiKey) throw new Error('尚未配置 API Key，请打开「设置」完成配置')
    if (!settings.chatModel) throw new Error('尚未配置对话模型，请打开「设置」完成配置')

    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    let context = ''
    if (req.contextMode !== 'none' && req.docIds.length) {
      const built = await buildContext(req.docIds, lastUser, settings.maxContextChars)
      context = built.context
    }
    const mathNote =
      '输出要求：数学公式使用 LaTeX 写法，行内公式用 $...$，独立公式用 $$...$$；不要仅使用 \\( \\) 或 \\[ \\] 作为定界符。'
    const system = context
      ? `${settings.systemPrompt}\n\n${mathNote}\n\n以下是检索到的文献原文片段（带页码），请严格依据这些内容回答；引用原文时标注页码：\n\n${context}`
      : `${settings.systemPrompt}\n\n${mathNote}`

    const res = await fetch(endpoint(settings.apiBaseUrl, 'chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.chatModel,
        temperature: settings.temperature,
        stream: true,
        messages: [{ role: 'system', content: system }, ...req.messages.slice(-16)]
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`API 请求失败 (${res.status})：${text.slice(0, 600)}`)
    }
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
          const delta = json?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) {
            content += delta
            handlers.onDelta(delta)
          }
        } catch {
          // ignore malformed keep-alive lines
        }
      }
    }

    handlers.onDone(content)
  } catch (err) {
    if (controller.signal.aborted) {
      handlers.onDone(content)
    } else {
      handlers.onError((err as Error).message || '请求失败')
    }
  } finally {
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

export async function composeDocument(chatId: string, title: string, extraInstruction: string): Promise<string> {
  const settings = store.data.settings
  if (!settings.apiKey) throw new Error('尚未配置 API Key，请打开「设置」完成配置')
  const chat = store.getChat(chatId)
  if (!chat) throw new Error('对话不存在')

  const transcript = await buildChatTranscript(chatId)
  if (!transcript.trim()) throw new Error('当前对话还没有内容，先向 Agent 提问再生成文档')

  const questions = chat.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
  const { context } = await buildContext(chat.docIds, questions, settings.maxContextChars)
  const docs = chat.docIds
    .map((id) => store.getDocument(id))
    .filter((d): d is NonNullable<ReturnType<typeof store.getDocument>> => !!d)
  const docInfo = docs
    .map((d) => `- 《${d.title}》 ${[d.authors, d.year, d.journal].filter(Boolean).join('，')}${d.doi ? `，DOI: ${d.doi}` : ''}`)
    .join('\n')

  const system = `你是一位学术编辑，擅长把研究对话整理成规范的阅读笔记/研究报告。输出简体中文 Markdown，结构清晰、内容严谨，不得编造文献中没有的事实。引用文献内容时标注《标题》第N页。`

  const user = `请根据下面的文献信息、原文片段和问答记录，整理生成一份完整的文档。

文档标题：${title}
${docInfo ? `\n涉及文献：\n${docInfo}\n` : ''}
${context ? `\n文献原文片段：\n${context}\n` : ''}
问答记录：
${transcript}

${extraInstruction ? `额外要求：${extraInstruction}\n` : ''}
公式使用 LaTeX（行内 $...$，独立公式 $$...$$）。
请按以下结构输出（可根据内容合理调整）：
# ${title}
## 一、阅读文献概况
## 二、研究问题与核心概念
## 三、问答整理
（逐条整理关键问答，保留问题与结论，注明依据页码）
## 四、方法与关键发现
## 五、结论与启示
## 六、原文摘录
## 七、参考资料

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
    return { ok: true, message: `连接成功，模型响应：${content.trim().slice(0, 80) || 'OK'}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message || '连接失败' }
  }
}
