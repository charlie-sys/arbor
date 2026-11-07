import type { AiActionId } from './types'

export interface AiActionMeta {
  id: AiActionId
  label: string
  hint: string
  needsTarget?: boolean
}

export const AI_ACTIONS: AiActionMeta[] = [
  { id: 'translate', label: '翻译', hint: '将选文翻译为中文，保留术语与公式' },
  { id: 'summarize', label: '摘要', hint: '概括选文要点，保留关键术语' },
  { id: 'explain-formula', label: '解释公式', hint: '逐符号解释公式，保持 LaTeX 完整' },
  { id: 'compare', label: '对比文献', hint: '与另一篇文献的相关论述对比', needsTarget: true }
]

export function aiActionMeta(id: AiActionId): AiActionMeta {
  return AI_ACTIONS.find((action) => action.id === id) ?? AI_ACTIONS[0]
}

export interface AiActionPromptInput {
  selection: string
  docTitle?: string
  page?: number
  target?: { title: string; context: string }
}

const LATEX_RULE =
  '数学公式必须保持 LaTeX 写法：行内用 $...$，独立公式用 $$...$$；不要改写、删去或替换原有定界符与公式内容。'

export function buildAiActionPrompt(id: AiActionId, input: AiActionPromptInput): string {
  const where = [input.docTitle ? `《${input.docTitle}》` : '', input.page ? `第 ${input.page} 页` : '']
    .filter(Boolean)
    .join('，')
  const header = `选文${where ? `（${where}）` : ''}：\n"""\n${input.selection.trim()}\n"""`

  switch (id) {
    case 'translate':
      return `${header}\n\n请把上述选文忠实翻译为简体中文；若原文已是中文则翻译为英文。只输出译文，不要添加解释或评论。\n${LATEX_RULE}`
    case 'summarize':
      return `${header}\n\n请用简体中文概括上述选文的核心内容，输出 3-5 条要点，保留关键术语与公式；不要编造原文没有的信息。\n${LATEX_RULE}`
    case 'explain-formula':
      return `${header}\n\n请解释上述选文中的公式与符号：逐个说明符号所指、公式的数学或物理意义、成立条件，必要时给出推导直觉。若选文没有明显公式，请指出并解释其中最关键的数学表达。\n${LATEX_RULE}\n不要用中文描述替代公式本身。`
    case 'compare':
      return `${header}\n\n【对比文献】《${input.target?.title ?? '未知文献'}》的相关内容：\n"""\n${input.target?.context?.trim() || '（该文献暂无可检索正文）'}\n"""\n\n请从研究问题、方法/模型、主要结论与差异四个角度，对比选文与对比文献的相关论述，并标注各自页码；若对比文献缺少对应内容，请明确指出。\n${LATEX_RULE}`
    default:
      return `${header}\n\n请针对上述选文给出简明、准确的分析。\n${LATEX_RULE}`
  }
}
