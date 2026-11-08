import type { AliMessage } from '../../shared/ali'

export function selectRecent(messages: AliMessage[], maxMessages = 20, maxChars = 10000): AliMessage[] {
  const recent = messages.slice(-maxMessages)
  const selected: AliMessage[] = []
  let budget = maxChars
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index]
    if (selected.length && message.content.length > budget) break
    selected.unshift(message)
    budget -= message.content.length
  }
  return selected
}

export function unsummarized(messages: AliMessage[], summaryUpTo?: string): AliMessage[] {
  if (!summaryUpTo) return messages
  const index = messages.findIndex((message) => message.id === summaryUpTo)
  return index >= 0 ? messages.slice(index + 1) : messages
}

export function shouldSummarize(
  messages: AliMessage[],
  summaryUpTo?: string,
  minMessages = 8,
  minChars = 6000
): boolean {
  const pending = unsummarized(messages, summaryUpTo)
  if (pending.length >= minMessages) return true
  return pending.reduce((total, message) => total + message.content.length, 0) >= minChars
}
