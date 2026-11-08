#!/usr/bin/env node
import { existsSync, writeFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { ROOT, sync, audit, setStatus, loadState, doctor } from './ali-loop-lib.mjs'

const LOCK = path.join(ROOT, 'docs/ali-loop.lock')
const args = process.argv.slice(2)
const command = args[0] || 'help'
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const positional = args.slice(1).filter((arg) => !arg.startsWith('--'))

function printStatus(state) {
  const count = (status) => state.items.filter((item) => item.status === status).length
  console.log('阿栗 Loop 状态')
  console.log(`  验收项：${state.items.length} 条（verified ${count('verified')} / 待证据 ${count('needs-manual-check')} / 部分 ${count('partial')} / 未开始 ${count('todo')} / 阻塞 ${count('blocked')}）`)
  if (state.lastAudit) console.log(`  最近审计：${state.lastAudit.at}`)
}

function printAudit(summary) {
  console.log('审计完成')
  console.log(`  门禁：${summary.gates.map((gate) => `${gate.name} ${gate.ok ? 'PASS' : 'FAIL'}`).join(' / ')}`)
  console.log(`  验收项：${summary.total} 条（verified ${summary.verified} / 待证据 ${summary.pending} / 部分 ${summary.partial} / 未开始 ${summary.todo} / 阻塞 ${summary.blocked}）`)
  console.log(`  报告：${summary.report}`)
  printNext(summary.nextAction)
}

function printNext(next) {
  console.log(`下一动作：${next.kind}`)
  if (next.kind === 'implement') {
    console.log(`  任务：${next.task} ${next.title}`)
    console.log(`  探针缺口：${next.missing.join('、')}`)
    console.log(`  待完成：${next.pending.join('、') || '无'}`)
    console.log(`  下一步：打开 docs/ALI_BUILD_GUIDE.md 的 ${next.task}，实现后运行 npm run ali:audit`)
  } else if (next.kind === 'verify') {
    console.log(`  任务：${next.task} ${next.title}`)
    console.log(`  待验：${next.pending.join('、')}`)
    console.log(`  下一步：${next.command}`)
  } else if (next.kind === 'gate') {
    console.log(`  ${next.reason}`)
    console.log(`  命令：${next.command}`)
  } else if (next.kind === 'wait') {
    console.log(`  ${next.reason}`)
  } else {
    console.log(`  ${next.reason}`)
  }
}

switch (command) {
  case 'sync': {
    const { state, tasks } = sync()
    console.log(`已同步阿栗需求：${tasks.length} 个任务，${state.items.length} 条验收项。`)
    printStatus(state)
    break
  }
  case 'audit': {
    printAudit(audit({ build: flags.has('--build'), runtime: flags.has('--runtime') }))
    break
  }
  case 'next': {
    const summary = audit({ build: flags.has('--build'), runtime: flags.has('--runtime') })
    if (flags.has('--json')) console.log(JSON.stringify(summary.nextAction, null, 2))
    else { printAudit(summary); console.log(`  机器可读：node scripts/ali-loop.mjs next --json`) }
    if (summary.failedGates && !flags.has('--json')) process.exitCode = 1
    break
  }
  case 'verify':
  case 'done': {
    const id = positional[0]
    const note = positional.slice(1).join(' ')
    if (!id) { console.error('用法：npm run ali:verify -- <条目ID> "<证据>"'); process.exitCode = 1; break }
    const result = setStatus(id, 'verified', note)
    if (!result.ok) { console.error(result.error); process.exitCode = 1; break }
    console.log(`${id} 已标记为 verified${note ? `：${note}` : ''}`)
    break
  }
  case 'block': {
    const id = positional[0]
    const note = positional.slice(1).join(' ')
    if (!id) { console.error('用法：npm run ali:block -- <条目ID> "<原因>"'); process.exitCode = 1; break }
    const result = setStatus(id, 'blocked', note)
    if (!result.ok) { console.error(result.error); process.exitCode = 1; break }
    console.log(`${id} 已标记为 blocked${note ? `：${note}` : ''}`)
    break
  }
  case 'reset': {
    const id = positional[0]
    if (!id) { console.error('用法：npm run ali:reset -- <条目ID>'); process.exitCode = 1; break }
    const result = setStatus(id, 'todo')
    if (!result.ok) { console.error(result.error); process.exitCode = 1; break }
    console.log(`${id} 已重置为 todo`)
    break
  }
  case 'status': {
    printStatus(loadState())
    break
  }
  case 'lock': {
    const ttl = Number(positional[0]) || 30
    if (existsSync(LOCK)) {
      const age = (Date.now() - statSync(LOCK).mtimeMs) / 60000
      if (age < ttl) { console.log(`LOCKED：上一轮仍在运行或未释放锁（${Math.round(age)} 分钟前）`); process.exitCode = 2; break }
    }
    writeFileSync(LOCK, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, 'utf8')
    console.log('ACQUIRED')
    break
  }
  case 'unlock': {
    rmSync(LOCK, { force: true })
    console.log('RELEASED')
    break
  }
  case 'doctor': {
    const checks = doctor()
    for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
    if (checks.some((check) => !check.ok)) process.exitCode = 1
    break
  }
  default:
    console.log(`用法：node scripts/ali-loop.mjs <command>

命令：
  sync                          从 docs/ALI_BUILD_GUIDE.md 同步验收项
  audit [--build] [--runtime]   运行门禁、应用证据、生成报告
  next [--json]                 输出下一动作（自动化读取 --json）
  verify <ID> ["证据"]          人工/运行时证据通过
  block <ID> ["原因"]           标记阻塞
  reset <ID>                    重置为 todo
  status                        查看状态
  lock [TTL分钟]                获取运行锁（默认 30 分钟）
  unlock                        释放运行锁
  doctor                        检查 Loop 自身配置

示例：
  npm run ali:audit
  node scripts/ali-loop.mjs next --json
  npm run ali:verify -- A0-1-A1 "类型检查 + 页面实际读写通过"
  npm run ali:block -- A5-3-A1 "当前环境无 GUI，等待 Windows 验收"
`)
}
