import type { Collection } from './types'

export function collectionPath(collections: Collection[], id: string): string {
  const names: string[] = []
  const seen = new Set<string>()
  let current = collections.find(item => item.id === id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    current = collections.find(item => item.id === current?.parentId)
  }
  return names.join(' / ')
}

export function collectionDescendants(collections: Collection[], id: string): Set<string> {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const item of collections) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true }
    }
  }
  return ids
}
