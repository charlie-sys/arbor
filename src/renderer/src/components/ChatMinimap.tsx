import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { cx, formatTime } from '../ui'
import { t } from '@shared/i18n'

interface Props {
  messages: ChatMessage[]
  listRef: React.RefObject<HTMLDivElement | null>
  active: boolean
  chatId: string
}

function questionPreview(content: string): string {
  const text = content
    .replace(/^>.*$/gm, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || t("（仅附件）")
}

export default function ChatMinimap({ messages, listRef, active, chatId }: Props): React.JSX.Element {
  const questions = messages.filter((message) => message.role === 'user')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [railHeight, setRailHeight] = useState(0)
  const navRef = useRef<HTMLElement>(null)
  const questionsRef = useRef(questions)
  questionsRef.current = questions
  const flashTimerRef = useRef<number | null>(null)
  const questionKey = questions.map((question) => question.id).join(',')
  const hidden = questions.length < 2

  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const update = (): void => setRailHeight(el.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!active) return
    const list = listRef.current
    if (!list) return
    let frame = 0
    let last: string | null = null
    const measure = (): void => {
      frame = 0
      const listRect = list.getBoundingClientRect()
      const threshold = listRect.top + Math.min(140, listRect.height * 0.35)
      const rows = questionsRef.current
      let current: string | null = rows[0]?.id ?? null
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 4) {
        current = rows[rows.length - 1]?.id ?? current
      } else {
        for (const question of rows) {
          const row = list.querySelector<HTMLElement>(`[data-mid="${question.id}"]`)
          if (row && row.getBoundingClientRect().top <= threshold) current = question.id
        }
      }
      if (current !== last) {
        last = current
        setActiveId(current)
      }
    }
    const schedule = (): void => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    measure()
    list.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(list)
    return () => {
      list.removeEventListener('scroll', schedule)
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [active, chatId, questionKey, listRef])

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    }
  }, [])

  const jumpTo = useCallback(
    (id: string): void => {
      const list = listRef.current
      if (!list) return
      const row = list.querySelector<HTMLElement>(`[data-mid="${id}"]`)
      if (!row) return
      const top = Math.max(
        0,
        row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 10
      )
      list.scrollTo({ top, behavior: 'smooth' })
      row.classList.add('question-focus')
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = null
        row.classList.remove('question-focus')
      }, 1400)
    },
    [listRef]
  )

  if (hidden) {
    return (
      <nav className="chat-minimap hidden" ref={navRef} aria-hidden="true">
        <div className="chat-minimap-track" />
      </nav>
    )
  }

  const step = railHeight
    ? Math.max(2, Math.min(15, Math.floor((railHeight - 20) / questions.length)))
    : 9

  return (
    <nav className="chat-minimap" ref={navRef} aria-label={t("提问导航")}>
      <div className="chat-minimap-track">
        {questions.map((question, index) => {
          const preview = questionPreview(question.content)
          return (
            <div
              key={question.id}
              className={cx('minimap-item', activeId === question.id && 'active')}
              style={{ height: step }}
            >
              <button
                type="button"
                className="minimap-tick"
                aria-label={t("跳到第 {0} 个提问：{1}", [index + 1, preview.slice(0, 40)])}
                onClick={() => jumpTo(question.id)}
              />
              <div className="minimap-popover" role="tooltip">
                <div className="minimap-popover-head">
                  <span className="minimap-index">{t("提问")}{' '}{index + 1}</span>
                  <span className="minimap-time">{formatTime(question.createdAt)}</span>
                </div>
                <div className="minimap-preview">{preview}</div>
              </div>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
