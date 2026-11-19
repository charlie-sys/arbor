import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { writeTextAtomic } from './atomic'
import { assertMemoryDocPath, validateMemoryDoc } from './memoryFormat'
import { MEMORY_QUOTA, SELF_QUOTA } from './memoryQuota'
import type { AliMemoryState, AliMemoryTopic } from '../../shared/ali'
const DEFAULT_SELF = `# 阿栗的自我认知

## 人格与形象
- 我是阿栗，一只住在 Arbor 桌面右下角的哈士奇。
- 我温和、真诚、略带俏皮；先接住情绪，再给出可以执行的建议。
- 我不假装无所不知；不确定时会直接说，并帮用户找到答案。

## 我对你的理解
- 我会从长期记忆中逐步了解你的性格、兴趣和沟通偏好，不在缺少证据时编造画像。

## 我们关系的定义
- 我是你的陪伴者和 Arbor 使用助手，尊重你的边界与隐私。
`

const DEFAULT_MEMORY = `# 用户长期记忆

## 用户事实

## 用户偏好

## 兴趣爱好

## 明确要求长期记住
`

class AliMemory {
  root = ''
  selfFile = ''
  memoryFile = ''
  topicsDir = ''
  archiveDir = ''

  async init(): Promise<void> {
    this.root = path.join(app.getPath('userData'), 'data', 'ali', 'memory')
    this.selfFile = path.join(this.root, 'SELF.md')
    this.memoryFile = path.join(this.root, 'MEMORY.md')
    this.topicsDir = path.join(this.root, 'topics')
    this.archiveDir = path.join(this.root, 'archive')
    await fs.mkdir(this.topicsDir, { recursive: true })
    await fs.mkdir(this.archiveDir, { recursive: true })
    await this.ensure(this.selfFile, DEFAULT_SELF)
    await this.ensure(this.memoryFile, DEFAULT_MEMORY)
  }

  async readSelf(): Promise<string> {
    return this.read('SELF.md', DEFAULT_SELF)
  }

  async readMemory(): Promise<string> {
    return this.read('MEMORY.md', DEFAULT_MEMORY)
  }

  async read(doc: string, fallback = ''): Promise<string> {
    try {
      assertMemoryDocPath(doc)
      return await fs.readFile(path.join(this.root, doc), 'utf-8')
    } catch {
      return fallback
    }
  }

  async save(doc: string, content: string): Promise<void> {
    assertMemoryDocPath(doc)
    validateMemoryDoc(doc, content)
    await writeTextAtomic(path.join(this.root, doc), content)
  }

  async archive(doc: string, lines: string[]): Promise<void> {
    if (!lines.length) return
    const month = new Date().toISOString().slice(0, 7)
    const file = path.join(this.archiveDir, `${month}.md`)
    let text = ''
    try {
      text = await fs.readFile(file, 'utf-8')
    } catch {
      text = `# 记忆归档 ${month}\n`
    }
    const entries = lines.map((line) => `- [${doc}] ${line.replace(/^- /, '')}`).join('\n')
    await writeTextAtomic(file, `${text.trimEnd()}\n\n## ${new Date().toISOString()}\n${entries}\n`)
  }

  async readArchive(): Promise<string> {
    const month = new Date().toISOString().slice(0, 7)
    try {
      return await fs.readFile(path.join(this.archiveDir, `${month}.md`), 'utf-8')
    } catch {
      return ''
    }
  }

  async listTopics(): Promise<AliMemoryTopic[]> {
    try {
      const names = await fs.readdir(this.topicsDir)
      const topics: AliMemoryTopic[] = []
      for (const name of names) {
        if (!name.endsWith('.md')) continue
        const doc = `topics/${name}`
        const content = await fs.readFile(path.join(this.topicsDir, name), 'utf-8')
        const front = content.startsWith('---') ? content.slice(3, content.indexOf('\n---', 3)) : ''
        topics.push({
          doc,
          title: path.basename(name, '.md').replace(/-/g, ' '),
          description: front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '',
          pinned: /^pinned:\s*true$/m.test(front),
          content
        })
      }
      return topics.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title))
    } catch {
      return []
    }
  }

  async getState(): Promise<AliMemoryState> {
    const [self, memory, topics, archive] = await Promise.all([
      this.readSelf(),
      this.readMemory(),
      this.listTopics(),
      this.readArchive()
    ])
    return {
      self,
      memory,
      topics,
      archive,
      usage: {
        self: { chars: self.length, quota: SELF_QUOTA },
        memory: { chars: memory.length, quota: MEMORY_QUOTA }
      }
    }
  }

  async deleteTopic(doc: string): Promise<void> {
    if (!doc.startsWith('topics/')) throw new Error('只能删除主题记忆')
    assertMemoryDocPath(doc)
    await fs.rm(path.join(this.root, doc), { force: true })
  }

  async setPinned(doc: string, pinned: boolean): Promise<void> {
    if (!doc.startsWith('topics/')) throw new Error('只能置顶主题记忆')
    assertMemoryDocPath(doc)
    const file = path.join(this.root, doc)
    const text = await fs.readFile(file, 'utf-8')
    if (text.startsWith('---')) {
      const next = pinned
        ? text.includes('pinned:') ? text.replace(/^pinned:.*$/m, 'pinned: true') : text.replace(/^---\n/, '---\npinned: true\n')
        : text.replace(/^pinned:.*\n?/m, '')
      await writeTextAtomic(file, next)
    } else if (pinned) {
      await writeTextAtomic(file, `---\npinned: true\n---\n${text}`)
    }
  }

  async clear(): Promise<void> {
    await writeTextAtomic(this.selfFile, DEFAULT_SELF)
    await writeTextAtomic(this.memoryFile, DEFAULT_MEMORY)
    await fs.rm(this.topicsDir, { recursive: true, force: true })
    await fs.rm(this.archiveDir, { recursive: true, force: true })
    await fs.mkdir(this.topicsDir, { recursive: true })
    await fs.mkdir(this.archiveDir, { recursive: true })
  }

  private async ensure(file: string, content: string): Promise<void> {
    try {
      await fs.access(file)
    } catch {
      await fs.writeFile(file, content, 'utf-8')
    }
  }
}

export const aliMemory = new AliMemory()
