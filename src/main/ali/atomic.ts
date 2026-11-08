import { promises as fs } from 'fs'
import path from 'path'

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await writeTextAtomic(file, `${JSON.stringify(data, null, 2)}\n`)
}

export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, text, 'utf-8')
  await fs.rename(tmp, file)
}
