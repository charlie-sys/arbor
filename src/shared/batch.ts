import type { ReadingStatus } from './types'

export interface DocumentBatchPatch {
  readingStatus?: ReadingStatus
  starred?: boolean
  collections?: { mode: 'add' | 'remove' | 'replace'; ids: string[] }
  tags?: { mode: 'add' | 'remove' | 'replace'; values: string[] }
}
