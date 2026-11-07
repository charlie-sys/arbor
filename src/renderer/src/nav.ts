export type View =
  | { name: 'library'; collectionId?: string; savedViewId?: string }
  | { name: 'reader'; docId: string; page?: number }
  | { name: 'chats'; chatId?: string; question?: string }
  | { name: 'topics'; topicId?: string }
  | { name: 'canvas'; canvasId?: string }
  | { name: 'readingPlan' }
  | { name: 'inbox' }
  | { name: 'translations'; selectedId?: string }
  | { name: 'settings' }
