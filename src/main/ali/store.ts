import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { writeJsonAtomic } from './atomic'
import { t } from '../../shared/i18n'
import type { AliMessage, AliSession } from '../../shared/ali'

const VERSION = 1

function uid(): string {
  return crypto.randomUUID()
}

function normalizeMessage(raw: unknown): AliMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<AliMessage>
  if (typeof value.id !== 'string' || typeof value.content !== 'string') return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    ...(value.error ? { error: true } : {}),
    ...(Array.isArray(value.sources) ? { sources: value.sources } : {}),
    ...(Array.isArray(value.helpSections) ? { helpSections: value.helpSections } : {}),
    ...(Array.isArray(value.toolTraces) ? { toolTraces: value.toolTraces } : {})
  }
}

function normalizeSession(raw: unknown): AliSession | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<AliSession>
  if (typeof value.id !== 'string' || !value.id) return null
  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeMessage).filter((item): item is AliMessage => Boolean(item))
    : []
  const now = Date.now()
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : '',
    messages,
    summary: typeof value.summary === 'string' ? value.summary : '',
    ...(typeof value.summaryUpTo === 'string' ? { summaryUpTo: value.summaryUpTo } : {}),
    ...(typeof value.memoryCursor === 'string' ? { memoryCursor: value.memoryCursor } : {}),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now
  }
}

class AliStore {
  root = ''
  sessionsFile = ''
  metaFile = ''
  private sessions: AliSession[] = []
  private saveChain: Promise<void> = Promise.resolve()

  async init(): Promise<void> {
    this.root = path.join(app.getPath('userData'), 'data', 'ali')
    this.sessionsFile = path.join(this.root, 'sessions.json')
    this.metaFile = path.join(this.root, 'meta.json')
    await fs.mkdir(this.root, { recursive: true })
    this.sessions = await this.readSessions()
    await this.writeMeta()
  }

  async reload(): Promise<void> {
    await this.init()
  }

  async flush(): Promise<void> {
    await this.saveChain
  }

  list(): AliSession[] {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): AliSession | undefined {
    return this.sessions.find((session) => session.id === id)
  }

  async create(): Promise<AliSession> {
    const now = Date.now()
    const session: AliSession = {
      id: uid(),
      title: t('新的对话'),
      messages: [],
      summary: '',
      createdAt: now,
      updatedAt: now
    }
    this.sessions.push(session)
    await this.save()
    return session
  }

  async update(
    id: string,
    patch: Partial<Pick<AliSession, 'title' | 'messages' | 'summary' | 'summaryUpTo' | 'memoryCursor'>>
  ): Promise<AliSession | undefined> {
    const session = this.get(id)
    if (!session) return undefined
    Object.assign(session, patch, { id: session.id, updatedAt: Date.now() })
    if (!session.title.trim() || session.title === t('新的对话')) {
      const first = session.messages.find((message) => message.role === 'user' && message.content.trim())
      if (first) session.title = first.content.trim().slice(0, 30)
    }
    await this.save()
    return session
  }

  async append(id: string, message: AliMessage): Promise<AliSession | undefined> {
    const session = this.get(id)
    if (!session) return undefined
    return this.update(id, { messages: [...session.messages, message] })
  }

  async remove(id: string): Promise<void> {
    const before = this.sessions.length
    this.sessions = this.sessions.filter((session) => session.id !== id)
    if (this.sessions.length !== before) await this.save()
  }

  private async readSessions(): Promise<AliSession[]> {
    let raw: string
    try {
      raw = await fs.readFile(this.sessionsFile, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await writeJsonAtomic(this.sessionsFile, { version: VERSION, sessions: [] })
      return []
    }
    try {
      const parsed = JSON.parse(raw) as { sessions?: unknown }
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.map(normalizeSession).filter((item): item is AliSession => Boolean(item))
        : []
      if (sessions.length !== (parsed.sessions as unknown[] | undefined)?.length) {
        await writeJsonAtomic(this.sessionsFile, { version: VERSION, sessions })
      }
      return sessions
    } catch {
      const corrupt = `${this.sessionsFile}.corrupt-${Date.now()}`
      await fs.rename(this.sessionsFile, corrupt).catch(() => undefined)
      await writeJsonAtomic(this.sessionsFile, { version: VERSION, sessions: [] })
      return []
    }
  }

  private async writeMeta(): Promise<void> {
    await writeJsonAtomic(this.metaFile, {
      version: VERSION,
      updatedAt: Date.now(),
      sessions: this.sessions.length
    }).catch(() => undefined)
  }

  save(): Promise<void> {
    this.saveChain = this.saveChain.then(() => this.writeNow()).catch((error) => {
      console.error('Failed to save Ali sessions', error)
    })
    return this.saveChain
  }

  private async writeNow(): Promise<void> {
    await writeJsonAtomic(this.sessionsFile, { version: VERSION, sessions: this.sessions })
    await this.writeMeta()
  }
}

export const aliStore = new AliStore()
