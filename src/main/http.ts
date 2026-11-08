
import { t } from '../shared/i18n'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requestIdOf(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { request_id?: string }; request_id?: string }
    return String(json.error?.request_id ?? json.request_id ?? '').trim()
  } catch {
    return ''
  }
}

function formatHttpError(status: number, body: string): string {
  const requestId = requestIdOf(body)
  const suffix = requestId ? t("，请求 ID：{0}", [requestId]) : ''
  if (status === 429) {
    return t("模型服务限流（429）{0}。请稍后重试，或降低请求频率。", [suffix])
  }
  if (status >= 500) {
    return t("模型服务暂时不可用（{0}）{1}。已自动重试仍失败，请稍后再试或在设置中更换模型。", [status, suffix])
  }
  return t("API 请求失败（{0}）{1}：{2}", [status, suffix, body.slice(0, 400)])
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { attempts?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const baseDelay = Math.max(100, options.baseDelayMs ?? 700)
  let lastError: Error | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      if (init.signal?.aborted) throw new Error(t("AI 请求已取消或超时"))
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < attempts - 1) {
        await delay(baseDelay * (attempt + 1))
        continue
      }
      throw lastError
    }

    if (response.ok) return response

    const body = await response.text().catch(() => '')
    const error = new Error(formatHttpError(response.status, body))
    if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
      lastError = error
      await delay(baseDelay * (attempt + 1))
      continue
    }
    throw error
  }

  throw lastError ?? new Error(t("模型服务请求失败"))
}
