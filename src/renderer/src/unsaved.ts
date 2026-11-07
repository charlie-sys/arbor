import { useEffect } from 'react'

const dirtySources = new Set<string>()

export function markUnsaved(source: string, dirty: boolean): void {
  if (dirty) dirtySources.add(source)
  else dirtySources.delete(source)
}

export function hasUnsavedChanges(): boolean {
  return dirtySources.size > 0
}

export function useUnsavedChanges(source: string, dirty: boolean): void {
  useEffect(() => {
    markUnsaved(source, dirty)
    return () => markUnsaved(source, false)
  }, [source, dirty])
}
