#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { ROOT, sync, audit, setStatus, loadState } from './progress-lib.mjs'

const STATE = path.join(ROOT, 'docs/progress.json')
const args = process.argv.slice(2)
const command = args[0] || 'help'
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const positional = args.slice(1).filter((arg) => !arg.startsWith('--'))

function readState() {
  if (!existsSync(STATE)) return sync().state
  return JSON.parse(readFileSync(STATE, 'utf8'))
}

function printStatus(state) {
  const count = (status) => state.items.filter((item) => item.status === status).length
  const regCount = (status) => state.regressions.filter((item) => item.status === status).length
  console.log('ZotAgent 进度状态')
  console.log(`  验收项：${state.items.length} 条（verified ${count('verified')} / 待人工 ${count('needs-manual-check')} / 部分 ${count('partial')} / 未开始 ${count('todo')} / 阻塞 ${count('blocked')}）`)
  console.log(`  回归项：${state.regressions.length} 条（verified ${regCount('verified')} / 未开始 ${regCount('todo')}）`)
  if (state.lastAudit) console.log(`  最近审计：${state.lastAudit.at}`)
}

switch (command) {
  case 'sync': {
    const { state } = sync()
    console.log(`已同步需求：${state.items.length} 条验收项，${state.regressions.length} 条回归项。`)
    printStatus(state)
    break
  }

  case 'audit': {
    const summary = audit({ build: flags.has('--build') })
    console.log('审计完成')
    console.log(`  门禁：${summary.gates.map((gate) => `${gate.name} ${gate.ok ? 'PASS' : 'FAIL'}`).join(' / ')}`)
    console.log(`  验收项：${summary.total} 条（verified ${summary.verified} / 待人工 ${summary.pending} / 部分 ${summary.partial} / 未开始 ${summary.todo} / 阻塞 ${summary.blocked}）`)
    console.log(`  下一任务：${summary.next || '无自动可推进任务'}`)
    console.log(`  报告：${summary.report}`)
    if (summary.failedGates) process.exitCode = 1
    break
  }

  case 'verify':
  case 'done': {
    const id = positional[0]
    const note = positional.slice(1).join(' ')
    if (!id) {
      console.error('用法：npm run progress:verify -- <条目ID> "<证据>"')
      process.exitCode = 1
      break
    }
    const result = setStatus(id, 'verified', note)
    if (!result.ok) {
      console.error(result.error)
      process.exitCode = 1
      break
    }
    console.log(`${id} 已标记为 verified${note ? `：${note}` : ''}`)
    break
  }

  case 'block': {
    const id = positional[0]
    const note = positional.slice(1).join(' ')
    if (!id) {
      console.error('用法：npm run progress:block -- <条目ID> "<阻塞原因>"')
      process.exitCode = 1
      break
    }
    const result = setStatus(id, 'blocked', note)
    if (!result.ok) {
      console.error(result.error)
      process.exitCode = 1
      break
    }
    console.log(`${id} 已标记为 blocked${note ? `：${note}` : ''}`)
    break
  }

  case 'reset': {
    const id = positional[0]
    if (!id) {
      console.error('用法：npm run progress:reset -- <条目ID>')
      process.exitCode = 1
      break
    }
    const result = setStatus(id, 'todo')
    if (!result.ok) {
      console.error(result.error)
      process.exitCode = 1
      break
    }
    console.log(`${id} 已重置为 todo`)
    break
  }

  case 'status': {
    printStatus(readState())
    break
  }

  default:
    console.log(`用法：node scripts/progress.mjs <command>

命令：
  sync                              从 docs/PROJECT_BUILD_GUIDE.md 同步需求条目
  audit [--build]                   采集探针、运行门禁、更新状态并生成报告
  verify <ID> ["证据"]              人工验收通过（UI/交互项）
  block <ID> ["原因"]               标记阻塞，自动推进 loop 会跳过
  reset <ID>                        重置为 todo
  status                            查看当前状态

示例：
  npm run progress:audit -- --build
  npm run progress:verify -- P0-1-A1 "选中变黄，重启后仍在原位置"
  npm run progress:block -- P0-2-A1 "PDF 无书签且解析失败，等待样例"
`)
}
