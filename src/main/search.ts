import { store } from './store'
import type { SearchResult } from '../shared/types'
import { t } from '../shared/i18n'

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function snippet(text: string, query: string, radius = 60): string {
  const clean = normalize(text)
  const index = clean.toLowerCase().indexOf(query)
  if (index < 0) return clean.slice(0, radius * 2)
  const start = Math.max(0, index - radius)
  const end = Math.min(clean.length, index + query.length + radius)
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`
}

function hit(text: string, query: string): boolean {
  return text.toLowerCase().includes(query)
}

export async function globalSearch(rawQuery: string, limit = 40): Promise<SearchResult[]> {
  const query = rawQuery.trim().toLowerCase()
  const results: SearchResult[] = []

  if (!query) {
    const docs = [...store.data.documents]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6)
      .map<SearchResult>((doc) => ({
        id: `doc:${doc.id}`,
        type: 'document',
        title: doc.title,
        snippet: [doc.authors, doc.year].filter(Boolean).join(' · ') || t("最近打开的文献"),
        docId: doc.id,
        page: doc.lastPage || 1,
        updatedAt: doc.updatedAt
      }))
    const chats = [...store.data.chats]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6)
      .map<SearchResult>((chat) => ({
        id: `chat:${chat.id}`,
        type: 'chat',
        title: chat.title || t("新的对话"),
        snippet: chat.messages.length ? normalize(chat.messages[chat.messages.length - 1].content).slice(0, 80) : t("空对话"),
        chatId: chat.id,
        updatedAt: chat.updatedAt
      }))
    return [...docs, ...chats].slice(0, limit)
  }

  for (const doc of store.data.documents) {
    const meta = [doc.title, doc.authors, doc.abstract, doc.year, doc.journal, doc.tags.join(' ')].join('\n')
    let page: number | undefined
    let text = hit(meta, query) ? snippet(meta, query) : ''
    const notesHit = hit(doc.notes, query)
    if (notesHit) {
      results.push({
        id: `note:${doc.id}`,
        type: 'note',
        title: t("《{0}》笔记", [doc.title]),
        snippet: snippet(doc.notes, query),
        docId: doc.id,
        updatedAt: doc.updatedAt
      })
    }
    if (!text) {
      const pages = await store.getDocumentTexts(doc.id)
      for (let index = 0; index < pages.length; index++) {
        if (hit(pages[index], query)) {
          page = index + 1
          text = snippet(pages[index], query)
          break
        }
      }
    }
    if (text) {
      results.push({
        id: `doc:${doc.id}`,
        type: 'document',
        title: doc.title,
        snippet: text,
        docId: doc.id,
        page,
        updatedAt: doc.updatedAt
      })
    }
  }

  for (const chat of store.data.chats) {
    if (hit(chat.title, query)) {
      results.push({
        id: `chat:${chat.id}`,
        type: 'chat',
        title: chat.title || t("新的对话"),
        snippet: t("{0} 条消息", [chat.messages.length]),
        chatId: chat.id,
        updatedAt: chat.updatedAt
      })
    }
    let matched = 0
    for (const message of chat.messages) {
      if (matched >= 3) break
      if (message.role === 'system' || !hit(message.content, query)) continue
      matched += 1
      results.push({
        id: `msg:${chat.id}:${message.id}`,
        type: 'message',
        title: chat.title || t("新的对话"),
        snippet: t("{0}：{1}", [message.role === 'user' ? '你' : '助手', snippet(message.content, query)]),
        chatId: chat.id,
        updatedAt: message.createdAt
      })
    }
  }

  for (const excerpt of store.data.excerpts) {
    const body = [excerpt.question, excerpt.answer, excerpt.source].join('\n')
    if (!hit(body, query)) continue
    results.push({
      id: `excerpt:${excerpt.id}`,
      type: 'excerpt',
      title: t("《{0}》{1}", [excerpt.docTitle, excerpt.page ? ` 第 ${excerpt.page} 页` : '']),
      snippet: snippet(body, query),
      docId: excerpt.docId ?? undefined,
      page: excerpt.page,
      docMissing: excerpt.docMissing,
      updatedAt: excerpt.updatedAt
    })
  }

  for (const collection of store.data.collections) {
    if (!hit(collection.name, query)) continue
    results.push({
      id: `collection:${collection.id}`,
      type: 'collection',
      title: collection.name,
      snippet: t("分类"),
      collectionId: collection.id,
      updatedAt: collection.createdAt
    })
  }

  return results.slice(0, limit)
}
