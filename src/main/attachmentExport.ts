import { app, dialog } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { store } from './store'
import { createZip } from './zip'
import type { InboxAttachment } from '../shared/types'

export async function exportAttachmentZip(options: {
  ownerId: string
  title: string
  content: string
  attachments: InboxAttachment[]
  fallbackName: string
}): Promise<{ canceled: boolean; filePath?: string }> {
  let markdown = options.content
  for (const attachment of options.attachments) {
    const encoded = `zotfile://attachments/${options.ownerId}/${encodeURIComponent(attachment.file)}`
    const raw = `zotfile://attachments/${options.ownerId}/${attachment.file}`
    markdown = markdown.split(encoded).join(`attachments/${attachment.file}`)
    markdown = markdown.split(raw).join(`attachments/${attachment.file}`)
  }
  const title = (options.title.trim() || options.fallbackName || 'note').replace(/[\\/:*?"<>|]/g, '_')
  const result = await dialog.showSaveDialog({
    title: '导出为 ZIP',
    defaultPath: path.join(app.getPath('documents'), `${title || options.fallbackName || 'note'}.zip`),
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  const entries = [
    {
      name: 'note.md',
      data: Buffer.from(options.title.trim() ? `# ${options.title.trim()}\n\n${markdown}` : markdown, 'utf-8')
    }
  ]
  for (const attachment of options.attachments) {
    try {
      const data = await fs.readFile(path.join(store.attachmentsDir, options.ownerId, attachment.file))
      entries.push({ name: `attachments/${attachment.file}`, data })
    } catch {
      // 附件缺失时仍然导出 Markdown
    }
  }
  await fs.writeFile(result.filePath, createZip(entries))
  return { canceled: false, filePath: result.filePath }
}
