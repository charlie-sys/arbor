import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { ActiveUsage, UsageKind, UsageRecord } from '../shared/types'

const MAX_RECORDS = 5000

interface UsageInput {
  kind: UsageKind
  model: string
  promptTokens: number
  completionTokens: number
  chatId?: string
  firstTokenMs?: number
  generationMs?: number
  cachedTokens?: number
  estimated?: boolean
}

function cleanTokens(value: unknown): number {
  const token = Number(value)
  return Number.isFinite(token) && token > 0 ? Math.round(token) : 0
}

function cleanOptionalTokens(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const token = Number(value)
  return Number.isFinite(token) && token >= 0 ? Math.round(token) : undefined
}

function cleanDuration(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const ms = Number(value)
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : undefined
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

class UsageTracker {
  private file = ''
  private records: UsageRecord[] = []
  private active = new Map<string, ActiveUsage>()
  private saveChain: Promise<void> = Promise.resolve()
  private lastLiveAt = new Map<string, number>()

  async init(root: string): Promise<void> {
    this.file = path.join(root, 'usage.json')
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf-8'))
      if (Array.isArray(parsed)) {
        this.records = parsed
          .filter((item): item is UsageRecord => !!item && typeof item === 'object' && typeof item.createdAt === 'number')
          .map((item) => ({
            id: String(item.id ?? ''),
            createdAt: Number(item.createdAt),
            kind: item.kind ?? 'chat',
            model: String(item.model ?? ''),
            promptTokens: cleanTokens(item.promptTokens),
            completionTokens: cleanTokens(item.completionTokens),
            ...(typeof item.chatId === 'string' && item.chatId ? { chatId: item.chatId } : {}),
            ...(cleanDuration(item.firstTokenMs) !== undefined
              ? { firstTokenMs: cleanDuration(item.firstTokenMs) }
              : {}),
            ...(cleanDuration(item.generationMs) !== undefined
              ? { generationMs: cleanDuration(item.generationMs) }
              : {}),
            ...(cleanOptionalTokens(item.cachedTokens) !== undefined
              ? { cachedTokens: cleanOptionalTokens(item.cachedTokens) }
              : {}),
            estimated: item.estimated === true
          }))
          .slice(-MAX_RECORDS)
      }
    } catch {
      this.records = []
    }
  }

  snapshot(): { records: UsageRecord[]; active: ActiveUsage[] } {
    return {
      records: this.records.map((record) => ({ ...record })),
      active: [...this.active.values()].map((item) => ({ ...item }))
    }
  }

  begin(id: string, kind: UsageKind, model: string, promptTokens: number): void {
    this.active.set(id, {
      id,
      kind,
      model,
      startedAt: Date.now(),
      promptTokens: cleanTokens(promptTokens),
      completionTokens: 0
    })
    this.lastLiveAt.set(id, 0)
    this.emitLive()
  }

  progress(id: string, completionTokens: number): void {
    const item = this.active.get(id)
    if (!item) return
    item.completionTokens = cleanTokens(completionTokens)
    const now = Date.now()
    if (now - (this.lastLiveAt.get(id) ?? 0) < 700) return
    this.lastLiveAt.set(id, now)
    this.emitLive()
  }

  finish(id: string, usage: UsageInput): void {
    this.active.delete(id)
    this.lastLiveAt.delete(id)
    this.add(usage)
  }

  cancel(id: string): void {
    if (!this.active.delete(id)) return
    this.lastLiveAt.delete(id)
    this.emitLive()
  }

  add(usage: UsageInput): UsageRecord {
    const promptTokens = cleanTokens(usage.promptTokens)
    const cachedTokens =
      usage.cachedTokens === undefined ? undefined : Math.min(cleanOptionalTokens(usage.cachedTokens) ?? 0, promptTokens)
    const firstTokenMs = cleanDuration(usage.firstTokenMs)
    const generationMs = cleanDuration(usage.generationMs)
    const record: UsageRecord = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      kind: usage.kind,
      model: usage.model,
      promptTokens,
      completionTokens: cleanTokens(usage.completionTokens),
      ...(usage.chatId ? { chatId: usage.chatId } : {}),
      ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
      ...(generationMs !== undefined ? { generationMs } : {}),
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      ...(usage.estimated ? { estimated: true } : {})
    }
    this.records.push(record)
    if (this.records.length > MAX_RECORDS) this.records = this.records.slice(-MAX_RECORDS)
    void this.save()
    broadcast('usage:recorded', { record, active: this.snapshot().active })
    return record
  }

  async clear(): Promise<void> {
    this.records = []
    await this.save()
    broadcast('usage:recorded', { cleared: true, active: this.snapshot().active })
  }

  private emitLive(): void {
    broadcast('usage:live', [...this.active.values()].map((item) => ({ ...item })))
  }

  private save(): Promise<void> {
    this.saveChain = this.saveChain.then(() => this.writeNow()).catch((err) => {
      console.error('Failed to save usage records', err)
    })
    return this.saveChain
  }

  private async writeNow(): Promise<void> {
    if (!this.file) return
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.records), 'utf-8')
    await fs.rename(tmp, this.file)
  }
}

export const usage = new UsageTracker()

interface RawUsage {
  prompt_tokens?: unknown
  completion_tokens?: unknown
  input_tokens?: unknown
  output_tokens?: unknown
  prompt_cache_hit_tokens?: unknown
  cache_read_input_tokens?: unknown
  cached_tokens?: unknown
  prompt_tokens_details?: { cached_tokens?: unknown } | null
}

function rawCachedTokens(raw: RawUsage): number | undefined {
  const value =
    raw.prompt_tokens_details?.cached_tokens ??
    raw.prompt_cache_hit_tokens ??
    raw.cache_read_input_tokens ??
    raw.cached_tokens
  return cleanOptionalTokens(value)
}

export function usageFromApi(json: unknown): {
  promptTokens: number
  completionTokens: number
  cachedTokens?: number
} | null {
  const raw = (json as { usage?: RawUsage } | null)?.usage
  if (!raw) return null
  const promptTokens = cleanTokens(raw.prompt_tokens ?? raw.input_tokens)
  const completionTokens = cleanTokens(raw.completion_tokens ?? raw.output_tokens)
  if (!promptTokens && !completionTokens) return null
  const cachedTokens = rawCachedTokens(raw)
  return {
    promptTokens,
    completionTokens,
    ...(cachedTokens !== undefined && promptTokens > 0
      ? { cachedTokens: Math.min(cachedTokens, promptTokens) }
      : {})
  }
}
