import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GUIDE = path.join(ROOT, 'docs/PROJECT_BUILD_GUIDE.md')
const STATE = path.join(ROOT, 'docs/progress.json')
const REPORT = path.join(ROOT, 'docs/PROGRESS_REPORT.md')

const PROBES = {
  'P0-1': [
    { label: 'Highlight 类型', file: 'src/shared/types.ts', re: /interface\s+Highlight\b/ },
    { label: 'HighlightColor 类型', file: 'src/shared/types.ts', re: /HighlightColor/ },
    { label: 'store 高亮 CRUD', file: 'src/main/store.ts', re: /addHighlight|deleteHighlightsByDoc/ },
    { label: 'highlight IPC', file: 'src/main/ipc.ts', re: /'highlight:/ },
    { label: 'PDF 高亮层', file: 'src/renderer/src/components/PdfViewer.tsx', re: /highlight/i },
    { label: '高亮页签', file: 'src/renderer/src/components/ReaderView.tsx', re: /['"]highlights?['"]/ }
  ],
  'P0-2': [
    { label: 'PDF 大纲读取', file: 'src/renderer/src/components/PdfViewer.tsx', re: /getOutline/ },
    { label: '大纲页签', file: 'src/renderer/src/components/ReaderView.tsx', re: /['"]outline['"]/ }
  ],
  'P0-3': [
    { label: 'context page 模式', file: 'src/shared/types.ts', re: /contextMode[^\n]*'page'/ },
    { label: '选区上下文字段', file: 'src/shared/types.ts', re: /selection\?:\s*string/ },
    { label: '上下文模式 UI', file: 'src/renderer/src/components/ChatThread.tsx', re: /contextMode[^\n]{0,80}'(page|selection)'|setContextMode/ }
  ],
  'P0-4': [
    { label: '页码跳转处理', file: 'src/renderer/src/components/ChatThread.tsx', re: /jumpToPage|onJumpToPage|openPage/ },
    { label: '引用来源区', file: 'src/renderer/src/components/ChatThread.tsx', re: /citation|引用来源/ }
  ],
  'P0-5': [
    { label: 'Excerpt 实体', file: 'src/shared/types.ts', re: /interface\s+Excerpt\b/ },
    { label: 'excerpt IPC', file: 'src/main/ipc.ts', re: /'excerpt:/ },
    { label: '回答存为笔记', file: 'src/renderer/src/components/ChatThread.tsx', re: /saveAsNote|存为笔记/ },
    { label: '摘录页签', file: 'src/renderer/src/components/ReaderView.tsx', re: /['"]excerpts?['"]/ }
  ],
  'P0-6': [
    { label: 'readingStatus', file: 'src/shared/types.ts', re: /readingStatus/ },
    { label: '表格视图', file: 'src/renderer/src/components/LibraryView.tsx', re: /table-?view|tableView|表格视图/ },
    { label: '阅读状态 UI', file: 'src/renderer/src/components/LibraryView.tsx', re: /阅读状态/ }
  ],
  'P0-7': [
    { label: '生成范围-摘录', file: 'src/main/llm.ts', re: /excerpt/i },
    { label: '生成范围 UI', file: 'src/renderer/src/components/ComposeModal.tsx', re: /excerpt|摘录/ },
    { label: '导出重名处理', file: 'src/main/docx.ts', re: /uniqueFileName|dedupe|duplicate|序号/ }
  ],
  'P1-1': [
    { label: '命令面板组件', file: 'src/renderer/src/components/CommandPalette.tsx' },
    { label: '全局搜索 IPC', file: 'src/main/ipc.ts', re: /'search:global'/ },
    { label: 'Ctrl+O 快捷键', file: 'src/renderer/src/App.tsx', re: /ctrlKey[\s\S]{0,60}['"]o['"]/i }
  ],
  'P1-2': [
    { label: 'Tag 实体', file: 'src/shared/types.ts', re: /interface\s+Tag\b/ },
    { label: 'Property 实体', file: 'src/shared/types.ts', re: /interface\s+Property\b/ },
    { label: 'savedViews', file: 'src/shared/types.ts', re: /savedViews/ }
  ],
  'P1-3': [
    { label: 'TaskItem 实体', file: 'src/shared/types.ts', re: /interface\s+TaskItem\b/ },
    { label: 'Inbox 实体', file: 'src/shared/types.ts', re: /inbox/i },
    { label: 'task/inbox IPC', file: 'src/main/ipc.ts', re: /'(task|inbox):/ }
  ],
  'P1-4': [
    { label: '研究主题实体', file: 'src/shared/types.ts', re: /interface\s+(ResearchTopic|Topic)\b/ },
    { label: '研究主题视图', file: 'src/renderer/src/App.tsx', re: /ResearchTopic|研究主题/ }
  ],
  'P1-5': [
    { label: 'AI Action 定义', file: 'src/shared/types.ts', re: /aiAction|AiAction|AIAction/ },
    { label: '选区动作 UI', file: 'src/renderer/src/components/ReaderView.tsx', re: /AI Actions|解释公式|aiAction/ }
  ],
  'P1-6': [
    { label: 'Collection.parentId', file: 'src/shared/types.ts', re: /interface\s+Collection\b[\s\S]{0,300}parentId/ },
    { label: '侧栏层级', file: 'src/renderer/src/components/Sidebar.tsx', re: /children|tree|层级/ }
  ],
  'P2-1': [{ label: '画布视图', file: 'src/renderer/src/components/CanvasView.tsx' }],
  'P2-2': [{ label: '主题阅读计划', file: 'src/shared/types.ts', re: /readingPlan|ReadingPlan/i }],
  'P2-3': [{ label: 'MCP Server', file: 'src/main/mcp.ts' }],
  'P2-4': [{ label: '导出增强', file: 'src/main/docx.ts', re: /bibtex|zip/i }],
  'P2-5': [{ label: '外部导入', file: 'src/main/importers.ts' }],
  'P2-6': [{ label: '自动备份', file: 'src/main/backup.ts' }]
}

const PHASE_ORDER = { P0: 0, P1: 1, P2: 2, R: 3 }

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function parseGuide(md) {
  const tasks = []
  const regressions = []
  let task = null
  let reg = null
  let phase = null

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()

    const regSec = line.match(/^###\s+9\.([12])\b/)
    if (regSec) {
      reg = `R-9.${regSec[1]}`
      task = null
      continue
    }
    const sec = line.match(/^###\s+(P[012])\b/)
    if (sec) {
      phase = sec[1]
      task = null
      reg = null
      continue
    }
    const t = line.match(/^####\s+(P[012]-\d+)\s+(.+)$/)
    if (t) {
      task = { id: t[1], phase: t[1].slice(0, 2), title: t[2].trim(), criteria: [] }
      tasks.push(task)
      reg = null
      continue
    }
    const p2 = line.match(/^-\s+\*\*(P2-\d+)\s+([^*]+)\*\*\s*[：:]\s*(.*)$/)
    if (p2 && phase === 'P2') {
      task = { id: p2[1], phase: 'P2', title: p2[2].trim(), criteria: [] }
      tasks.push(task)
      reg = null
      continue
    }
    if (reg) {
      const cb = line.match(/^-\s+\[[ xX]\]\s+(.+)$/)
      if (cb) regressions.push({ task: reg.slice(2), title: reg, requirement: cb[1].trim() })
      continue
    }
    if (task) {
      const cb = line.match(/^-\s+\[[ xX]\]\s+(.+)$/)
      if (cb) {
        task.criteria.push(cb[1].trim())
        continue
      }
      const acc = line.match(/^-\s*验收[：:]\s*(.+)$/)
      if (acc) task.criteria.push(acc[1].trim())
    }
  }

  const items = []
  for (const t of tasks) {
    t.criteria.forEach((text, i) => {
      items.push({ id: `${t.id}-A${i + 1}`, task: t.id, phase: t.phase, title: t.title, requirement: text })
    })
  }
  const regCount = {}
  const regs = regressions.map((r) => {
    regCount[r.title] = (regCount[r.title] || 0) + 1
    return { id: `${r.title}-${regCount[r.title]}`, task: r.task, phase: 'R', title: r.title, requirement: r.requirement }
  })
  return { tasks, items, regressions: regs }
}

function mergeProgress(fresh, previous) {
  const old = new Map((previous || []).map((item) => [item.id, item]))
  return fresh.map((item) => {
    const hash = sha1(item.requirement)
    const prev = old.get(item.id)
    let status = prev?.status || 'todo'
    let evidence = prev?.evidence || ''
    let checkedAt = prev?.checkedAt || null
    let changed = false
    if (prev && prev.hash && prev.hash !== hash) {
      status = 'todo'
      evidence = ''
      checkedAt = null
      changed = true
    }
    return { ...item, hash, status, evidence, checkedAt, changed }
  })
}

export function sync() {
  const md = readFileSync(GUIDE, 'utf8')
  const parsed = parseGuide(md)
  const previous = existsSync(STATE) ? readJson(STATE) : { items: [], regressions: [] }
  const state = {
    version: 1,
    source: 'docs/PROJECT_BUILD_GUIDE.md',
    syncedAt: new Date().toISOString(),
    items: mergeProgress(parsed.items, previous.items),
    regressions: mergeProgress(parsed.regressions, previous.regressions),
    lastAudit: previous.lastAudit || null
  }
  writeJson(STATE, state)
  return { state, tasks: parsed.tasks }
}

export function loadState() {
  if (!existsSync(STATE)) return sync().state
  return readJson(STATE)
}

export function setStatus(id, status, note) {
  const state = loadState()
  const item = [...state.items, ...state.regressions].find((entry) => entry.id === id)
  if (!item) return { ok: false, error: `未知条目: ${id}` }
  item.status = status
  if (status === 'todo') {
    item.evidence = ''
    item.checkedAt = null
  } else {
    item.evidence = note || item.evidence || ''
    item.checkedAt = new Date().toISOString()
  }
  writeJson(STATE, state)
  return { ok: true, item }
}

function runGate(name, command) {
  const result = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8', timeout: 300000 })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return {
    name,
    command,
    ok: result.status === 0,
    output: output ? output.split('\n').slice(-15).join('\n') : ''
  }
}

const fileCache = new Map()
function fileText(file) {
  if (!fileCache.has(file)) {
    const full = path.join(ROOT, file)
    fileCache.set(file, existsSync(full) ? readFileSync(full, 'utf8') : null)
  }
  return fileCache.get(file)
}

function probeHit(probe) {
  const text = fileText(probe.file)
  if (text === null) return false
  return probe.re ? probe.re.test(text) : true
}

function quantify(tasks) {
  const coverage = {}
  for (const task of tasks) {
    const probes = PROBES[task.id] || []
    const missing = probes.filter((probe) => !probeHit(probe)).map((probe) => probe.label)
    coverage[task.id] = { hits: probes.length - missing.length, total: probes.length, missing }
  }
  return coverage
}

function applyCoverage(state, coverage) {
  for (const item of state.items) {
    if (item.status === 'verified' || item.status === 'blocked') continue
    const cov = coverage[item.task]
    if (!cov || cov.total === 0) {
      item.status = 'todo'
    } else if (cov.hits === 0) {
      item.status = 'todo'
    } else if (cov.hits === cov.total) {
      item.status = 'needs-manual-check'
    } else {
      item.status = 'partial'
    }
  }
}

function taskStatus(task, items, cov) {
  const own = items.filter((item) => item.task === task.id)
  const verified = own.filter((item) => item.status === 'verified').length
  const blocked = own.filter((item) => item.status === 'blocked').length
  if (blocked) return '阻塞'
  if (!own.length) return '无验收标准'
  if (verified === own.length) return '已验收'
  if (cov.total > 0 && cov.hits === cov.total) return '待人工验收'
  if (cov.hits === 0) return '未开始'
  return '部分实现'
}

function nextTask(tasks, items, coverage) {
  const sorted = [...tasks].sort((a, b) => (PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]) || a.id.localeCompare(b.id))
  return sorted.find((task) => {
    const own = items.filter((item) => item.task === task.id)
    if (own.length && own.every((item) => item.status === 'verified')) return false
    const cov = coverage[task.id]
    if (!cov || cov.total === 0) return false
    if (cov.hits === cov.total) return false
    return !items.some((item) => item.task === task.id && item.status === 'blocked')
  })
}

function checklistLine(item) {
  const mark = item.status === 'verified' ? 'x' : ' '
  const evidence = item.evidence ? ` — ${item.evidence}` : ''
  return `- [${mark}] \`${item.id}\` ${item.requirement} _(${item.status}${evidence})_`
}

function buildReport({ state, tasks, coverage, gates, changes, firstAudit }) {
  const items = state.items
  const regs = state.regressions
  const count = (status) => items.filter((item) => item.status === status).length
  const verified = count('verified')
  const pending = count('needs-manual-check')
  const partial = count('partial')
  const todo = count('todo')
  const blocked = count('blocked')
  const pct = (n) => (items.length ? Math.round((n / items.length) * 100) : 0)
  const gateLines = gates.length
    ? gates.map((gate) => `- ${gate.name}: ${gate.ok ? 'PASS' : 'FAIL'} \`${gate.command}\``).join('\n')
    : '- 未运行'
  const failedGates = gates.filter((gate) => !gate.ok)

  const taskRows = tasks.map((task) => {
    const cov = coverage[task.id]
    const own = items.filter((item) => item.task === task.id)
    const v = own.filter((item) => item.status === 'verified').length
    const gap = cov.missing.length ? cov.missing.join('、') : '—'
    return `| ${task.id} | ${task.title} | ${cov.hits}/${cov.total} | ${v}/${own.length} | ${taskStatus(task, items, cov)} | ${gap} |`
  })

  const pendingLines = items.filter((item) => item.status === 'needs-manual-check' || item.status === 'partial')
    .map((item) => `- \`${item.id}\` ${item.requirement} _(${item.status})_`)
  const blockedLines = items.filter((item) => item.status === 'blocked')
    .map((item) => `- \`${item.id}\` ${item.requirement} — ${item.evidence || '无说明'}`)

  const regressionLines = regs.map((item) => checklistLine(item))
  const changeLines = firstAudit
    ? ['- 首次审计，已初始化全部条目。']
    : changes.length
      ? changes.map((change) => `- \`${change.id}\`: ${change.from} → ${change.to}`)
      : ['- 本轮无状态变化。']
  const changedReqs = [...items, ...regs].filter((item) => item.changed)
  const regressionRisks = items.filter((item) => item.status === 'verified' && coverage[item.task]?.hits < coverage[item.task]?.total)

  const next = nextTask(tasks, items, coverage)
  const nextLines = next
    ? [
        `**${next.id} ${next.title}**`,
        '',
        `- 探针缺口：${coverage[next.id].missing.join('、') || '无'}`,
        `- 待完成验收：${items.filter((item) => item.task === next.id && item.status !== 'verified').map((item) => item.id).join('、') || '无'}`
      ]
    : ['所有 P0/P1/P2 任务的自动探针均已覆盖。剩余 `needs-manual-check` 项需要人工在 Windows 上验收。']

  return `# ZotAgent 进度报告

> 由 \`npm run progress:audit\` 生成，请勿手工编辑。需求源：\`${state.source}\`。

- 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}
- 需求同步时间：${state.syncedAt}

## 门禁

${gateLines}

${failedGates.length ? `**门禁未通过：** ${failedGates.map((g) => g.name).join('、')}。本轮不得把任何验收项标记为完成。\n` : ''}
## 总览

| 指标 | 数值 |
|---|---|
| 验收项总数 | ${items.length} |
| 已人工验收 | ${verified} (${pct(verified)}%) |
| 代码已实现待验收 | ${pending} |
| 部分实现 | ${partial} |
| 未开始 | ${todo} |
| 阻塞 | ${blocked} |
| 回归检查 | ${regs.filter((item) => item.status === 'verified').length}/${regs.length} 已通过 |

## 任务进度

| 任务 | 名称 | 探针覆盖 | 已验收 | 状态 | 缺口 |
|---|---|---|---|---|---|
${taskRows.join('\n')}

## 下一任务

${nextLines.join('\n')}

## 需要人工验收

${pendingLines.length ? pendingLines.join('\n') : '- 无'}

## 阻塞

${blockedLines.length ? blockedLines.join('\n') : '- 无'}

## 本轮变化

${changeLines.join('\n')}

${changedReqs.length ? `## 需求变更\n\n以下条目的验收文本已变化，状态已重置为 todo：\n\n${changedReqs.map((item) => `- \`${item.id}\` ${item.requirement}`).join('\n')}\n` : ''}
${regressionRisks.length ? `## 回归风险\n\n以下条目已人工验收，但实现探针缺失，可能发生代码回归：\n\n${regressionRisks.map((item) => `- \`${item.id}\`（${item.task}）`).join('\n')}\n` : ''}
## 回归检查

${regressionLines.join('\n')}

## 完整验收清单

<details>
<summary>展开 ${items.length} 条验收项</summary>

${items.map((item) => checklistLine(item)).join('\n')}

</details>
`
}

export function audit({ build = false } = {}) {
  const { state, tasks } = sync()
  const gates = [runGate('typecheck', 'npm run typecheck')]
  if (build) gates.push(runGate('build', 'npm run build'))

  const coverage = quantify(tasks)
  const before = state.lastAudit?.statuses || null
  applyCoverage(state, coverage)

  const statuses = Object.fromEntries([...state.items, ...state.regressions].map((item) => [item.id, item.status]))
  const changes = before
    ? Object.keys(statuses).filter((id) => before[id] !== statuses[id]).map((id) => ({ id, from: before[id] || 'new', to: statuses[id] }))
    : []
  const failedGates = gates.filter((gate) => !gate.ok)

  const report = buildReport({ state, tasks, coverage, gates, changes, firstAudit: !before })
  writeFileSync(REPORT, report, 'utf8')

  state.lastAudit = {
    at: new Date().toISOString(),
    gates: gates.map(({ name, command, ok }) => ({ name, command, ok })),
    statuses
  }
  writeJson(STATE, state)

  const summary = {
    total: state.items.length,
    verified: state.items.filter((item) => item.status === 'verified').length,
    pending: state.items.filter((item) => item.status === 'needs-manual-check').length,
    partial: state.items.filter((item) => item.status === 'partial').length,
    todo: state.items.filter((item) => item.status === 'todo').length,
    blocked: state.items.filter((item) => item.status === 'blocked').length,
    gates: gates.map((gate) => ({ name: gate.name, ok: gate.ok })),
    next: nextTask(tasks, state.items, coverage)?.id || null,
    report: path.relative(ROOT, REPORT),
    failedGates: failedGates.length
  }
  return summary
}
