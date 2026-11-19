import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import {
  parseHelp,
  searchHelpSections,
  shouldRetrieveHelp,
  type AliHelpSection
} from '../../shared/aliAgent'

export type HelpSection = AliHelpSection
export { shouldRetrieveHelp }

let cache: {
  mtime: number
  size: number
  sections: HelpSection[]
} | null = null

export async function loadHelpSections(): Promise<HelpSection[]> {
  const file = path.join(app.getAppPath(), 'docs', '使用说明.md')
  try {
    const stat = await fs.stat(file)
    if (cache && cache.mtime === stat.mtimeMs && cache.size === stat.size) {
      return cache.sections
    }
    const sections = parseHelp(await fs.readFile(file, 'utf-8'))
    cache = { mtime: stat.mtimeMs, size: stat.size, sections }
    return sections
  } catch {
    cache = null
    return []
  }
}

export async function searchHelp(
  query: string,
  limit = 2,
  budget = 2200
): Promise<HelpSection[]> {
  return searchHelpSections(
    await loadHelpSections(),
    query,
    limit,
    budget
  )
}
