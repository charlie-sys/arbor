import { useEffect, useMemo, useState } from 'react'
import type { UsageRecord } from '@shared/types'
import { cacheHitRate, summarizeUsage } from '@shared/usage'
import type { UsageSummary } from '@shared/usage'
import { t } from '@shared/i18n'

let records: UsageRecord[] | null = null
let loading: Promise<void> | null = null
let pending: UsageRecord[] = []
let eventsBound = false
const listeners = new Set<(next: UsageRecord[]) => void>()

function emit(): void {
  const snapshot = records ?? []
  for (const listener of listeners) listener(snapshot)
}

function subscribe(listener: (next: UsageRecord[]) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function addRecord(record: UsageRecord): void {
  if (!records) {
    if (!pending.some((item) => item.id === record.id)) pending.push(record)
    return
  }
  if (records.some((item) => item.id === record.id)) return
  records = [...records, record].slice(-5000)
  emit()
}

function bindEvents(): void {
  if (eventsBound) return
  eventsBound = true
  window.api.events.onUsageRecorded((event) => {
    if (event.cleared) {
      records = []
      pending = []
      emit()
      return
    }
    if (event.record) addRecord(event.record)
  })
}

function loadUsageRecords(): void {
  bindEvents()
  if (records || loading) return
  loading = window.api.usage
    .snapshot()
    .then((snapshot) => {
      if (pending.length) {
        const merged = new Map(snapshot.records.map((record) => [record.id, record]))
        for (const record of pending) merged.set(record.id, record)
        records = [...merged.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-5000)
        pending = []
      } else {
        records = snapshot.records
      }
    })
    .catch(() => {
      records = []
    })
    .finally(() => {
      loading = null
      emit()
    })
}

export function useChatUsageSummary(chatId: string): UsageSummary | null {
  const [list, setList] = useState<UsageRecord[]>(() => records ?? [])

  useEffect(() => {
    loadUsageRecords()
    setList(records ?? [])
    return subscribe(setList)
  }, [])

  return useMemo(() => {
    const matched = list.filter((record) => record.chatId === chatId)
    return matched.length ? summarizeUsage(matched) : null
  }, [list, chatId])
}

function formatTokenCompact(value: number): string {
  const n = Math.max(0, Math.round(value))
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

export function formatChatUsage(summary: UsageSummary): string {
  const ttft =
    summary.avgFirstTokenMs === null
      ? '—'
      : t("{0} 秒", [(summary.avgFirstTokenMs / 1000).toFixed(summary.avgFirstTokenMs < 10_000 ? 2 : 1)])
  const speed = summary.tokensPerSec === null ? '—' : summary.tokensPerSec.toFixed(1)
  const rate = cacheHitRate(summary)
  const latency = t("首 token 平均 {0} · {1} tok/s", [ttft, speed])
  const cache = t("缓存命中 {0}", [rate === null ? '—' : `${rate.toFixed(0)}%`])
  const tokens = t("输入 {0} tok · 输出 {1} tok", [formatTokenCompact(summary.input), formatTokenCompact(summary.output)])
  return [latency, cache, tokens].join(' | ')
}
