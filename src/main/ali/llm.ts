import { fetchWithRetry } from '../http'
import { t } from '../../shared/i18n'

export interface AliServiceConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

export interface AliToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AliChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: AliToolCall[]
  tool_call_id?: string
}

export interface AliToolCallResult {
  id: string
  name: string
  arguments: string
}

export interface AliStreamResult {
  content: string
  toolCalls: AliToolCallResult[]
}

function endpoint(base: string): string {
  let value = base.trim().replace(/\/+$/, '')
  if (!value) throw new Error(t('请先在设置中填写 API Base URL'))
  if (value.endsWith('/chat/completions')) value = value.slice(0, -'/chat/completions'.length)
  if (!/\/v\d+[a-z0-9.-]*$/i.test(value)) value += '/v1'
  return `${value}/chat/completions`
}

async function post(config: AliServiceConfig, payload: unknown, signal?: AbortSignal): Promise<Response> {
  if (!config.apiKey) throw new Error(t('尚未配置 API Key，请打开「设置」完成配置'))
  if (!config.model) throw new Error(t('尚未配置模型，请打开「设置」完成配置'))
  return fetchWithRetry(endpoint(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(payload),
    signal
  })
}

export async function streamAli(
  config: AliServiceConfig,
  messages: AliChatMessage[],
  onDelta: (delta: string) => void,
  signal: AbortSignal
): Promise<string> {
  const result = await streamAliWithTools(config, messages, [], onDelta, signal)
  return result.content
}

export async function streamAliWithTools(
  config: AliServiceConfig,
  messages: AliChatMessage[],
  tools: unknown[],
  onDelta: (delta: string) => void,
  signal: AbortSignal
): Promise<AliStreamResult> {
  const response = await post(
    config,
    {
      model: config.model,
      temperature: config.temperature,
      stream: true,
      messages,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {})
    },
    signal
  )
  if (!response.body) throw new Error(t('API 未返回流式数据'))

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const calls = new Map<number, AliToolCallResult>()
  let buffer = ''
  let output = ''
  let finished = false

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      if (data === '[DONE]') {
        finished = true
        break
      }
      try {
        const json = JSON.parse(data)
        const delta = json?.choices?.[0]?.delta
        const content = delta?.content
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((part: { text?: string } | string) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
              : ''
        if (text) {
          output += text
          onDelta(text)
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const call of delta.tool_calls as {
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }[]) {
            const key = Number(call.index ?? 0)
            const entry = calls.get(key) ?? { id: '', name: '', arguments: '' }
            if (call.id) entry.id = call.id
            if (call.function?.name) entry.name += call.function.name
            if (call.function?.arguments) entry.arguments += call.function.arguments
            calls.set(key, entry)
          }
        }
      } catch {
        // ignore malformed keep-alive lines
      }
    }
  }
  return {
    content: output,
    toolCalls: [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
  }
}

export async function testAli(config: AliServiceConfig): Promise<string> {
  return completeAli(config, [{ role: 'user', content: '请回复：OK' }], { temperature: 0, maxTokens: 16 })
}

export async function completeAli(
  config: AliServiceConfig,
  messages: AliChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const response = await post(config, {
    model: config.model,
    temperature: options.temperature ?? config.temperature,
    stream: false,
    max_tokens: options.maxTokens ?? 800,
    messages
  })
  const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] }
  const content = json?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}
