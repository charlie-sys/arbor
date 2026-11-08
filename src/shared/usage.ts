import type { TokenPrice, UsagePricing, UsageRecord } from './types'

// 参考各服务商公开价（人民币/百万 token），仅作估算起点，可在仪表盘中调整
export const DEFAULT_USAGE_PRICING: UsagePricing = {
  currency: 'CNY',
  models: {
    'deepseek-chat': { input: 2, output: 8 },
    'deepseek-reasoner': { input: 4, output: 16 },
    'qwen-plus': { input: 0.8, output: 2 },
    'qwen-max': { input: 2.4, output: 9.6 },
    'qwen-vl-plus': { input: 1.5, output: 4.5 },
    'moonshot-v1-8k': { input: 12, output: 12 },
    'moonshot-v1-32k': { input: 24, output: 24 },
    'gpt-4o-mini': { input: 1.1, output: 4.4 },
    'gpt-4o': { input: 18, output: 72 },
    'claude-3-5-sonnet': { input: 21.6, output: 108 }
  },
  defaultPrice: { input: 2, output: 8 }
}

export function normalizePricing(raw?: Partial<UsagePricing>): UsagePricing {
  if (!raw) return { ...DEFAULT_USAGE_PRICING, models: { ...DEFAULT_USAGE_PRICING.models } }
  const models: Record<string, TokenPrice> = { ...DEFAULT_USAGE_PRICING.models }
  for (const [name, price] of Object.entries(raw.models ?? {})) {
    const input = Number(price?.input)
    const output = Number(price?.output)
    if (!name.trim() || !Number.isFinite(input) || !Number.isFinite(output)) continue
    models[name.trim().toLowerCase()] = {
      input: Math.max(0, input),
      output: Math.max(0, output)
    }
  }
  const fallbackInput = Number(raw.defaultPrice?.input)
  const fallbackOutput = Number(raw.defaultPrice?.output)
  return {
    currency: raw.currency === 'USD' ? 'USD' : 'CNY',
    models,
    defaultPrice: {
      input: Number.isFinite(fallbackInput) ? Math.max(0, fallbackInput) : DEFAULT_USAGE_PRICING.defaultPrice.input,
      output: Number.isFinite(fallbackOutput) ? Math.max(0, fallbackOutput) : DEFAULT_USAGE_PRICING.defaultPrice.output
    }
  }
}

export function resolveTokenPrice(pricing: UsagePricing, model: string): TokenPrice {
  const key = model.trim().toLowerCase()
  if (!key) return pricing.defaultPrice
  if (pricing.models[key]) return pricing.models[key]
  const match = Object.keys(pricing.models)
    .filter((name) => key.includes(name) || name.includes(key))
    .sort((a, b) => b.length - a.length)[0]
  return match ? pricing.models[match] : pricing.defaultPrice
}

export function recordCost(record: UsageRecord, pricing: UsagePricing): number {
  const price = resolveTokenPrice(pricing, record.model)
  return (record.promptTokens * price.input + record.completionTokens * price.output) / 1_000_000
}

export interface UsageSummary {
  requests: number
  input: number
  output: number
  cached: number
  cacheInput: number
  cacheKnown: boolean
  avgFirstTokenMs: number | null
  tokensPerSec: number | null
}

export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  let requests = 0
  let input = 0
  let output = 0
  let cached = 0
  let cacheInput = 0
  let cacheKnown = false
  let ttftSum = 0
  let ttftCount = 0
  let timedTokens = 0
  let timedMs = 0
  for (const record of records) {
    requests += 1
    input += record.promptTokens
    output += record.completionTokens
    if (typeof record.cachedTokens === 'number' && Number.isFinite(record.cachedTokens)) {
      cached += Math.max(0, record.cachedTokens)
      cacheInput += record.promptTokens
      cacheKnown = true
    }
    if (typeof record.firstTokenMs === 'number' && Number.isFinite(record.firstTokenMs) && record.firstTokenMs >= 0) {
      ttftSum += record.firstTokenMs
      ttftCount += 1
    }
    if (
      typeof record.generationMs === 'number' &&
      Number.isFinite(record.generationMs) &&
      record.generationMs > 0 &&
      record.completionTokens > 0
    ) {
      timedTokens += record.completionTokens
      timedMs += record.generationMs
    }
  }
  return {
    requests,
    input,
    output,
    cached: Math.min(cached, cacheInput),
    cacheInput,
    cacheKnown,
    avgFirstTokenMs: ttftCount ? ttftSum / ttftCount : null,
    tokensPerSec: timedMs > 0 ? timedTokens / (timedMs / 1000) : null
  }
}

export function cacheHitRate(
  summary: Pick<UsageSummary, 'cached' | 'cacheInput' | 'cacheKnown'>
): number | null {
  if (!summary.cacheKnown || summary.cacheInput <= 0) return null
  return (summary.cached / summary.cacheInput) * 100
}

// 无 usage 返回时的粗估：中文约 1 token/字，其余约 4 字符/token
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/g) ?? []).length
  const rest = Math.max(0, text.length - cjk)
  return Math.max(1, Math.ceil(cjk * 1.1 + rest / 4))
}
