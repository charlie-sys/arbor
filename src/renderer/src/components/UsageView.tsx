import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownCircle, ArrowUpCircle, BarChart3, Database, Loader2, MessageSquare, RefreshCw, Trash2 } from 'lucide-react'
import type { ActiveUsage, UsageKind, UsageRecord } from '@shared/types'
import { cacheHitRate } from '@shared/usage'
import { cx } from '../ui'
import './UsageView.css'

type RangeId = '24h' | '7d' | '30d' | '90d' | 'all'

interface BucketPoint {
  start: number
  input: number
  output: number
  cached: number
  cacheInput: number
  cacheKnown: boolean
  requests: number
}

interface RangeInfo {
  start: number
  stepMs: number
  hourly: boolean
  previousStart: number
  buckets: BucketPoint[]
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

const RANGES: { id: RangeId; label: string }[] = [
  { id: '24h', label: '24 小时' },
  { id: '7d', label: '7 天' },
  { id: '30d', label: '30 天' },
  { id: '90d', label: '90 天' },
  { id: 'all', label: '全部' }
]

const KIND_LABEL: Record<UsageKind, string> = {
  chat: 'AI 对话',
  compose: '文档生成',
  translate: '截图翻译',
  action: '阅读操作',
  plan: '阅读计划',
  topic: '主题问题',
  inbox: '灵感整理',
  test: '连接测试'
}

const KIND_COLORS = [
  'var(--accent)',
  'var(--secondary)',
  'var(--accent-strong)',
  'var(--warn-dot)',
  'var(--text-muted-soft)',
  'var(--danger-dot)',
  'var(--accent-hover)',
  'var(--text-faintest)'
]

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function floorHour(ts: number): number {
  const date = new Date(ts)
  date.setMinutes(0, 0, 0)
  return date.getTime()
}

function buildRange(records: UsageRecord[], rangeId: RangeId, now: number): RangeInfo {
  let start: number
  let stepMs: number
  if (rangeId === '24h') {
    start = floorHour(now) - 23 * HOUR
    stepMs = HOUR
  } else if (rangeId === '7d') {
    start = startOfDay(now) - 6 * DAY
    stepMs = DAY
  } else if (rangeId === '30d') {
    start = startOfDay(now) - 29 * DAY
    stepMs = DAY
  } else if (rangeId === '90d') {
    start = startOfDay(now) - 89 * DAY
    stepMs = DAY
  } else {
    const earliest = records.length ? Math.min(...records.map((record) => record.createdAt)) : now - 7 * DAY
    const span = now - earliest
    if (span <= 2 * DAY) {
      start = floorHour(earliest)
      stepMs = HOUR
    } else if (span <= 120 * DAY) {
      start = startOfDay(earliest)
      stepMs = DAY
    } else {
      start = startOfDay(earliest)
      stepMs = 7 * DAY
    }
  }
  const count = Math.max(1, Math.ceil((now - start + 1) / stepMs))
  const buckets = Array.from({ length: count }, (_, index) => ({
    start: start + index * stepMs,
    input: 0,
    output: 0,
    cached: 0,
    cacheInput: 0,
    cacheKnown: false,
    requests: 0
  }))
  return { start, stepMs, hourly: stepMs < DAY, previousStart: start - (now - start), buckets }
}

function formatTokens(value: number): string {
  const n = Math.max(0, Math.round(value))
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

function cacheRateOf(record: UsageRecord): number | null {
  if (typeof record.cachedTokens !== 'number' || record.promptTokens <= 0) return null
  return (record.cachedTokens / record.promptTokens) * 100
}

function formatTick(ts: number, hourly: boolean): string {
  const date = new Date(ts)
  if (hourly) return `${String(date.getHours()).padStart(2, '0')}:00`
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function formatFullTick(ts: number, hourly: boolean, stepMs: number): string {
  const date = new Date(ts)
  const day = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  if (hourly) {
    const end = new Date(ts + stepMs)
    return `${day} ${String(date.getHours()).padStart(2, '0')}:00–${String(end.getHours()).padStart(2, '0')}:00`
  }
  return stepMs >= 7 * DAY ? `${day} 起一周` : day
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const exponent = Math.pow(10, Math.floor(Math.log10(value)))
  const fraction = value / exponent
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * exponent
}

function useContainerWidth(): { ref: React.RefObject<HTMLDivElement | null>; width: number } {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      if (next > 0) setWidth(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

interface Pt {
  x: number
  y: number
}

function TrendChart({
  points,
  metric,
  hourly,
  stepMs
}: {
  points: BucketPoint[]
  metric: 'tokens' | 'cache'
  hourly: boolean
  stepMs: number
}): React.JSX.Element {
  const { ref, width } = useContainerWidth()
  const [hover, setHover] = useState<number | null>(null)
  const gradientId = `usage-grad-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const height = 218
  const pad = { top: 14, right: 12, bottom: 26, left: 54 }
  const plotW = Math.max(1, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const baseY = pad.top + plotH
  const count = points.length
  const rateOf = (point: BucketPoint): number =>
    point.cacheKnown && point.cacheInput > 0 ? (point.cached / point.cacheInput) * 100 : 0
  const values = points.map((point) => (metric === 'cache' ? rateOf(point) : point.input + point.output))
  const max = metric === 'cache' ? 100 : niceCeil(Math.max(0, ...values) * 1.08)
  const scaleY = (value: number): number => baseY - Math.min(1, Math.max(0, value / max)) * plotH
  const xAt = (index: number): number => pad.left + ((index + 0.5) / count) * plotW

  const curve = (list: Pt[]): string => {
    if (list.length < 2) return ''
    let path = ''
    for (let index = 1; index < list.length; index += 1) {
      const p0 = list[index - 2] ?? list[index - 1]
      const p1 = list[index - 1]
      const p2 = list[index]
      const p3 = list[index + 1] ?? p2
      const c1x = p1.x + (p2.x - p0.x) / 6
      const c2x = p2.x - (p3.x - p1.x) / 6
      const c1y = Math.min(baseY, Math.max(pad.top, p1.y + (p2.y - p0.y) / 6))
      const c2y = Math.min(baseY, Math.max(pad.top, p2.y - (p3.y - p1.y) / 6))
      path += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
    }
    return path
  }
  const linePath = (list: Pt[]): string => (list.length ? `M ${list[0].x.toFixed(1)},${list[0].y.toFixed(1)}${curve(list)}` : '')
  const bandPath = (top: Pt[], bottom: Pt[]): string => {
    if (!top.length) return ''
    const reversed = [...bottom].reverse()
    const last = bottom[bottom.length - 1]
    return `M ${top[0].x.toFixed(1)},${top[0].y.toFixed(1)}${curve(top)} L ${last.x.toFixed(1)},${last.y.toFixed(1)}${curve(reversed)} Z`
  }

  const inputPts = points.map((point, index) => ({ x: xAt(index), y: scaleY(point.input) }))
  const totalPts = points.map((point, index) => ({ x: xAt(index), y: scaleY(point.input + point.output) }))
  const cachePts = points.map((point, index) => ({ x: xAt(index), y: scaleY(metric === 'cache' ? rateOf(point) : 0) }))
  const basePts = points.map((_, index) => ({ x: xAt(index), y: baseY }))
  const ticks = [0.25, 0.5, 0.75, 1].map((fraction) => ({ value: max * fraction, y: scaleY(max * fraction) }))
  const labelStep = Math.max(1, Math.ceil(count / 6))
  const labelIndexes: number[] = []
  for (let index = 0; index < count; index += labelStep) labelIndexes.push(index)

  const hovered = hover !== null ? points[hover] : null
  const hoverX = hover !== null ? xAt(hover) : 0
  const tooltipLeft = Math.min(Math.max(hoverX, 86), Math.max(86, width - 86))

  return (
    <div className="usage-chart-wrap" ref={ref}>
      {width > 80 && (
        <svg
          width={width}
          height={height}
          role="img"
          style={{ display: 'block' }}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const x = event.clientX - rect.left
            if (x < pad.left || x > pad.left + plotW) {
              setHover(null)
              return
            }
            const index = Math.floor(((x - pad.left) / plotW) * count)
            setHover(Math.min(count - 1, Math.max(0, index)))
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--secondary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--secondary)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <g key={tick.y}>
              <line x1={pad.left} y1={tick.y} x2={pad.left + plotW} y2={tick.y} stroke="var(--border-soft)" strokeDasharray="2 4" />
              <text x={pad.left - 8} y={tick.y + 3} textAnchor="end" fontSize={9.5} fill="var(--text-faint)">
                {metric === 'cache' ? `${tick.value.toFixed(0)}%` : formatTokens(tick.value)}
              </text>
            </g>
          ))}
          <line x1={pad.left} y1={baseY} x2={pad.left + plotW} y2={baseY} stroke="var(--border)" />

          {metric === 'tokens' ? (
            <>
              <path d={bandPath(inputPts, basePts)} fill="var(--accent)" opacity="0.3" />
              <path d={bandPath(totalPts, inputPts)} fill="var(--secondary)" opacity="0.24" />
              <path d={linePath(inputPts)} fill="none" stroke="var(--accent-strong)" strokeWidth={1.7} strokeLinejoin="round" />
              <path d={linePath(totalPts)} fill="none" stroke="var(--secondary)" strokeWidth={1.7} strokeLinejoin="round" />
            </>
          ) : (
            <>
              <path d={bandPath(cachePts, basePts)} fill={`url(#${gradientId})`} />
              <path d={linePath(cachePts)} fill="none" stroke="var(--secondary)" strokeWidth={2} strokeLinejoin="round" />
            </>
          )}

          {labelIndexes.map((index) => (
            <text
              key={index}
              x={xAt(index)}
              y={height - 7}
              textAnchor={index === 0 ? 'start' : index + labelStep >= count ? 'end' : 'middle'}
              fontSize={9.5}
              fill="var(--text-faint)"
            >
              {formatTick(points[index].start, hourly)}
            </text>
          ))}

          {hover !== null && (
            <g>
              <line x1={hoverX} y1={pad.top} x2={hoverX} y2={baseY} stroke="var(--border-strong)" strokeDasharray="3 3" />
              {metric === 'tokens' ? (
                <>
                  <circle cx={hoverX} cy={inputPts[hover].y} r={3.2} fill="var(--accent-strong)" />
                  <circle cx={hoverX} cy={totalPts[hover].y} r={3.2} fill="var(--secondary)" />
                </>
              ) : (
                <circle cx={hoverX} cy={cachePts[hover].y} r={3.4} fill="var(--secondary)" />
              )}
            </g>
          )}
        </svg>
      )}

      {hovered && (
        <div className="usage-chart-tip" style={{ left: tooltipLeft }}>
          <strong>{formatFullTick(hovered.start, hourly, stepMs)}</strong>
          {metric === 'tokens' ? (
            <>
              <div className="tip-row">
                <span>输入</span>
                <b>{formatTokens(hovered.input)}</b>
              </div>
              <div className="tip-row">
                <span>输出</span>
                <b>{formatTokens(hovered.output)}</b>
              </div>
              <div className="tip-row">
                <span>合计</span>
                <b>{formatTokens(hovered.input + hovered.output)}</b>
              </div>
            </>
          ) : (
            <>
              <div className="tip-row">
                <span>缓存命中率</span>
                <b>{hovered.cacheKnown && hovered.cacheInput > 0 ? `${rateOf(hovered).toFixed(1)}%` : '—'}</b>
              </div>
              <div className="tip-row">
                <span>命中 Token</span>
                <b>{hovered.cacheKnown ? formatTokens(hovered.cached) : '—'}</b>
              </div>
              <div className="tip-row">
                <span>输入</span>
                <b>{formatTokens(hovered.input)}</b>
              </div>
            </>
          )}
          <div className="tip-row">
            <span>请求</span>
            <b>{hovered.requests} 次</b>
          </div>
        </div>
      )}
    </div>
  )
}

interface KindItem {
  kind: UsageKind
  label: string
  color: string
  requests: number
  tokens: number
}

function KindDonut({ items, totalRequests }: { items: KindItem[]; totalRequests: number }): React.JSX.Element {
  const radius = 56
  const strokeWidth = 15
  const size = 158
  const center = size / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="usage-donut-wrap">
      <div className="usage-donut">
        <svg width={size} height={size} role="img">
          <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--surface-tint)" strokeWidth={strokeWidth} />
          {items.map((item) => {
            const share = totalRequests ? item.requests / totalRequests : 0
            const length = share * circumference
            const dash = Math.max(0, length - (items.length > 1 ? 2 : 0))
            const circle = (
              <circle
                key={item.kind}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${Math.max(0, circumference - dash)}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${center} ${center})`}
              />
            )
            offset += length
            return circle
          })}
        </svg>
        <div className="usage-donut-center">
          <strong>{totalRequests}</strong>
          <span>次调用</span>
        </div>
      </div>
      <div className="usage-kind-list">
        {items.map((item) => (
          <div className="usage-kind-row" key={item.kind}>
            <i style={{ background: item.color }} />
            <span>{item.label}</span>
            <b>
              {item.requests} 次 · {totalRequests ? Math.round((item.requests / totalRequests) * 100) : 0}%
            </b>
          </div>
        ))}
      </div>
    </div>
  )
}

interface UsageViewProps {
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}

function formatRecentTime(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`
}

function readInitialRange(): RangeId {
  const saved = window.localStorage.getItem('arbor-usage-range')
  return RANGES.some((range) => range.id === saved) ? (saved as RangeId) : '7d'
}

export default function UsageView({ notify }: UsageViewProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<{ records: UsageRecord[]; active: ActiveUsage[] }>({
    records: [],
    active: []
  })
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(0)
  const [rangeId, setRangeId] = useState<RangeId>(readInitialRange)
  const [clearing, setClearing] = useState(false)

  const records = snapshot.records
  const active = snapshot.active

  const refreshSnapshot = async (): Promise<void> => {
    try {
      const next = await window.api.usage.snapshot()
      setSnapshot(next)
      setLastUpdated(Date.now())
    } catch (err) {
      console.warn('加载用量数据失败', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    void refreshSnapshot()
    const offRecorded = window.api.events.onUsageRecorded((event) => {
      if (!alive) return
      setSnapshot((prev) => ({ ...prev, active: event.active }))
      void refreshSnapshot()
    })
    const offLive = window.api.events.onUsageLive((next) => {
      if (!alive) return
      setSnapshot((prev) => ({ ...prev, active: next }))
    })
    return () => {
      alive = false
      offRecorded()
      offLive()
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('arbor-usage-range', rangeId)
  }, [rangeId])

  const stats = useMemo(() => {
    const now = Date.now()
    const range = buildRange(records, rangeId, now)
    const totals = { input: 0, output: 0, cached: 0, cacheInput: 0, cacheKnown: false, requests: 0 }
    const previous = { input: 0, output: 0, cached: 0, cacheInput: 0, cacheKnown: false, requests: 0 }
    for (const record of records) {
      const cached = typeof record.cachedTokens === 'number' ? record.cachedTokens : null
      if (record.createdAt >= range.start && record.createdAt <= now) {
        const index = Math.min(
          range.buckets.length - 1,
          Math.max(0, Math.floor((record.createdAt - range.start) / range.stepMs))
        )
        const bucket = range.buckets[index]
        bucket.input += record.promptTokens
        bucket.output += record.completionTokens
        if (cached !== null) {
          bucket.cached += cached
          bucket.cacheInput += record.promptTokens
          bucket.cacheKnown = true
          totals.cached += cached
          totals.cacheInput += record.promptTokens
          totals.cacheKnown = true
        }
        bucket.requests += 1
        totals.input += record.promptTokens
        totals.output += record.completionTokens
        totals.requests += 1
      } else if (record.createdAt >= range.previousStart && record.createdAt < range.start) {
        previous.input += record.promptTokens
        previous.output += record.completionTokens
        if (cached !== null) {
          previous.cached += cached
          previous.cacheInput += record.promptTokens
          previous.cacheKnown = true
        }
        previous.requests += 1
      }
    }
    return { now, range, totals, previous }
  }, [records, rangeId])

  const breakdown = useMemo(() => {
    const models = new Map<
      string,
      {
        model: string
        input: number
        output: number
        cached: number
        cacheInput: number
        cacheKnown: boolean
        requests: number
      }
    >()
    const kinds = new Map<UsageKind, { requests: number; tokens: number }>()
    for (const record of records) {
      if (record.createdAt < stats.range.start || record.createdAt > stats.now) continue
      const modelKey = record.model.trim() || '未命名模型'
      const model = models.get(modelKey) ?? {
        model: modelKey,
        input: 0,
        output: 0,
        cached: 0,
        cacheInput: 0,
        cacheKnown: false,
        requests: 0
      }
      model.input += record.promptTokens
      model.output += record.completionTokens
      if (typeof record.cachedTokens === 'number') {
        model.cached += record.cachedTokens
        model.cacheInput += record.promptTokens
        model.cacheKnown = true
      }
      model.requests += 1
      models.set(modelKey, model)
      const kind = kinds.get(record.kind) ?? { requests: 0, tokens: 0 }
      kind.requests += 1
      kind.tokens += record.promptTokens + record.completionTokens
      kinds.set(record.kind, kind)
    }
    const modelList = [...models.values()].sort(
      (a, b) => b.input + b.output - (a.input + a.output)
    )
    const kindList: KindItem[] = (Object.keys(KIND_LABEL) as UsageKind[])
      .filter((kind) => kinds.has(kind))
      .map((kind, index) => {
        const entry = kinds.get(kind)!
        return {
          kind,
          label: KIND_LABEL[kind],
          color: KIND_COLORS[index % KIND_COLORS.length],
          requests: entry.requests,
          tokens: entry.tokens
        }
      })
    return { modelList, kindList }
  }, [records, stats])

  const recent = useMemo(
    () =>
      records
        .filter((record) => record.createdAt >= stats.range.start)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 12),
    [records, stats.range.start]
  )

  const kindColors = useMemo(() => {
    const map = new Map<UsageKind, string>()
    for (const item of breakdown.kindList) map.set(item.kind, item.color)
    return map
  }, [breakdown.kindList])

  const clearRecords = async (): Promise<void> => {
    if (!window.confirm('清空全部用量记录？该操作不可恢复。')) return
    setClearing(true)
    try {
      await window.api.usage.clear()
      notify('已清空用量记录', 'success')
    } catch (err) {
      notify(`清空失败：${(err as Error).message}`, 'error')
    } finally {
      setClearing(false)
    }
  }

  const liveTokens = active.reduce((sum, item) => sum + item.promptTokens + item.completionTokens, 0)
  const totals = stats.totals
  const chatCalls = breakdown.kindList.find((item) => item.kind === 'chat')?.requests ?? 0
  const totalTokens = totals.input + totals.output
  const overallCacheRate = cacheHitRate(totals)
  const previousCacheRate = cacheHitRate(stats.previous)
  const deltaOf = (current: number, previous: number): { text: string; dir: 'up' | 'down' | 'flat' } | null => {
    if (rangeId === 'all' || previous <= 0 || stats.previous.requests < 3) return null
    const percent = ((current - previous) / previous) * 100
    if (!Number.isFinite(percent)) return null
    return {
      text: `较上期 ${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`,
      dir: percent > 0.5 ? 'up' : percent < -0.5 ? 'down' : 'flat'
    }
  }
  const deltaOfRate = (
    current: number | null,
    previous: number | null
  ): { text: string; dir: 'up' | 'down' | 'flat' } | null => {
    if (rangeId === 'all' || current === null || previous === null || stats.previous.requests < 3) return null
    const diff = current - previous
    if (!Number.isFinite(diff)) return null
    return {
      text: `较上期 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp`,
      dir: diff > 0.5 ? 'up' : diff < -0.5 ? 'down' : 'flat'
    }
  }
  const inputDelta = deltaOf(totals.input, stats.previous.input)
  const outputDelta = deltaOf(totals.output, stats.previous.output)
  const requestDelta = deltaOf(totals.requests, stats.previous.requests)
  const cacheDelta = deltaOfRate(overallCacheRate, previousCacheRate)
  const inputShare = totalTokens ? (totals.input / totalTokens) * 100 : 0
  const outputShare = totalTokens ? (totals.output / totalTokens) * 100 : 0
  const modelMax = Math.max(1, ...breakdown.modelList.map((item) => item.input + item.output))

  return (
    <div className="view usage-view">
      <header className="view-head usage-head">
        <div>
          <h1>用量仪表盘</h1>
          <p className="muted">实时统计输入 / 输出 Token、缓存命中率与调用趋势；数据来自服务端返回的 usage。</p>
        </div>
        <div className="view-head-actions">
          <div className="usage-range" role="tablist" aria-label="时间跨度">
            {RANGES.map((range) => (
              <button
                key={range.id}
                role="tab"
                aria-selected={rangeId === range.id}
                className={cx(rangeId === range.id && 'active')}
                onClick={() => setRangeId(range.id)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <button className="btn ghost" onClick={() => void refreshSnapshot()} title="刷新用量数据">
            <RefreshCw size={15} />
            刷新
          </button>
          <button className="btn ghost" onClick={() => void clearRecords()} disabled={clearing}>
            {clearing ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            清空记录
          </button>
        </div>
      </header>

      <div className={cx('usage-live', active.length > 0 && 'on')}>
        <span className="usage-live-dot" />
        <Activity size={14} />
        {active.length > 0 ? (
          <span>
            <strong>{active.length}</strong> 个请求正在生成 · 已输出约 {formatTokens(liveTokens)} tokens
          </span>
        ) : (
          <span>实时监测中 · 新的模型调用会自动计入</span>
        )}
        <span className="usage-live-time">
          {lastUpdated ? `更新于 ${formatClock(lastUpdated)}` : loading ? '正在加载…' : '暂无数据'}
        </span>
      </div>

      {loading ? (
        <div className="usage-empty">
          <Loader2 size={20} className="spin" />
          <span className="muted">正在加载用量数据…</span>
        </div>
      ) : records.length === 0 ? (
        <div className="usage-empty">
          <div className="empty-icon">
            <BarChart3 size={26} />
          </div>
          <h2>还没有用量记录</h2>
          <p>完成一次 AI 对话、文档生成或截图翻译后，输入 / 输出 Token 与缓存命中会自动出现在这里，并实时更新。</p>
          <button className="btn ghost" onClick={() => void refreshSnapshot()}>
            <RefreshCw size={15} />
            刷新
          </button>
        </div>
      ) : (
        <>
          <div className="usage-kpis">
            <div className="usage-kpi">
              <div className="usage-kpi-head">
                <span>输入 Token</span>
                <span className="usage-kpi-icon">
                  <ArrowDownCircle size={16} />
                </span>
              </div>
              <div className="usage-kpi-value">{formatTokens(totals.input)}</div>
              <div className="usage-kpi-sub">
                占总 Token {inputShare.toFixed(1)}%{totals.cacheKnown ? ` · 命中 ${formatTokens(totals.cached)}` : ''}
                {inputDelta && <span className={cx('usage-delta', inputDelta.dir)}> · {inputDelta.text}</span>}
              </div>
            </div>
            <div className="usage-kpi">
              <div className="usage-kpi-head">
                <span>输出 Token</span>
                <span className="usage-kpi-icon">
                  <ArrowUpCircle size={16} />
                </span>
              </div>
              <div className="usage-kpi-value">{formatTokens(totals.output)}</div>
              <div className="usage-kpi-sub">
                占总 Token {outputShare.toFixed(1)}% · 合计 {formatTokens(totalTokens)}
                {outputDelta && <span className={cx('usage-delta', outputDelta.dir)}> · {outputDelta.text}</span>}
              </div>
            </div>
            <div className="usage-kpi">
              <div className="usage-kpi-head">
                <span>缓存命中率</span>
                <span className="usage-kpi-icon">
                  <Database size={16} />
                </span>
              </div>
              <div className="usage-kpi-value">{formatPercent(overallCacheRate)}</div>
              <div className="usage-kpi-sub">
                {totals.cacheKnown
                  ? `命中 ${formatTokens(totals.cached)} / 可统计输入 ${formatTokens(totals.cacheInput)} · 整体命中率`
                  : '服务端未返回缓存明细'}
                {cacheDelta && <span className={cx('usage-delta', cacheDelta.dir)}> · {cacheDelta.text}</span>}
              </div>
            </div>
            <div className="usage-kpi">
              <div className="usage-kpi-head">
                <span>调用次数</span>
                <span className="usage-kpi-icon">
                  <MessageSquare size={16} />
                </span>
              </div>
              <div className="usage-kpi-value">{totals.requests.toLocaleString('zh-CN')}</div>
              <div className="usage-kpi-sub">
                对话 {chatCalls} 次 · 其他 {Math.max(0, totals.requests - chatCalls)} 次
                {requestDelta && <span className={cx('usage-delta', requestDelta.dir)}> · {requestDelta.text}</span>}
              </div>
            </div>
          </div>

          <div className="usage-grid">
            <section className="usage-card">
              <div className="usage-card-head">
                <h2>Token 用量趋势</h2>
                <div className="usage-legend">
                  <span>
                    <i style={{ background: 'var(--accent)' }} />
                    输入
                  </span>
                  <span>
                    <i style={{ background: 'var(--secondary)' }} />
                    输出
                  </span>
                </div>
              </div>
              <TrendChart
                points={stats.range.buckets}
                metric="tokens"
                hourly={stats.range.hourly}
                stepMs={stats.range.stepMs}
              />
            </section>
            <section className="usage-card">
              <div className="usage-card-head">
                <h2>缓存命中趋势</h2>
                <div className="usage-legend">
                  <span>整体 {formatPercent(overallCacheRate)}</span>
                </div>
              </div>
              {totals.cacheKnown ? (
                <TrendChart
                  points={stats.range.buckets}
                  metric="cache"
                  hourly={stats.range.hourly}
                  stepMs={stats.range.stepMs}
                />
              ) : (
                <div className="usage-chart-empty">服务端未返回缓存命中数据</div>
              )}
            </section>
          </div>

          <div className="usage-bottom">
            <section className="usage-card">
              <div className="usage-card-head">
                <h2>模型用量</h2>
                <span className="muted small">输入 / 输出 Token</span>
              </div>
              {breakdown.modelList.length === 0 ? (
                <div className="usage-chart-empty">当前时间跨度内暂无调用</div>
              ) : (
                breakdown.modelList.map((model) => {
                  const rate =
                    model.cacheKnown && model.cacheInput > 0 ? (model.cached / model.cacheInput) * 100 : null
                  return (
                    <div className="usage-model-row" key={model.model}>
                      <div className="usage-model-line">
                        <code title={model.model}>{model.model}</code>
                        <span>
                          {formatTokens(model.input)} 输入 · {formatTokens(model.output)} 输出
                        </span>
                      </div>
                      <div className="usage-model-bar">
                        <i className="in" style={{ width: `${(model.input / modelMax) * 100}%` }} />
                        <i className="out" style={{ width: `${(model.output / modelMax) * 100}%` }} />
                      </div>
                      <div className="usage-model-meta">
                        缓存命中 {formatPercent(rate)}
                        {model.cacheKnown ? ` · 命中 ${formatTokens(model.cached)}` : ''} · {model.requests} 次调用
                      </div>
                    </div>
                  )
                })
              )}
            </section>

            <section className="usage-card">
              <div className="usage-card-head">
                <h2>调用构成</h2>
                <span className="muted small">按调用次数</span>
              </div>
              {breakdown.kindList.length === 0 ? (
                <div className="usage-chart-empty">当前时间跨度内暂无调用</div>
              ) : (
                <KindDonut items={breakdown.kindList} totalRequests={totals.requests} />
              )}
            </section>
          </div>

          <section className="usage-card">
            <div className="usage-card-head">
              <h2>最近调用</h2>
              <span className="muted small">最多显示所选跨度内的 12 条</span>
            </div>
            {recent.length === 0 ? (
              <div className="usage-chart-empty">当前时间跨度内暂无调用</div>
            ) : (
              <div className="usage-table-wrap">
                <div className="usage-table">
                  <div className="usage-row head">
                    <span>时间</span>
                    <span>类型</span>
                    <span>模型</span>
                    <span className="num">输入</span>
                    <span className="num">输出</span>
                    <span className="num">缓存命中</span>
                  </div>
                  {recent.map((record) => (
                    <div className="usage-row" key={record.id}>
                      <span className="muted">{formatRecentTime(record.createdAt)}</span>
                      <span>
                        <span className="usage-kind-chip">
                          <i style={{ background: kindColors.get(record.kind) ?? KIND_COLORS[0] }} />
                          {KIND_LABEL[record.kind]}
                        </span>
                      </span>
                      <span className="model" title={record.model}>
                        {record.model || '—'}
                      </span>
                      <span className="num">
                        {record.estimated && (
                          <span className="usage-est" title="服务端未返回精确用量，此处为本地估算">
                            ~
                          </span>
                        )}
                        {formatTokens(record.promptTokens)}
                      </span>
                      <span className="num">
                        {record.estimated && <span className="usage-est">~</span>}
                        {formatTokens(record.completionTokens)}
                      </span>
                      <span className="num">{formatPercent(cacheRateOf(record))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

        </>
      )}
    </div>
  )
}

