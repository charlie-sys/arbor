const DOC_PATTERN = /^(SELF|MEMORY)\.md$|^topics\/[a-z0-9][a-z0-9-]{0,63}\.md$/
const SECRET_PATTERN = /sk-[a-z0-9]{8,}|api[_-]?key\s*[:=]|password\s*[:=]|密码\s*[:=]|身份证|手机号\s*[:=]/i

export function assertMemoryDocPath(doc: string): void {
  if (!DOC_PATTERN.test(doc)) throw new Error('记忆路径无效')
}

export function validateMemoryDoc(doc: string, content: string): void {
  if (!content.trim()) throw new Error('记忆内容不能为空')
  if (content.length > 30000) throw new Error('单个记忆文件不能超过 30000 字')
  const first = content.trimStart().split(/\r?\n/)[0]
  if (doc === 'MEMORY.md' && first !== '# 用户长期记忆') throw new Error('MEMORY.md 必须以“# 用户长期记忆”开头')
  if (doc === 'SELF.md' && first !== '# 阿栗的自我认知') throw new Error('SELF.md 必须以“# 阿栗的自我认知”开头')
  let frontmatter = false
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '---') {
      frontmatter = !frontmatter
      continue
    }
    if (!line || frontmatter || line.startsWith('#')) continue
    if (SECRET_PATTERN.test(line)) throw new Error('记忆不能包含密钥、密码或证件号')
    if (!line.startsWith('- ')) throw new Error('记忆条目必须是不超过 120 字的单行“- ”文本')
    if (line.length > 122) throw new Error('单条记忆不能超过 120 字')
  }
}
