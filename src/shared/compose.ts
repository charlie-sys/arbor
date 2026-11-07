export interface ComposeScope {
  includeChat: boolean
  includeNotes: boolean
  includeExcerpts: boolean
  excerptIds: string[]
}

export const DEFAULT_COMPOSE_SCOPE: ComposeScope = {
  includeChat: true,
  includeNotes: false,
  includeExcerpts: false,
  excerptIds: []
}

export function defaultComposeOutline(): string {
  return [
    '## 一、阅读文献概况',
    '## 二、研究问题与核心概念',
    '## 三、问答与摘录整理',
    '## 四、方法与关键发现',
    '## 五、结论与启示',
    '## 六、参考资料'
  ].join('\n')
}
