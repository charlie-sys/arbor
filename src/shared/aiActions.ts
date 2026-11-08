import type { AiActionId } from './types'
import { alternateLanguageName, outputLanguageName, t } from './i18n'

export interface AiActionMeta {
  id: AiActionId
  label: string
  hint: string
  needsTarget?: boolean
}

export const AI_ACTIONS: AiActionMeta[] = [
  { id: 'translate', label: '翻译', hint: '将选文翻译为中文，保留术语与公式' },
  { id: 'summarize', label: '生成摘要', hint: '概括选文要点，保留关键术语' },
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
  const where = [
    input.docTitle ? t('《{0}》', [input.docTitle]) : '',
    input.page ? t('第 {0} 页', [input.page]) : ''
  ]
    .filter(Boolean)
    .join(t('，'))
  const header = t('选文{0}：\n"""\n{1}\n"""', [where ? t('（{0}）', [where]) : '', input.selection.trim()])
  const rule = t(LATEX_RULE)
  const target = outputLanguageName()
  const alternate = alternateLanguageName()

  switch (id) {
    case 'translate':
      return t('{0}\n\n请把上述选文忠实翻译为{1}；若原文已是{1}则翻译为{2}。只输出译文，不要添加解释或评论。\n{3}', [
        header,
        target,
        alternate,
        rule
      ])
    case 'summarize':
      return t('{0}\n\n请用{1}概括上述选文的核心内容，输出 3-5 条要点，保留关键术语与公式；不要编造原文没有的信息。\n{2}', [
        header,
        target,
        rule
      ])
    case 'explain-formula':
      return t('{0}\n\n请解释上述选文中的公式与符号：逐个说明符号所指、公式的数学或物理意义、成立条件，必要时给出推导直觉。若选文没有明显公式，请指出并解释其中最关键的数学表达。\n{1}\n不要用纯文字描述替代公式本身。', [
        header,
        rule
      ])
    case 'compare': {
      const related = t('【对比文献】《{0}》的相关内容：\n"""\n{1}\n"""', [
        input.target?.title || t('未知文献'),
        input.target?.context?.trim() || t('（该文献暂无可检索正文）')
      ])
      return t('{0}\n\n{1}\n\n请从研究问题、方法/模型、主要结论与差异四个角度，对比选文与对比文献的相关论述，并标注各自页码；若对比文献缺少对应内容，请明确指出。\n{2}', [
        header,
        related,
        rule
      ])
    }
    default:
      return t('{0}\n\n请针对上述选文给出简明、准确的分析。\n{1}', [header, rule])
  }
}
