import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/** Saved updates flow through until a user explicitly edits this field. */
export function useDraftField<T>(saved: T, key: string, equal: (a: T, b: T) => boolean = Object.is): [T, Dispatch<SetStateAction<T>>, (submitted: T) => void] {
  const [edit, setEdit] = useState<{ key: string; value: T } | null>(null)
  const value = edit?.key === key ? edit.value : saved
  useEffect(() => {
    setEdit(current => current && (current.key !== key || equal(current.value, saved)) ? null : current)
  }, [saved, key, equal])
  const change = useCallback<Dispatch<SetStateAction<T>>>(next => {
    setEdit(current => {
      const previous = current?.key === key ? current.value : saved
      const value = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
      return equal(value, saved) ? null : { key, value }
    })
  }, [saved, key, equal])
  // A successful save can trim/normalize values. Clear only the submitted edit,
  // retaining any newer text entered while that save was in flight.
  const accept = useCallback((submitted: T) => {
    setEdit(current => current?.key === key && equal(current.value, submitted) ? null : current)
  }, [key, equal])
  return [value, change, accept]
}

export function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(value => b.includes(value))
}
