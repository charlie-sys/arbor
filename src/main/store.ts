import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import type {
  AppSettings,
  ChatSession,
  Collection,
  DocumentMeta,
  LibraryData,
  TranslationRecord
} from '../shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  chatModel: 'deepseek-chat',
  visionModel: '',
  temperature: 0.3,
  maxContextChars: 24000,
  systemPrompt:
    '你是一位严谨、细致的学术研究助手。你会基于用户提供的文献原文回答问题：结论必须有原文依据；引用时注明《文献标题》第N页；原文没有的信息要明确说明"文献中未提及"，不得编造。回答使用中文，结构清晰，必要时使用 Markdown 小标题、列表和表格。'
}

export function uid(): string {
  return crypto.randomUUID()
}

function emptyData(): LibraryData {
  return {
    version: 1,
    documents: [],
    collections: [],
    chats: [],
    translations: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

interface StoredSettings extends Partial<AppSettings> {
  apiKeyEnc?: string
}

interface StoredData extends Omit<LibraryData, 'settings'> {
  settings: StoredSettings
}

class Store {
  root = ''
  filesDir = ''
  textsDir = ''
  translationsDir = ''
  data: LibraryData = emptyData()
  private saveChain: Promise<void> = Promise.resolve()

  get libraryFile(): string {
    return path.join(this.root, 'library.json')
  }

  async init(): Promise<void> {
    this.root = path.join(app.getPath('userData'), 'data')
    this.filesDir = path.join(this.root, 'files')
    this.textsDir = path.join(this.root, 'texts')
    this.translationsDir = path.join(this.root, 'translations')
    await fs.mkdir(this.filesDir, { recursive: true })
    await fs.mkdir(this.textsDir, { recursive: true })
    await fs.mkdir(this.translationsDir, { recursive: true })

    try {
      const raw = await fs.readFile(this.libraryFile, 'utf-8')
      const parsed = JSON.parse(raw) as StoredData
      const settings = { ...DEFAULT_SETTINGS, ...parsed.settings }
      if (parsed.settings.apiKeyEnc) {
        try {
          settings.apiKey = safeStorage.decryptString(Buffer.from(parsed.settings.apiKeyEnc, 'base64'))
        } catch {
          settings.apiKey = ''
        }
      }
      delete (settings as StoredSettings).apiKeyEnc
      this.data = {
        version: 1,
        documents: parsed.documents ?? [],
        collections: parsed.collections ?? [],
        chats: parsed.chats ?? [],
        translations: parsed.translations ?? [],
        settings
      }
    } catch {
      this.data = emptyData()
      await this.save()
    }
  }

  save(): Promise<void> {
    this.saveChain = this.saveChain.then(() => this.writeNow()).catch((err) => {
      console.error('Failed to save library', err)
    })
    return this.saveChain
  }

  private async writeNow(): Promise<void> {
    const settings: StoredSettings = { ...this.data.settings }
    if (settings.apiKey) {
      if (safeStorage.isEncryptionAvailable()) {
        settings.apiKeyEnc = safeStorage.encryptString(settings.apiKey).toString('base64')
      }
    }
    const disk: StoredData = { ...this.data, settings }
    delete (disk.settings as StoredSettings).apiKey
    const tmp = `${this.libraryFile}.tmp`
    await fs.writeFile(tmp, JSON.stringify(disk, null, 2), 'utf-8')
    await fs.rename(tmp, this.libraryFile)
  }

  getDocument(id: string): DocumentMeta | undefined {
    return this.data.documents.find((d) => d.id === id)
  }

  getChat(id: string): ChatSession | undefined {
    return this.data.chats.find((c) => c.id === id)
  }

  async addDocument(filePath: string, title: string): Promise<DocumentMeta> {
    const id = uid()
    const fileName = `${id}.pdf`
    await fs.copyFile(filePath, path.join(this.filesDir, fileName))
    const now = Date.now()
    const doc: DocumentMeta = {
      id,
      title,
      authors: '',
      year: '',
      journal: '',
      abstract: '',
      doi: '',
      url: '',
      tags: [],
      collections: [],
      addedAt: now,
      updatedAt: now,
      fileName,
      pageCount: 0,
      starred: false,
      lastPage: 1,
      notes: ''
    }
    this.data.documents.unshift(doc)
    await this.save()
    return doc
  }

  async setDocumentText(id: string, pages: string[], meta?: { title?: string; authors?: string }): Promise<void> {
    await fs.writeFile(path.join(this.textsDir, `${id}.json`), JSON.stringify(pages), 'utf-8')
    const doc = this.getDocument(id)
    if (!doc) return
    doc.pageCount = pages.length
    if (meta?.title && (!doc.title || doc.title === path.basename(doc.fileName))) doc.title = meta.title
    if (meta?.authors && !doc.authors) doc.authors = meta.authors
    doc.updatedAt = Date.now()
    await this.save()
  }

  async getDocumentTexts(id: string): Promise<string[]> {
    try {
      const raw = await fs.readFile(path.join(this.textsDir, `${id}.json`), 'utf-8')
      const pages = JSON.parse(raw)
      return Array.isArray(pages) ? pages : []
    } catch {
      return []
    }
  }

  async updateDocument(id: string, patch: Partial<DocumentMeta>): Promise<DocumentMeta | undefined> {
    const doc = this.getDocument(id)
    if (!doc) return undefined
    Object.assign(doc, patch, { id: doc.id, updatedAt: Date.now() })
    await this.save()
    return doc
  }

  async deleteDocument(id: string): Promise<void> {
    this.data.documents = this.data.documents.filter((d) => d.id !== id)
    this.data.chats.forEach((chat) => {
      chat.docIds = chat.docIds.filter((d) => d !== id)
    })
    await Promise.allSettled([
      fs.unlink(path.join(this.filesDir, `${id}.pdf`)),
      fs.unlink(path.join(this.textsDir, `${id}.json`))
    ])
    await this.save()
  }

  async addCollection(name: string): Promise<Collection> {
    const collection: Collection = { id: uid(), name, createdAt: Date.now() }
    this.data.collections.push(collection)
    await this.save()
    return collection
  }

  async renameCollection(id: string, name: string): Promise<void> {
    const collection = this.data.collections.find((c) => c.id === id)
    if (!collection) return
    collection.name = name
    await this.save()
  }

  async deleteCollection(id: string): Promise<void> {
    this.data.collections = this.data.collections.filter((c) => c.id !== id)
    this.data.documents.forEach((doc) => {
      doc.collections = doc.collections.filter((c) => c !== id)
    })
    await this.save()
  }

  async createChat(docIds: string[]): Promise<ChatSession> {
    const now = Date.now()
    const chat: ChatSession = {
      id: uid(),
      title: '新的对话',
      docIds,
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    this.data.chats.unshift(chat)
    await this.save()
    return chat
  }

  async updateChat(id: string, patch: Partial<Pick<ChatSession, 'title' | 'docIds' | 'messages'>>): Promise<ChatSession | undefined> {
    const chat = this.getChat(id)
    if (!chat) return undefined
    Object.assign(chat, patch, { updatedAt: Date.now() })
    await this.save()
    return chat
  }

  async deleteChat(id: string): Promise<void> {
    this.data.chats = this.data.chats.filter((c) => c.id !== id)
    await this.save()
  }

  async addTranslation(record: TranslationRecord): Promise<void> {
    this.data.translations.unshift(record)
    await this.save()
  }

  async deleteTranslation(id: string): Promise<void> {
    const record = this.data.translations.find((t) => t.id === id)
    this.data.translations = this.data.translations.filter((t) => t.id !== id)
    if (record) {
      await fs.unlink(path.join(this.translationsDir, record.imageFile)).catch(() => undefined)
      if (record.translatedImageFile) {
        await fs.unlink(path.join(this.translationsDir, record.translatedImageFile)).catch(() => undefined)
      }
    }
    await this.save()
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.data.settings = { ...this.data.settings, ...patch }
    await this.save()
    return this.data.settings
  }
}

export const store = new Store()
