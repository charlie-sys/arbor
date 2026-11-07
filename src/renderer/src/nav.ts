export type View =
  | { name: 'library'; collectionId?: string }
  | { name: 'reader'; docId: string }
  | { name: 'chats'; chatId?: string }
  | { name: 'translations'; selectedId?: string }
  | { name: 'settings' }
