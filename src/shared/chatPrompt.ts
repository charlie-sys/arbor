import type { ChatRequest } from './types'

// 达到字符预算后按整组对话裁剪，避免每一轮都移动历史前缀；始终从 user 开始。
export function selectChatHistory(messages: ChatRequest['messages'], maxChars = 120000): ChatRequest['messages'] {
  let selected = messages
  const size = (items: typeof messages): number => items.reduce((n, m) => n + m.content.length + (m.promptContext?.length ?? 0), 0)
  while (selected.length > 1 && size(selected) > maxChars) {
    const starts = selected.map((m, i) => m.role === 'user' ? i : -1).filter((i) => i >= 0)
    const cut = starts[Math.min(8, starts.length - 1)]
    if (!cut) break
    selected = selected.slice(cut)
  }
  return selected
}
