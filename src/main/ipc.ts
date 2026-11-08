import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { store } from './store'
import { usage } from './usage'
import { normalizePricing } from '../shared/usage'
import { setLocale } from '../shared/i18n'
import { streamChat, cancelChat, composeDocument, testConnection } from './llm'
import { exportMarkdown, exportBibtex, exportLibrary, exportDocumentPackage } from './docx'
import { extractDocumentText } from './documentText'
import { formatFromFileName, IMPORTABLE_EXTENSIONS } from '../shared/documents'
import { globalSearch } from './search'
import { startCapture, captureSelection, cancelCapture, resolveRenderResponse } from './capture'
import { suggestInboxOrganization } from './inbox'
import { suggestTopicQuestions } from './topic'
import { generateReadingPlan } from './readingPlan'
import { importBibtexDialog, importReadwiseDialog } from './importers'
import { listBackups, restoreBackup, runBackup } from './backup'
import { runAiAction } from './aiActions'
import { exportAttachmentZip } from './attachmentExport'
import { checkForUpdates, downloadUpdate, installUpdate, openReleasePage } from './updater'
import { applyPetSettings, celebratePet, setPetBusy } from './pet'
import { aliStore } from './ali/store'
import { cancelAli, getAliState, sendAli, testAliConnection, consolidateMemory } from './ali/service'
import { removeMemoryLines, restoreMemoryLine } from './ali/memoryOps'
import { loadHelpSections } from './ali/help'
import { aliMemory } from './ali/memory'
import { createZip, readZip } from './zip'
import type { AliEvent, AliSendRequest, AliSessionPatch } from '../shared/ali'
import type {
  AiActionId,
  CanvasEdge,
  CanvasNode,
  ChatRequest,
  Excerpt,
  Highlight,
  InboxAttachment,
  InboxItem,
  InboxKind,
  InboxSuggestion,
  PropertyType,
  SavedViewConfig
} from '../shared/types'
import type { ChatEvent } from '../shared/api'
import type { ComposeScope } from '../shared/compose'
import { t } from '../shared/i18n'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

function attachmentKind(filePath: string): 'image' | 'file' {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ? 'image' : 'file'
}

async function pickAttachmentFiles(
  kind: 'image' | 'file'
): Promise<{ sourcePath: string; name: string; kind: 'image' | 'file' }[]> {
  const result = await dialog.showOpenDialog({
    title: kind === 'image' ? t("选择要插入的图片") : t("上传附件"),
    properties: ['openFile', 'multiSelections'],
    filters:
      kind === 'image'
        ? [{ name: t("图片"), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
        : [{ name: t("所有文件"), extensions: ['*'] }]
  })
  if (result.canceled || !result.filePaths.length) return []
  return result.filePaths.map((filePath) => ({
    sourcePath: filePath,
    name: path.basename(filePath),
    kind: kind === 'image' ? 'image' : attachmentKind(filePath)
  }))
}

function resolveAttachmentPath(ownerId: string, file: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error(t("附件归属无效"))
  const base = path.join(store.attachmentsDir, ownerId)
  const target = path.normalize(path.join(base, file))
  if (!target.startsWith(base + path.sep)) throw new Error(t("附件路径无效"))
  return target
}

export function registerIpc(): void {
  ipcMain.handle('library:get-state', () => store.data)

  ipcMain.handle('usage:snapshot', () => usage.snapshot())

  ipcMain.handle('usage:clear', async () => {
    await usage.clear()
  })

  ipcMain.handle('search:global', (_event, query: string) => globalSearch(query))

  ipcMain.handle('library:pick-documents', async () => {
    const result = await dialog.showOpenDialog({
      title: t("导入文献"),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: t("文献文件"), extensions: IMPORTABLE_EXTENSIONS },
        { name: t("PDF 文献"), extensions: ['pdf'] },
        { name: t("Word 文档"), extensions: ['docx', 'doc'] },
        { name: t("Markdown / 文本"), extensions: ['md', 'markdown', 'txt'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths.flatMap((filePath) => {
      const fileName = path.basename(filePath)
      const format = formatFromFileName(filePath)
      if (!format) return []
      const title = path.parse(fileName).name.replace(/[_]+/g, ' ').trim()
      return [{ filePath, fileName, title: title || fileName, format }]
    })
  })

  ipcMain.handle('library:import-document', async (_event, payload: { filePath: string; title: string }) => {
    return store.addDocument(payload.filePath, payload.title)
  })

  ipcMain.handle('library:extract-text', (_event, id: string) => extractDocumentText(id))

  ipcMain.handle(
    'library:set-text',
    async (_event, payload: { id: string; pages: string[]; title?: string; authors?: string }) => {
      await store.setDocumentText(payload.id, payload.pages, { title: payload.title, authors: payload.authors })
    }
  )

  ipcMain.handle('library:update', async (_event, payload: { id: string; patch: Record<string, unknown> }) => {
    return store.updateDocument(payload.id, payload.patch)
  })

  ipcMain.handle('library:delete', async (_event, id: string) => {
    await store.deleteDocument(id)
  })

  ipcMain.handle('library:get-texts', async (_event, id: string) => {
    return store.getDocumentTexts(id)
  })

  ipcMain.handle('collection:add', async (_event, payload: string | { name: string; parentId?: string }) => {
    const name = typeof payload === 'string' ? payload : payload.name
    const parentId = typeof payload === 'string' ? undefined : payload.parentId
    return store.addCollection(name, parentId)
  })

  ipcMain.handle(
    'collection:update',
    async (_event, payload: { id: string; patch: { name?: string; parentId?: string; includeChildren?: boolean } }) => {
      return store.updateCollection(payload.id, payload.patch)
    }
  )

  ipcMain.handle('collection:rename', async (_event, payload: { id: string; name: string }) => {
    await store.renameCollection(payload.id, payload.name)
  })

  ipcMain.handle('collection:delete', async (_event, id: string) => {
    await store.deleteCollection(id)
  })

  ipcMain.handle('tag:add', async (_event, input: { name: string; parentId?: string; color?: string }) => {
    return store.addTag(input)
  })

  ipcMain.handle('tag:update', async (_event, payload: { id: string; patch: Partial<{ name: string; parentId: string; color: string }> }) => {
    return store.updateTag(payload.id, payload.patch)
  })

  ipcMain.handle('tag:delete', async (_event, id: string) => {
    await store.deleteTag(id)
  })

  ipcMain.handle('property:add', async (_event, input: { name: string; type: PropertyType; options?: string[] }) => {
    return store.addProperty(input)
  })

  ipcMain.handle(
    'property:update',
    async (_event, payload: { id: string; patch: { name?: string; type?: PropertyType; options?: string[] } }) => {
      return store.updateProperty(payload.id, payload.patch)
    }
  )

  ipcMain.handle('property:delete', async (_event, id: string) => {
    await store.deleteProperty(id)
  })

  ipcMain.handle('view:add', async (_event, payload: { name: string; config: SavedViewConfig }) => {
    return store.addSavedView(payload.name, payload.config)
  })

  ipcMain.handle('view:update', async (_event, payload: { id: string; patch: { name?: string; config?: SavedViewConfig } }) => {
    return store.updateSavedView(payload.id, payload.patch)
  })

  ipcMain.handle('view:delete', async (_event, id: string) => {
    await store.deleteSavedView(id)
  })

  ipcMain.handle('topic:list', () => {
    return store.getResearchTopics()
  })

  ipcMain.handle('topic:add', (_event, input: { name: string; docIds: string[] }) => {
    return store.addResearchTopic(input)
  })

  ipcMain.handle(
    'topic:update',
    (
      _event,
      payload: { id: string; patch: Partial<{ name: string; docIds: string[]; questions: string[]; chatId: string }> }
    ) => {
      return store.updateResearchTopic(payload.id, payload.patch)
    }
  )

  ipcMain.handle('topic:remove', async (_event, id: string) => {
    await store.deleteResearchTopic(id)
  })

  ipcMain.handle('topic:suggest', (_event, id: string) => {
    return suggestTopicQuestions(id)
  })

  ipcMain.handle('backup:list', () => {
    return listBackups()
  })

  ipcMain.handle('backup:run', () => {
    return runBackup()
  })

  ipcMain.handle('backup:restore', async (_event, name: string) => {
    await restoreBackup(name)
  })

  ipcMain.handle('import:bibtex', () => {
    return importBibtexDialog()
  })

  ipcMain.handle('import:readwise', () => {
    return importReadwiseDialog()
  })

  ipcMain.handle('reading-plan:generate', (_event, goal: string) => {
    return generateReadingPlan(goal)
  })

  ipcMain.handle('canvas:add', (_event, name: string) => {
    return store.addCanvas(name)
  })

  ipcMain.handle(
    'canvas:update',
    (_event, payload: { id: string; patch: Partial<{ name: string; nodes: CanvasNode[]; edges: CanvasEdge[] }> }) => {
      return store.updateCanvas(payload.id, payload.patch)
    }
  )

  ipcMain.handle('canvas:delete', async (_event, id: string) => {
    await store.deleteCanvas(id)
  })

  ipcMain.handle('chat:create', async (_event, docIds: string[]) => {
    return store.createChat(docIds)
  })

  ipcMain.handle(
    'chat:update',
    async (_event, payload: { id: string; patch: Record<string, unknown> }) => {
      return store.updateChat(payload.id, payload.patch)
    }
  )

  ipcMain.handle('chat:delete', async (_event, id: string) => {
    await store.deleteChat(id)
  })

  ipcMain.handle(
    'highlight:add',
    async (
      _event,
      input: {
        docId: string
        page: number
        color: Highlight['color']
        text: string
        note?: string
        rects: Highlight['rects']
      }
    ) => {
      if (!store.getDocument(input.docId)) throw new Error(t("文献不存在"))
      if (!Array.isArray(input.rects) || input.rects.length === 0) throw new Error(t("高亮区域无效"))
      return store.addHighlight({
        docId: input.docId,
        page: Math.max(1, Math.round(input.page)),
        color: input.color,
        text: input.text,
        note: input.note ?? '',
        rects: input.rects
      })
    }
  )

  ipcMain.handle(
    'highlight:update',
    async (
      _event,
      payload: { id: string; patch: Partial<Pick<Highlight, 'color' | 'note' | 'rects'>> }
    ) => {
      return store.updateHighlight(payload.id, payload.patch)
    }
  )

  ipcMain.handle('highlight:remove', async (_event, id: string) => {
    await store.deleteHighlight(id)
  })

  ipcMain.handle('highlight:list', (_event, docId: string) => {
    return store.getHighlights(docId)
  })

  ipcMain.handle(
    'excerpt:add',
    (
      _event,
      input: { docId?: string | null; page?: number; source?: string; question?: string; answer?: string }
    ) => {
      return store.addExcerpt(input)
    }
  )

  ipcMain.handle(
    'excerpt:update',
    (
      _event,
      payload: { id: string; patch: Partial<Pick<Excerpt, 'page' | 'source' | 'question' | 'answer'>> }
    ) => {
      return store.updateExcerpt(payload.id, payload.patch)
    }
  )

  ipcMain.handle('excerpt:remove', async (_event, id: string) => {
    await store.deleteExcerpt(id)
  })

  ipcMain.handle('excerpt:list', () => {
    return store.getExcerpts()
  })

  ipcMain.handle('inbox:list', () => {
    return store.getInbox()
  })

  ipcMain.handle(
    'inbox:add',
    (
      _event,
      input: {
        kind: InboxKind
        content: string
        title?: string
        url?: string
        docId?: string
        page?: number
        due?: string
      }
    ) => {
      return store.addInbox(input)
    }
  )

  ipcMain.handle(
    'inbox:update',
    (
      _event,
      payload: { id: string; patch: Partial<Pick<InboxItem, 'content' | 'title' | 'url' | 'archived'>> }
    ) => {
      return store.updateInbox(payload.id, payload.patch)
    }
  )

  ipcMain.handle('inbox:remove', async (_event, id: string) => {
    await store.deleteInbox(id)
  })

  ipcMain.handle('inbox:suggest', () => {
    return suggestInboxOrganization()
  })

  ipcMain.handle('inbox:apply', async (_event, payload: { inboxId: string; suggestion: InboxSuggestion }) => {
    const item = store.data.inbox.find((entry) => entry.id === payload.inboxId)
    if (!item) throw new Error(t("Inbox 条目不存在"))
    const { type, value } = payload.suggestion
    if (!value.trim()) throw new Error(t("建议内容为空"))
    let tagsPatch: string[] | undefined
    if (type === 'tag') {
      await store.addTag({ name: value.trim() })
      tagsPatch = Array.from(new Set([...(item.tags ?? []), value.trim()]))
      if (item.docId) {
        const doc = store.getDocument(item.docId)
        if (doc && !doc.tags.includes(value.trim())) {
          await store.updateDocument(doc.id, { tags: [...doc.tags, value.trim()] })
        }
      }
    } else if (type === 'collection') {
      const collection = await store.addCollection(value.trim())
      if (item.docId) {
        const doc = store.getDocument(item.docId)
        if (doc && !doc.collections.includes(collection.id)) {
          await store.updateDocument(doc.id, { collections: [...doc.collections, collection.id] })
        }
      }
    } else if (type === 'excerpt') {
      await store.addExcerpt({
        docId: item.docId ?? null,
        page: item.page,
        source: value.trim(),
        question: item.title,
        answer: item.content
      })
    } else if (type === 'task') {
      await store.addTask({ title: value.trim(), docId: item.docId, inboxId: item.id })
    }
    await store.updateInbox(item.id, { archived: true, ...(tagsPatch ? { tags: tagsPatch } : {}) })
    return { ok: true }
  })

  ipcMain.handle(
    'inbox:pick-attachments',
    async (_event, payload: { inboxId: string; kind: 'image' | 'file' }) => {
      const files = await pickAttachmentFiles(payload.kind)
      if (!files.length) return []
      return store.addInboxAttachments(payload.inboxId, files)
    }
  )

  ipcMain.handle(
    'inbox:remove-attachment',
    async (_event, payload: { inboxId: string; attachmentId: string }) => {
      await store.removeInboxAttachment(payload.inboxId, payload.attachmentId)
    }
  )

  ipcMain.handle('inbox:export-zip', async (_event, inboxId: string) => {
    const item = store.data.inbox.find((entry) => entry.id === inboxId)
    if (!item) throw new Error(t("Inbox 条目不存在"))
    const fallback = item.content
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/^#+\s*/, '')
      .slice(0, 60)
    return exportAttachmentZip({
      ownerId: item.id,
      title: item.title || fallback || 'inbox',
      content: item.content,
      attachments: item.attachments ?? [],
      fallbackName: 'inbox'
    })
  })

  ipcMain.handle(
    'excerpt:pick-attachments',
    async (_event, payload: { excerptId: string; kind: 'image' | 'file' }) => {
      const files = await pickAttachmentFiles(payload.kind)
      if (!files.length) return []
      return store.addExcerptAttachments(payload.excerptId, files)
    }
  )

  ipcMain.handle(
    'excerpt:remove-attachment',
    async (_event, payload: { excerptId: string; attachmentId: string }) => {
      await store.removeExcerptAttachment(payload.excerptId, payload.attachmentId)
    }
  )

  ipcMain.handle('excerpt:export-zip', async (_event, excerptId: string) => {
    const excerpt = store.data.excerpts.find((entry) => entry.id === excerptId)
    if (!excerpt) throw new Error(t("摘录不存在"))
    const content = [
      excerpt.source ? `> ${excerpt.source.replace(/\n/g, '\n> ')}` : '',
      excerpt.answer
    ]
      .filter(Boolean)
      .join('\n\n')
    return exportAttachmentZip({
      ownerId: excerpt.id,
      title: excerpt.question || excerpt.docTitle || t("摘录"),
      content,
      attachments: excerpt.attachments ?? [],
      fallbackName: `${excerpt.docTitle || 'excerpt'}-p${excerpt.page ?? 1}`
    })
  })

  ipcMain.handle('task:list', () => {
    return store.getTasks()
  })

  ipcMain.handle(
    'task:add',
    (
      _event,
      input: { title: string; due?: string; docId?: string; excerptId?: string; inboxId?: string }
    ) => {
      return store.addTask(input)
    }
  )

  ipcMain.handle(
    'task:update',
    (_event, payload: { id: string; patch: Partial<{ title: string; due: string; done: boolean }> }) => {
      return store.updateTask(payload.id, payload.patch)
    }
  )

  ipcMain.handle('task:remove', async (_event, id: string) => {
    await store.deleteTask(id)
  })

  ipcMain.handle('ali:get-state', () => getAliState())

  ipcMain.handle('ali:session:create', () => aliStore.create())

  ipcMain.handle('ali:session:update', async (_event, payload: { id: string; patch: AliSessionPatch }) => {
    if (!payload || typeof payload.id !== 'string' || !payload.patch || typeof payload.patch !== 'object') {
      throw new Error(t("请求参数无效"))
    }
    return aliStore.update(payload.id, payload.patch)
  })

  ipcMain.handle('ali:session:delete', async (_event, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error(t("请求参数无效"))
    await aliStore.remove(id)
  })

  ipcMain.handle('ali:send', async (event, req: AliSendRequest) => {
    const sender = event.sender
    const finish = (): void => setPetBusy(req.requestId, false)
    setPetBusy(req.requestId, true)
    const emit = (payload: AliEvent): void => {
      if (payload.type === 'done' || payload.type === 'error') {
        finish()
        if (payload.type === 'done') celebratePet()
      }
      if (!sender.isDestroyed()) sender.send('ali:event', payload)
    }
    void sendAli(req, emit).catch(() => finish())
    return { ok: true }
  })

  ipcMain.handle('ali:cancel', async (_event, requestId: string) => {
    if (typeof requestId === 'string') cancelAli(requestId)
  })

  ipcMain.handle('ali:test', () => testAliConnection())

  ipcMain.handle('ali:memory:undo', async (_event, lines: string[]) => {
    if (!Array.isArray(lines)) return 0
    return removeMemoryLines(lines.filter((line): line is string => typeof line === 'string'))
  })

  ipcMain.handle('ali:help', () => loadHelpSections())

  ipcMain.handle('ali:memory:get', () => aliMemory.getState())

  ipcMain.handle('ali:memory:save', async (_event, payload: { doc: string; content: string }) => {
    if (!payload || typeof payload.doc !== 'string' || typeof payload.content !== 'string') {
      throw new Error(t("请求参数无效"))
    }
    await aliMemory.save(payload.doc, payload.content)
    return aliMemory.getState()
  })

  ipcMain.handle('ali:memory:remove', async (_event, doc: string) => {
    await aliMemory.deleteTopic(doc)
  })

  ipcMain.handle('ali:memory:pin', async (_event, payload: { doc: string; pinned: boolean }) => {
    await aliMemory.setPinned(payload.doc, !!payload.pinned)
  })

  ipcMain.handle('ali:memory:clear', async () => {
    await aliMemory.clear()
  })

  ipcMain.handle('ali:memory:consolidate', () => consolidateMemory(true))

  ipcMain.handle('ali:memory:restore', async (_event, payload: { doc: 'MEMORY.md' | 'SELF.md'; line: string }) => {
    await restoreMemoryLine(payload.doc, payload.line)
  })

  ipcMain.handle('ali:memory:export', async () => {
    const entries: { name: string; data: Buffer }[] = []
    const add = async (rel: string): Promise<void> => {
      try {
        entries.push({ name: rel.replace(/\\/g, '/'), data: await fs.readFile(path.join(aliMemory.root, rel)) })
      } catch {
        // missing files are skipped
      }
    }
    await add('SELF.md')
    await add('MEMORY.md')
    for (const dir of ['topics', 'archive']) {
      const names = await fs.readdir(path.join(aliMemory.root, dir)).catch(() => [] as string[])
      for (const name of names) if (name.endsWith('.md')) await add(`${dir}/${name}`)
    }
    const zip = createZip(entries)
    const result = await dialog.showSaveDialog({
      title: t("导出阿栗记忆"),
      defaultPath: path.join(app.getPath('downloads'), `阿栗记忆-${new Date().toISOString().slice(0, 10)}.zip`),
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    await fs.writeFile(result.filePath, zip)
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('ali:memory:import', async () => {
    const result = await dialog.showOpenDialog({
      title: t("导入阿栗记忆"),
      properties: ['openFile'],
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const choice = await dialog.showMessageBox({
      type: 'question',
      buttons: [t("合并"), t("覆盖"), t("取消")],
      defaultId: 0,
      cancelId: 2,
      message: t("如何导入阿栗记忆？"),
      detail: t("合并会保留现有内容并追加新条目；覆盖会替换同名记忆文件。")
    })
    if (choice.response === 2) return { canceled: true }
    const mode = choice.response === 1 ? 'overwrite' : 'merge'
    const entries = readZip(await fs.readFile(result.filePaths[0]))
    let imported = 0
    for (const entry of entries) {
      const name = entry.name.replace(/\\/g, '/')
      if (!/^(SELF|MEMORY)\.md$|^(topics|archive)\/[a-z0-9][a-z0-9._-]{0,80}\.md$/i.test(name)) continue
      const target = path.normalize(path.join(aliMemory.root, name))
      if (!target.startsWith(aliMemory.root + path.sep)) continue
      await fs.mkdir(path.dirname(target), { recursive: true })
      if (mode === 'merge') {
        const incoming = entry.data.toString('utf8')
        const existing = await fs.readFile(target, 'utf-8').catch(() => '')
        if (existing) {
          const additions = incoming
            .split(/\r?\n/)
            .filter((line) => line.startsWith('- ') && !existing.includes(line))
          await fs.writeFile(target, `${existing.trimEnd()}\n${additions.join('\n')}${additions.length ? '\n' : ''}`, 'utf8')
        } else {
          await fs.writeFile(target, incoming)
        }
      } else {
        await fs.writeFile(target, entry.data)
      }
      imported += 1
    }
    return { canceled: false, imported, mode }
  })

  ipcMain.handle('chat:send', async (event, req: ChatRequest) => {
    const sender = event.sender
    const send = (payload: ChatEvent): void => {
      if (!sender.isDestroyed()) sender.send('chat:event', payload)
    }
    const finish = (): void => setPetBusy(req.requestId, false)
    setPetBusy(req.requestId, true)
    const attachments: InboxAttachment[] = []
    void streamChat(req, {
      onDelta: (delta) => send({ requestId: req.requestId, type: 'delta', delta }),
      onAttachment: (attachment) => {
        attachments.push(attachment)
        send({ requestId: req.requestId, type: 'attachment', attachment })
      },
      onDone: (content) => {
        finish()
        celebratePet()
        send({ requestId: req.requestId, type: 'done', content, attachments })
      },
      onError: (error) => {
        finish()
        send({ requestId: req.requestId, type: 'error', error, attachments })
      }
    })
    return { ok: true }
  })

  ipcMain.handle('chat:cancel', async (_event, requestId: string) => {
    cancelChat(requestId)
  })

  ipcMain.handle(
    'ai-action:run',
    (_event, payload: { action: AiActionId; text: string; page?: number; docId?: string; targetDocId?: string }) =>
      runAiAction(payload)
  )

  ipcMain.handle(
    'chat:pick-attachments',
    async (_event, payload: { chatId: string; kind: 'image' | 'file' }) => {
      const files = await pickAttachmentFiles(payload.kind)
      if (!files.length) return []
      return store.addChatAttachments(payload.chatId, files)
    }
  )

  ipcMain.handle(
    'chat:save-attachment',
    async (
      _event,
      payload: { chatId: string; name: string; data: Uint8Array; kind?: 'image' | 'file' }
    ) => {
      const kind = payload.kind ?? attachmentKind(payload.name)
      return store.saveChatAttachment(payload.chatId, payload.name, Buffer.from(payload.data), kind)
    }
  )

  ipcMain.handle(
    'chat:remove-attachment',
    async (_event, payload: { chatId: string; file: string }) => {
      await store.removeChatAttachment(payload.chatId, payload.file)
    }
  )

  ipcMain.handle(
    'attachment:open',
    async (_event, payload: { ownerId: string; file: string }) => {
      const target = resolveAttachmentPath(payload.ownerId, payload.file)
      const error = await shell.openPath(target)
      return error ? { ok: false, error } : { ok: true }
    }
  )

  ipcMain.handle(
    'attachment:save-as',
    async (_event, payload: { ownerId: string; file: string; name: string }) => {
      const target = resolveAttachmentPath(payload.ownerId, payload.file)
      const baseName =
        path.basename(payload.name || payload.file).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || 'attachment'
      const result = await dialog.showSaveDialog({
        title: t("保存附件"),
        defaultPath: path.join(app.getPath('downloads'), baseName)
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      await fs.copyFile(target, result.filePath)
      return { canceled: false, filePath: result.filePath }
    }
  )

  ipcMain.handle(
    'agent:compose',
    async (
      _event,
      payload: { chatId: string; title: string; extraInstruction: string; scope?: ComposeScope; outline?: string }
    ) => {
      return composeDocument(payload.chatId, payload.title, payload.extraInstruction, payload.scope, payload.outline)
    }
  )

  ipcMain.handle(
    'documents:export',
    async (_event, payload: { title: string; markdown: string; format: 'docx' | 'md' }) => {
      return exportMarkdown(payload.markdown, payload.title, payload.format)
    }
  )

  ipcMain.handle('documents:export-bibtex', () => {
    return exportBibtex()
  })

  ipcMain.handle('documents:export-library', (_event, format: 'md' | 'zip') => {
    return exportLibrary(format)
  })

  ipcMain.handle('documents:export-package', (_event, docId: string) => {
    return exportDocumentPackage(docId)
  })

  ipcMain.handle('translate:start', () => {
    return startCapture()
  })

  ipcMain.handle('capture:selection', async (_event, rect: { x: number; y: number; width: number; height: number }) => {
    await captureSelection(rect)
  })

  ipcMain.handle('capture:cancel', () => {
    cancelCapture()
  })

  ipcMain.handle('translate:delete', async (_event, id: string) => {
    await store.deleteTranslation(id)
  })

  ipcMain.handle('translate:list', () => {
    return store.data.translations
  })

  ipcMain.handle(
    'translate:render-response',
    (_event, payload: { requestId: string; dataUrl: string | null }) => {
      resolveRenderResponse(payload.requestId, payload.dataUrl)
    }
  )

  ipcMain.handle(
    'translate:export-image',
    async (_event, payload: { id: string; variant: 'original' | 'translated' }) => {
      const record = store.data.translations.find((item) => item.id === payload.id)
      if (!record) throw new Error(t("翻译记录不存在"))
      const file = payload.variant === 'translated' ? record.translatedImageFile : record.imageFile
      if (!file) throw new Error(t("该记录没有可导出的图片"))
      const result = await dialog.showSaveDialog({
        title: t("保存翻译截图"),
        defaultPath: path.join(app.getPath('pictures'), t("截图翻译-{0}.png", [record.id.slice(0, 8)])),
        filters: [{ name: t("PNG 图片"), extensions: ['png'] }]
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      await fs.copyFile(path.join(store.translationsDir, file), result.filePath)
      return { canceled: false, filePath: result.filePath }
    }
  )

  ipcMain.handle('settings:save', async (_event, patch: Record<string, unknown>) => {
    const clean = { ...patch }
    if (typeof clean.temperature === 'number') {
      clean.temperature = Math.min(2, Math.max(0, clean.temperature))
    }
    if (typeof clean.maxContextChars === 'number') {
      const value = Math.round(clean.maxContextChars)
      clean.maxContextChars = value > 0 ? Math.min(200000, Math.max(4000, value)) : 0
    }
    if (clean.usagePricing) {
      clean.usagePricing = normalizePricing(clean.usagePricing as never)
    }
    const updated = await store.updateSettings(clean as never)
    setLocale(updated.language)
    applyPetSettings({ enabled: updated.petEnabled, bubbles: updated.petBubbles })
    broadcast('settings:changed', updated)
    return updated
  })

  ipcMain.handle('settings:test', async () => {
    return testConnection()
  })

  ipcMain.handle('settings:open-data-dir', async () => {
    await shell.openPath(store.root)
  })

  ipcMain.handle('settings:info', () => {
    return {
      version: app.getVersion(),
      dataDir: store.root,
      shortcut: 'Ctrl + Shift + T'
    }
  })

  ipcMain.handle('app:show-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('update:check', (_event, force: unknown) => checkForUpdates(force === true))
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:open-release', () => openReleasePage())
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
