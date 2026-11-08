export const MEMORY_QUOTA = 3000
export const SELF_QUOTA = 1800

export function usageRatio(text: string, quota: number): number {
  return quota > 0 ? text.length / quota : 0
}

export function needsConsolidation(text: string, quota: number): boolean {
  return usageRatio(text, quota) >= 0.85
}

export function pruneToTarget(
  text: string,
  quota: number,
  target = 0.7
): { text: string; removed: string[] } {
  const lines = text.split(/\r?\n/)
  const explicitIndex = lines.findIndex((line) => line.trim() === '## 明确要求长期记住')
  const removable = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index !== explicitIndex && (explicitIndex < 0 || index < explicitIndex) && line.startsWith('- '))
  const remove = new Set<number>()
  const removed: string[] = []
  let length = text.length
  for (const item of removable) {
    if (length <= quota * target) break
    remove.add(item.index)
    removed.push(item.line)
    length -= item.line.length + 1
  }
  return { text: lines.filter((_, index) => !remove.has(index)).join('\n'), removed }
}
