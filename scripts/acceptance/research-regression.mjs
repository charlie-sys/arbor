import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dir = await mkdtemp(join(tmpdir(), 'arbor-regression-'))
try {
  const entry = join(dir, 'test.cjs')
  await build({ entryPoints: [process.argv[2] || 'scripts/acceptance/research-regression.ts'], outfile: entry, bundle: true,
    platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' })
  const env = { ...process.env, ARBOR_TEST_DIR: dir }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [entry], { env, stdio: 'inherit', windowsHide: true })
  const timeout = setTimeout(() => child.kill(), 60000)
  const code = await new Promise((resolve) => child.on('exit', resolve))
  clearTimeout(timeout)
  process.exitCode = code ?? 1
} finally {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 })
}
