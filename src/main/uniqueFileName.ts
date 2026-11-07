import { promises as fs } from 'fs'
import path from 'path'

export async function uniqueFileName(target: string): Promise<string> {
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  let candidate = target
  let counter = 1
  for (;;) {
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
    candidate = path.join(dir, `${base} (${counter})${ext}`)
    counter++
  }
}
