import { store } from './store'
import { buildContext, resolveContextBudget } from './context'
import { completeText } from './llm'
import { buildAiActionPrompt } from '../shared/aiActions'
import type { AiActionId, AiActionOutput } from '../shared/types'

export interface AiActionInput {
  action: AiActionId
  text: string
  page?: number
  docId?: string
  targetDocId?: string
}

export async function runAiAction(input: AiActionInput): Promise<AiActionOutput> {
  const text = input.text.trim()
  if (!text) throw new Error('选中的文本为空')

  const settings = store.data.settings
  const doc = input.docId ? store.getDocument(input.docId) : undefined
  let target: { title: string; context: string } | undefined

  if (input.action === 'compare') {
    if (!input.targetDocId) throw new Error('请选择要对比的文献')
    if (input.targetDocId === input.docId) throw new Error('请选择另一篇文献进行对比')
    const targetDoc = store.getDocument(input.targetDocId)
    if (!targetDoc) throw new Error('对比文献不存在')
    const budget = resolveContextBudget(settings.maxContextChars, 24000)
    const built = await buildContext([targetDoc.id], text, budget)
    target = { title: targetDoc.title, context: built.context }
  }

  const prompt = buildAiActionPrompt(input.action, {
    selection: text,
    docTitle: doc?.title,
    page: input.page,
    target
  })

  const content = await completeText(
    [
      {
        role: 'system',
        content:
          '你是严谨的学术阅读助手，只依据给定原文与上下文作答，不编造内容。输出使用简体中文；数学公式使用 LaTeX（行内 $...$，独立 $$...$$）。'
      },
      { role: 'user', content: prompt }
    ],
    { temperature: 0.3 }
  )

  return { action: input.action, content, model: settings.chatModel }
}
