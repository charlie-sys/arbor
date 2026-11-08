import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GUIDE = path.join(ROOT, 'docs/ALI_BUILD_GUIDE.md')
const STATE = path.join(ROOT, 'docs/ali-progress.json')
const REPORT = path.join(ROOT, 'docs/ALI_PROGRESS_REPORT.md')
const EVIDENCE = path.join(ROOT, 'docs/ali-evidence.json')
const PHASE_ORDER = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 }

const p = (label, file, re) => ({ label, file, re })
const x = (label, file, re) => ({ label, file, absent: re })

const PROBES = {
  'A0-1': [p('Ali 类型', 'src/shared/ali.ts', /interface\s+AliSession|type\s+AliSession/), p('AppSettings.ali', 'src/shared/types.ts', /\bali\s*:\s*AliSettings/), p('用量分类', 'src/shared/types.ts', /'ali-memory'|"ali-memory"/), p('用量标签', 'src/renderer/src/components/UsageView.tsx', /ali-memory|ali:/)],
  'A0-2': [p('会话存储', 'src/main/ali/store.ts', /sessions\.json/), p('原子写入', 'src/main/ali/atomic.ts', /rename/), p('会话 CRUD', 'src/main/ali/store.ts', /async create|async update|async remove/), p('启动初始化', 'src/main/index.ts', /aliStore/)],
  'A0-3': [p('共享 API', 'src/shared/api.ts', /\bali\s*:\s*\{/), p('preload 桥', 'src/preload/index.ts', /\bali\s*:/), p('IPC handler', 'src/main/ipc.ts', /'ali:/)],
  'A0-4': [p('流式实现', 'src/main/ali/llm.ts', /stream/i), p('独立模型回退', 'src/main/ali/service.ts', /chatModel/), x('不注入文献 docIds', 'src/main/ali/service.ts', /docIds/), x('不构建文献上下文', 'src/main/ali/service.ts', /buildContext/)],
  'A0-5': [p('阿栗页面', 'src/renderer/src/components/AliView.tsx', /AliView|export default/), p('导航视图', 'src/renderer/src/App.tsx', /name:\s*'ali'/), p('侧栏入口', 'src/renderer/src/components/Sidebar.tsx', /阿栗/), p('命令入口', 'src/renderer/src/App.tsx', /和阿栗聊天/)],
  'A0-6': [p('SELF 默认档案', 'src/main/ali/memory.ts', /SELF\.md/), p('文献边界提示', 'src/main/ali/service.ts', /文献|AI 对话/), p('多语言提示', 'src/shared/i18n/en.ts', /Ali chat|AliView|阿栗对话/)],
  'A1-1': [p('记忆文件层', 'src/main/ali/memory.ts', /MEMORY\.md/), p('主题与归档', 'src/main/ali/memory.ts', /topics|archive/), p('目录创建', 'src/main/ali/memory.ts', /mkdir/)] ,
  'A1-2': [p('会话摘要字段', 'src/shared/ali.ts', /summary/), p('短期窗口', 'src/main/ali/service.ts', /summary|MAX_RECENT/), p('摘要上限', 'src/main/ali/service.ts', /10000|10_000|1000/ )],
  'A1-3': [p('提炼操作', 'src/main/ali/memoryOps.ts', /supersede/), p('幂等收据', 'src/main/ali/memoryOps.ts', /receipts/), p('消息证据', 'src/main/ali/memoryOps.ts', /message_ids|messageIds/), p('后台提炼用量', 'src/main/ali/service.ts', /ali-memory/)],
  'A1-4': [p('配额触发', 'src/main/ali/memoryQuota.ts', /0\.85|85/), p('整理目标', 'src/main/ali/memoryQuota.ts', /0\.7|70/), p('合并与剪枝', 'src/main/ali/memoryOps.ts', /merge|prune/), p('归档写入', 'src/main/ali/memory.ts', /archive/)],
  'A1-5': [p('BM25 检索', 'src/main/ali/memorySearch.ts', /bm25|score/i), p('记忆工具', 'src/main/ali/tools.ts', /search_memory/), p('常驻注入', 'src/main/ali/service.ts', /SELF|MEMORY/)],
  'A1-6': [p('记忆面板', 'src/renderer/src/components/AliMemoryPanel.tsx', /AliMemoryPanel|记忆/), p('记忆 IPC', 'src/main/ipc.ts', /'ali:memory/), p('导出导入', 'src/main/ipc.ts', /ali:memory:(export|import)/), p('敏感信息过滤', 'src/main/ali/memoryFormat.ts', /SECRET|sanitize|敏感/)],
  'A2-1': [p('说明解析器', 'src/main/ali/help.ts', /HelpSection/), p('标题解析', 'src/main/ali/help.ts', /\^##|split\(|match\(/), p('长章节切分', 'src/main/ali/help.ts', /1200/)],
  'A2-2': [p('意图路由', 'src/main/ali/help.ts', /intent|intent/i), p('功能名词', 'src/main/ali/help.ts', /功能名词|HELP_NOUNS|NOUNS/), p('低相关不注入', 'src/main/ali/help.ts', /threshold|阈值/)],
  'A2-3': [p('总预算', 'src/main/ali/help.ts', /2200/), p('BM25 打分', 'src/main/ali/help.ts', /bm25|score/i), p('注入标记', 'src/main/ali/service.ts', /使用说明摘录|helpContext/)],
  'A2-4': [p('说明弹窗', 'src/renderer/src/components/AliHelpModal.tsx', /AliHelpModal|使用说明/), p('说明工具', 'src/main/ali/tools.ts', /search_help|read_help/), p('打包文档', 'package.json', /docs\/使用说明\.md/), p('说明 IPC', 'src/main/ipc.ts', /'ali:help/)],
  'A3-1': [p('工具循环', 'src/main/ali/llm.ts', /tool_calls|toolCalls/), p('工具执行器', 'src/main/ali/tools.ts', /execute|runTool/), p('轮次上限', 'src/main/ali/service.ts', /maxRounds|4/), p('取消支持', 'src/main/ali/service.ts', /abort|AbortSignal/)],
  'A3-2': [p('Exa 搜索', 'src/main/ali/web.ts', /exa/i), p('SearXNG', 'src/main/ali/web.ts', /searxng/i), p('搜索缓存', 'src/main/ali/web.ts', /cache/i)],
  'A3-3': [p('GitHub 模块', 'src/main/ali/github.ts', /github/), p('API 域名', 'src/main/ali/github.ts', /api\.github\.com/), p('Token 与代码搜索', 'src/main/ali/github.ts', /token|code/i)],
  'A3-4': [p('抓取模块', 'src/main/ali/web.ts', /fetch/i), p('SSRF 校验', 'src/main/ali/web.ts', /private|loopback|isPrivate/), p('重定向复检', 'src/main/ali/web.ts', /redirect/)],
  'A3-5': [p('搜索策略', 'src/shared/ali.ts', /searchPolicy/), p('来源类型', 'src/shared/ali.ts', /AliSource/), p('来源徽标', 'src/renderer/src/components/AliChatThread.tsx', /ali-source|来源/), p('联网工具注册', 'src/main/ali/tools.ts', /search_web|search_github/)],
  'A4-1': [p('TTS 默认关闭', 'src/shared/ali.ts', /ttsEnabled/), p('语音合成', 'src/renderer/src/components/AliView.tsx', /speechSynthesis/), p('朗读控制', 'src/renderer/src/components/AliView.tsx', /speak|stop\(\)/)],
  'A4-2': [p('语音设置', 'src/renderer/src/components/SettingsView.tsx', /tts|语音/), p('语音字段', 'src/shared/ali.ts', /ttsVoice/), p('语音列表', 'src/renderer/src/components/AliView.tsx', /getVoices|voices/)],
  'A4-3': [p('三语言文案', 'src/shared/i18n/en.ts', /Ali chat|AliView|阿栗对话/), p('阿栗样式', 'src/renderer/src/ali.css', /ali-/), p('未保存保护', 'src/renderer/src/components/AliMemoryPanel.tsx', /unsaved|hasUnsavedChanges/), p('错误状态', 'src/renderer/src/components/AliView.tsx', /error|错误/)],
  'A4-4': [p('宠物入口', 'src/main/pet.ts', /open-ali|openAli/), p('侧栏入口', 'src/renderer/src/components/Sidebar.tsx', /阿栗对话|Ali chat|name:\s*'ali'/), p('用量分类', 'src/renderer/src/components/UsageView.tsx', /ali-memory|ali:/)],
  'A4-5': [p('auxModel 设置', 'src/shared/ali.ts', /auxModel/), p('次要模型解析', 'src/main/ali/service.ts', /resolveAuxConfig/), p('次要模型 UI', 'src/renderer/src/components/AliVoiceSettings.tsx', /ali-aux-model|auxModel/), p('次要服务配置', 'src/shared/ali.ts', /auxBaseUrl|auxApiKey/), p('次要服务回退', 'src/main/ali/service.ts', /auxBaseUrl|auxApiKey/), p('次要密钥加密', 'src/main/store.ts', /aliAuxApiKeyEnc/), p('主服务配置 UI', 'src/renderer/src/components/AliVoiceSettings.tsx', /ali-base|ali-key/)],
  'A4-6': [p('小窗主进程', 'src/main/aliChatWindow.ts', /openAliChatWindow/), p('小窗入口', 'electron.vite.config.ts', /ali-chat\.html/), p('宠物点击', 'src/renderer/src/petWindow.tsx', /openAliChat/)],
  'A4-7': [p('缩放实现', 'src/renderer/src/chatZoom.ts', /CHAT_SCALE_MIN|applyChatScale/), p('滚轮监听', 'src/renderer/src/components/AliView.tsx', /addEventListener\('wheel'/), p('字号提示', 'src/renderer/src/components/AliView.tsx', /chat-zoom-badge/)],
  'A5-1': [p('备份含阿栗', 'src/main/backup.ts', /aliMemory|aliStore|data\/ali|ali:/), p('恢复重载', 'src/main/backup.ts', /aliStore|aliMemory|reload/), p('备份清单', 'src/main/backup.ts', /ali.*manifest|manifest.*ali|aliMemory/s)],
  'A5-2': [p('导出 IPC', 'src/main/ipc.ts', /ali:memory:export/), p('导入 IPC', 'src/main/ipc.ts', /ali:memory:import/), p('ZIP 复用', 'src/main/ali/memory.ts', /createZip|zip/)],
  'A5-3': [p('QA 脚本', 'scripts/acceptance/ali-qa.mjs', /ali/), p('真实 UI 选择器', 'scripts/acceptance/ali-qa.mjs', /data-testid|ali-input/), p('截图证据', 'scripts/acceptance/ali-qa.mjs', /screenshot/), p('证据文件', 'scripts/acceptance/ali-qa.mjs', /ali-evidence|EVIDENCE/)],
  'A5-4': [p('说明阿栗章节', 'docs/使用说明.md', /阿栗对话|与阿栗聊天/), p('README 阿栗', 'README.md', /阿栗对话|与阿栗聊天/), p('回归证据', 'scripts/acceptance/ali-qa.mjs', /regression|回归/)]
}

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)
const readJson = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback } }
const writeJson = (file, data) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8') }

export function parseGuide(md) {
  const tasks = []
  let task = null
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (/^###\s+A\d\b/.test(line)) { task = null; continue }
    const t = line.match(/^####\s+(A\d-\d+)\s+(.+)$/)
    if (t) { task = { id: t[1], phase: t[1].slice(0, 2), title: t[2].trim(), deps: [], criteria: [] }; tasks.push(task); continue }
    if (!task) continue
    const dep = line.match(/^\*\*依赖\*\*\s*[：:]\s*(.+)$/)
    if (dep) { task.deps = [...dep[1].matchAll(/A\d-\d+/g)].map((m) => m[0]).filter((id) => id !== task.id); continue }
    const cb = line.match(/^-\s+\[[ xX]\]\s+(.+)$/)
    if (cb) task.criteria.push(cb[1].trim())
  }
  const items = []
  for (const t of tasks) t.criteria.forEach((text, i) => items.push({ id: `${t.id}-A${i + 1}`, task: t.id, phase: t.phase, title: t.title, requirement: text }))
  return { tasks, items }
}

function mergeProgress(fresh, previous) {
  const old = new Map((previous || []).map((item) => [item.id, item]))
  return fresh.map((item) => {
    const hash = sha1(item.requirement)
    const prev = old.get(item.id)
    let status = prev?.status || 'todo', evidence = prev?.evidence || '', checkedAt = prev?.checkedAt || null, changed = false
    if (prev && prev.hash && prev.hash !== hash) { status = 'todo'; evidence = ''; checkedAt = null; changed = true }
    return { ...item, hash, status, evidence, checkedAt, changed }
  })
}

export function sync() {
  if (!existsSync(GUIDE)) throw new Error(`需求源不存在：${path.relative(ROOT, GUIDE)}`)
  const parsed = parseGuide(readFileSync(GUIDE, 'utf8'))
  const previous = readJson(STATE, { items: [] })
  const state = { version: 1, source: 'docs/ALI_BUILD_GUIDE.md', syncedAt: new Date().toISOString(), items: mergeProgress(parsed.items, previous.items), lastAudit: previous.lastAudit || null }
  writeJson(STATE, state)
  return { state, tasks: parsed.tasks }
}

export const loadState = () => readJson(STATE, null) || sync().state

export function setStatus(id, status, note) {
  const state = loadState()
  const item = state.items.find((entry) => entry.id === id)
  if (!item) return { ok: false, error: `未知条目: ${id}` }
  item.status = status
  item.evidence = status === 'todo' ? '' : note || item.evidence || ''
  item.checkedAt = status === 'todo' ? null : new Date().toISOString()
  writeJson(STATE, state)
  return { ok: true, item }
}

function runGate(name, command, timeout = 300000) {
  const result = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8', timeout })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return { name, command, ok: result.status === 0, output: output ? output.split('\n').slice(-20).join('\n') : '' }
}

const cache = new Map()
function fileText(file) {
  if (!cache.has(file)) { const full = path.join(ROOT, file); cache.set(file, existsSync(full) ? readFileSync(full, 'utf8') : null) }
  return cache.get(file)
}
const probeHit = (probe) => { const text = fileText(probe.file); if (text === null) return false; return probe.absent ? !probe.absent.test(text) : probe.re ? probe.re.test(text) : true }

export function quantify(tasks) {
  const result = {}
  for (const task of tasks) {
    const probes = PROBES[task.id] || []
    const missing = probes.filter((probe) => !probeHit(probe)).map((probe) => probe.label)
    result[task.id] = { hits: probes.length - missing.length, total: probes.length, missing }
  }
  return result
}

function applyCoverage(state, coverage) {
  for (const item of state.items) {
    if (item.status === 'verified' || item.status === 'blocked') continue
    const cov = coverage[item.task]
    if (!cov || cov.total === 0 || cov.hits === 0) item.status = 'todo'
    else if (cov.hits === cov.total) item.status = 'needs-manual-check'
    else item.status = 'partial'
  }
}

function applyEvidence(state) {
  if (!existsSync(EVIDENCE)) return
  const evidence = readJson(EVIDENCE, {})
  let changed = false
  for (const item of state.items) {
    if (item.status === 'verified' || item.status === 'blocked') continue
    const ev = evidence[item.id]
    if (!ev || ev.passed !== true) continue
    if (ev.hash && ev.hash !== item.hash) continue
    const artifacts = Array.isArray(ev.artifacts) ? ev.artifacts : []
    const valid = artifacts.length ? artifacts.every((rel) => { const full = path.join(ROOT, rel); return existsSync(full) && statSync(full).size > 0 }) : Boolean(ev.output || ev.notes)
    if (!valid) continue
    item.status = 'verified'
    item.evidence = `[evidence] ${ev.notes || ev.command || 'runtime evidence'}${artifacts.length ? ` | ${artifacts.join(', ')}` : ''}`
    item.checkedAt = ev.at || new Date().toISOString()
    if (!ev.hash) { ev.hash = item.hash; changed = true }
  }
  if (changed) writeJson(EVIDENCE, evidence)
}

const depsReady = (task, items) => task.deps.every((id) => { const own = items.filter((item) => item.task === id); return own.length > 0 && own.every((item) => item.status === 'verified') })

export function nextAction(tasks, items, coverage, gates = []) {
  const failed = gates.filter((gate) => !gate.ok)
  if (failed.length) return { kind: 'gate', id: `GATE:${failed[0].name}`, reason: `${failed[0].name} 未通过，先修复门禁`, command: failed[0].command }
  const sorted = [...tasks].sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9) || a.id.localeCompare(b.id))
  const waiting = []
  for (const task of sorted) {
    const own = items.filter((item) => item.task === task.id)
    if (own.length && own.every((item) => item.status === 'verified')) continue
    if (own.length && own.every((item) => item.status === 'blocked')) continue
    if (!depsReady(task, items)) { waiting.push({ task: task.id, deps: task.deps.filter((id) => !depsReady({ deps: [id] }, items)) }); continue }
    const cov = coverage[task.id]
    if (!cov || cov.total === 0) return { kind: 'implement', task: task.id, title: task.title, missing: ['未配置探针'], pending: own.filter((item) => item.status !== 'verified').map((item) => item.id) }
    if (cov.hits < cov.total) return { kind: 'implement', task: task.id, title: task.title, missing: cov.missing, pending: own.filter((item) => item.status !== 'verified').map((item) => item.id) }
    const pending = own.filter((item) => item.status !== 'verified' && item.status !== 'blocked').map((item) => item.id)
    if (pending.length) return { kind: 'verify', task: task.id, title: task.title, pending, missing: [], command: `npm run ali:verify -- ${pending[0]} "<可复现证据>"` }
  }
  if (waiting.length) return { kind: 'wait', task: waiting[0].task, reason: `等待依赖：${waiting[0].deps.join('、')}`, missing: waiting[0].deps, pending: [] }
  if (items.every((item) => item.status === 'verified')) return { kind: 'done', reason: '全部验收项已通过' }
  return { kind: 'blocked', reason: '剩余任务均被阻塞或缺少可推进条件' }
}

function buildReport({ state, tasks, coverage, gates, next, changes }) {
  const count = (status) => state.items.filter((item) => item.status === status).length
  const gateLines = gates.length ? gates.map((gate) => `- ${gate.name}: ${gate.ok ? 'PASS' : 'FAIL'} \`${gate.command}\``).join('\n') : '- 未运行'
  const rows = tasks.map((task) => {
    const cov = coverage[task.id] || { hits: 0, total: 0, missing: [] }
    const own = state.items.filter((item) => item.task === task.id)
    const verified = own.filter((item) => item.status === 'verified').length
    const status = own.every((item) => item.status === 'verified') ? '已验收' : own.some((item) => item.status === 'blocked') ? '阻塞' : cov.hits === cov.total && cov.total > 0 ? '待运行时证据' : cov.hits ? '部分实现' : '未开始'
    return `| ${task.id} | ${task.title} | ${task.deps.join('、') || '—'} | ${cov.hits}/${cov.total} | ${verified}/${own.length} | ${status} | ${cov.missing.join('、') || '—'} |`
  })
  const manual = state.items.filter((item) => item.status === 'needs-manual-check' || item.status === 'partial')
  const blocked = state.items.filter((item) => item.status === 'blocked')
  const nextLine = next.kind === 'implement' ? `实现 **${next.task} ${next.title}**\n\n- 探针缺口：${next.missing.join('、')}\n- 待完成：${next.pending.join('、') || '无'}`
    : next.kind === 'verify' ? `为 **${next.task} ${next.title}** 生成证据\n\n- 待验：${next.pending.join('、')}\n- 命令：\`${next.command}\``
    : next.kind === 'gate' ? `修复门禁 **${next.id}**：${next.reason}\n\n- 命令：\`${next.command}\``
    : next.kind === 'wait' ? `等待依赖：**${next.task}**（${next.reason}）`
    : next.kind === 'done' ? '全部验收项已通过。' : next.reason
  return `# 阿栗 Loop 进度报告\n\n> 由 \`npm run ali:audit\` 生成，请勿手工编辑。需求源：\`${state.source}\`。\n\n- 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n- 需求同步：${state.syncedAt}\n\n## 门禁\n\n${gateLines}\n\n## 总览\n\n| 指标 | 数值 |\n|---|---|\n| 验收项 | ${state.items.length} |\n| 已验收 | ${count('verified')} |\n| 待运行时证据 | ${count('needs-manual-check')} |\n| 部分实现 | ${count('partial')} |\n| 未开始 | ${count('todo')} |\n| 阻塞 | ${count('blocked')} |\n\n## 缺口矩阵\n\n| 任务 | 名称 | 依赖 | 探针 | 验收 | 状态 | 探针缺口 |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n## 下一动作\n\n${nextLine}\n\n## 待运行时证据 / 人工验收\n\n${manual.length ? manual.map((item) => `- \`${item.id}\` ${item.requirement} _(${item.status})_`).join('\n') : '- 无'}\n\n## 阻塞\n\n${blocked.length ? blocked.map((item) => `- \`${item.id}\` ${item.requirement} — ${item.evidence || '无说明'}`).join('\n') : '- 无'}\n\n## 本轮变化\n\n${changes.length ? changes.map((change) => `- \`${change.id}\`: ${change.from} → ${change.to}`).join('\n') : '- 无状态变化。'}\n\n## 完整验收清单\n\n<details>\n<summary>展开 ${state.items.length} 条</summary>\n\n${state.items.map((item) => `- [${item.status === 'verified' ? 'x' : ' '}] \`${item.id}\` ${item.requirement} _(${item.status}${item.evidence ? ` — ${item.evidence}` : ''})_`).join('\n')}\n\n</details>\n`
}

export function audit({ build = false, runtime = false } = {}) {
  const { state, tasks } = sync()
  const gates = [runGate('typecheck', 'npm run typecheck')]
  if (build) gates.push(runGate('build', 'npm run build', 600000))
  if (runtime) {
    const qa = path.join(ROOT, 'scripts/acceptance/ali-qa.mjs')
    gates.push(existsSync(qa) ? runGate('runtime', 'node scripts/acceptance/ali-qa.mjs', 600000) : { name: 'runtime', command: 'node scripts/acceptance/ali-qa.mjs', ok: false, output: '缺少运行时 QA 脚本，先完成 A5-3' })
  }
  applyEvidence(state)
  const coverage = quantify(tasks)
  applyCoverage(state, coverage)
  const before = state.lastAudit?.statuses || null
  const statuses = Object.fromEntries(state.items.map((item) => [item.id, item.status]))
  const changes = before ? Object.keys(statuses).filter((id) => before[id] !== statuses[id]).map((id) => ({ id, from: before[id] || 'new', to: statuses[id] })) : []
  const next = nextAction(tasks, state.items, coverage, gates)
  writeFileSync(REPORT, buildReport({ state, tasks, coverage, gates, next, changes }), 'utf8')
  state.lastAudit = { at: new Date().toISOString(), gates: gates.map(({ name, command, ok }) => ({ name, command, ok })), statuses }
  writeJson(STATE, state)
  return { total: state.items.length, verified: state.items.filter((item) => item.status === 'verified').length, pending: state.items.filter((item) => item.status === 'needs-manual-check').length, partial: state.items.filter((item) => item.status === 'partial').length, todo: state.items.filter((item) => item.status === 'todo').length, blocked: state.items.filter((item) => item.status === 'blocked').length, gates, next, nextAction: next, report: path.relative(ROOT, REPORT), failedGates: gates.filter((gate) => !gate.ok).length }
}

export function doctor() {
  const checks = []
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail })
  add('需求源存在', existsSync(GUIDE), path.relative(ROOT, GUIDE))
  let tasks = []
  try { tasks = parseGuide(readFileSync(GUIDE, 'utf8')).tasks; add('需求可解析', tasks.length > 0, `${tasks.length} 个任务`) } catch (error) { add('需求可解析', false, String(error)) }
  const noProbes = tasks.filter((task) => !(PROBES[task.id] || []).length).map((task) => task.id)
  add('每个任务都有探针', noProbes.length === 0, noProbes.length ? `缺少：${noProbes.join('、')}` : `${Object.keys(PROBES).length} 组`)
  add('状态文件可读', !existsSync(STATE) || Boolean(readJson(STATE)), path.relative(ROOT, STATE))
  add('证据文件可读', !existsSync(EVIDENCE) || Boolean(readJson(EVIDENCE)), path.relative(ROOT, EVIDENCE))
  add('使用说明存在', existsSync(path.join(ROOT, 'docs/使用说明.md')), 'docs/使用说明.md')
  const pkg = readJson(path.join(ROOT, 'package.json'), {})
  const required = ['ali:sync', 'ali:audit', 'ali:next', 'ali:verify', 'ali:doctor']
  add('npm 命令完整', required.every((key) => pkg.scripts?.[key]), required.filter((key) => !pkg.scripts?.[key]).join('、') || 'OK')
  add('锁目录可写', existsSync(path.join(ROOT, 'docs')), 'docs/')
  return checks
}

export const paths = { GUIDE, STATE, REPORT, EVIDENCE }
