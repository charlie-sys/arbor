export function cleanSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[>*_~]/g, '')
    .replace(/\r?\n+/g, '。')
    .replace(/[ \t]+/g, ' ')
    .replace(/。{2,}/g, '。')
    .replace(/，{2,}/g, '，')
    .trim()
}

export function chunkSpeech(text: string, maxChars = 1800): string[] {
  const clean = cleanSpeech(text).slice(0, 12000)
  if (!clean) return []
  // 短回答保持单次合成，避免 Windows TTS 在句间产生明显停顿。
  if (clean.length <= 2600) return [clean]
  const sentences = clean.match(/[^。！？.!?\n]+[。！？.!?]?/g) || [clean]
  const chunks: string[] = []
  let current = ''
  for (const raw of sentences) {
    const sentence = raw.trim()
    if (!sentence) continue
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let index = 0; index < sentence.length; index += maxChars) {
        chunks.push(sentence.slice(index, index + maxChars))
      }
      continue
    }
    if (current.length + sentence.length + 1 <= maxChars) {
      current = current ? `${current}${sentence}` : sentence
    } else {
      chunks.push(current)
      current = sentence
    }
  }
  if (current) chunks.push(current)
  return chunks.map((chunk) => (/[。！？.!?]$/.test(chunk) ? chunk : `${chunk}。`))
}
