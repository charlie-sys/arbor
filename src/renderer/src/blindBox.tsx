import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Brain, Clock3, Eye, Footprints, Gift, Play, RotateCcw, Sparkles, X } from 'lucide-react'
import {
  BLIND_BOX_CARDS,
  BLIND_BOX_CATEGORY_LABEL,
  pickBlindBoxCard,
  updateRecentCardIds,
  type BlindBoxCard,
  type BlindBoxCategory
} from '@shared/blindBox'
import { getLocale, localeFromStored, setLocale, subscribeLocale, t } from '@shared/i18n'
import { installUiFontSize } from './appearance'
import { installUiLocale } from './locale'
import { applyTheme, readTheme } from './themes'
import './themes.css'
import './blindBox.css'

try {
  setLocale(localeFromStored(localStorage.getItem('arbor-locale')))
} catch {
  /* Use the default locale until settings load. */
}
applyTheme(readTheme())
installUiFontSize()
installUiLocale('摸鱼盲盒')

const RECENT_KEY = 'arbor-blind-box-recent'
const OPENING_MS = 520

type Phase = 'closed' | 'opening' | 'revealed' | 'running' | 'done'

function readRecentIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function writeRecentIds(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {
    /* Recent-card persistence is optional. */
  }
}

function cardText(card: BlindBoxCard): string {
  return getLocale() === 'en' ? card.text.en : t(card.text.zh)
}

function categoryIcon(category: BlindBoxCategory): React.JSX.Element {
  if (category === 'eyes') return <Eye size={16} />
  if (category === 'mind') return <Brain size={16} />
  if (category === 'tiny') return <Sparkles size={16} />
  return <Footprints size={16} />
}

function BlindBoxWindow(): React.JSX.Element {
  useSyncExternalStore(subscribeLocale, getLocale)
  const [phase, setPhase] = useState<Phase>('closed')
  const [card, setCard] = useState<BlindBoxCard | null>(null)
  const [remaining, setRemaining] = useState(0)
  const openingTimer = useRef<number | null>(null)
  const deadline = useRef(0)
  const celebrated = useRef(false)

  const clearOpeningTimer = (): void => {
    if (openingTimer.current !== null) {
      window.clearTimeout(openingTimer.current)
      openingTimer.current = null
    }
  }

  const close = (): void => {
    clearOpeningTimer()
    window.close()
  }

  const draw = (): void => {
    clearOpeningTimer()
    const recentIds = readRecentIds()
    const next = pickBlindBoxCard(BLIND_BOX_CARDS, recentIds)
    writeRecentIds(updateRecentCardIds(recentIds, next.id))
    setCard(next)
    setRemaining(next.durationSec)
    celebrated.current = false
    setPhase(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'revealed' : 'opening')
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      openingTimer.current = window.setTimeout(() => {
        openingTimer.current = null
        setPhase('revealed')
      }, OPENING_MS)
    }
  }

  const startTimer = (): void => {
    if (!card) return
    deadline.current = Date.now() + card.durationSec * 1000
    setRemaining(card.durationSec)
    setPhase('running')
  }

  useEffect(() => {
    if (phase !== 'running' || !card) return
    const tick = (): void => {
      const next = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))
      setRemaining(next)
      if (next === 0) {
        setPhase('done')
        if (!celebrated.current) {
          celebrated.current = true
          window.api.pet.celebrate()
        }
      }
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [phase, card])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if ((event.key === 'Enter' || event.key === ' ') && phase === 'closed') {
        event.preventDefault()
        draw()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  useEffect(() => {
    const applyStoredTheme = (): void => {
      applyTheme(readTheme())
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key === 'zotagent-theme') applyStoredTheme()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => () => clearOpeningTimer(), [])

  const total = card?.durationSec ?? 1
  const progress = phase === 'running' ? 1 - remaining / total : phase === 'done' ? 1 : 0

  return (
    <div className="blind-box-frame">
      <div className="blind-box-shell">
        <header className="blind-box-titlebar">
          <div className="blind-box-title">
            <Gift size={17} />
            <span>{t('摸鱼盲盒')}</span>
          </div>
          <button className="blind-box-close" type="button" onClick={close} aria-label={t('关闭')}>
            <X size={17} />
          </button>
        </header>

        <main className={`blind-box-body phase-${phase}`}>
          {phase === 'closed' ? (
            <section className="blind-box-intro" aria-labelledby="blind-box-heading">
              <div className="blind-box-package" aria-hidden="true">
                <div className="blind-box-package-lid" />
                <Gift size={54} strokeWidth={1.45} />
                <span className="blind-box-question">?</span>
              </div>
              <div>
                <p className="blind-box-kicker">{t('摸一会儿鱼')}</p>
                <h1 id="blind-box-heading">{t('今天会抽到什么？')}</h1>
                <p className="blind-box-lede">{t('不知道阿栗往盒子里塞了什么。')}</p>
              </div>
              <button className="blind-box-primary" type="button" onClick={draw} autoFocus>
                <Gift size={18} />
                {t('拆开')}
              </button>
            </section>
          ) : (
            <section className={`blind-box-card phase-${phase}`} aria-live="polite">
              <div className="blind-box-card-top">
                <span className="blind-box-category">
                  {card ? categoryIcon(card.category) : null}
                  {card ? t(BLIND_BOX_CATEGORY_LABEL[card.category]) : ''}
                </span>
                {card ? (
                  <span className="blind-box-duration">
                    <Clock3 size={14} />
                    {t('约 {0} 秒', [card.durationSec])}
                  </span>
                ) : null}
              </div>

              <div className="blind-box-card-copy">
                <p className="blind-box-kicker">
                  {phase === 'done' ? t('行，回来啦') : phase === 'running' ? t('正在休息') : t('盲盒打开了')}
                </p>
                <h1>{card ? cardText(card) : ''}</h1>
                <p className="blind-box-hint">
                  {phase === 'done'
                    ? t('刚刚好，回来继续。')
                    : phase === 'running'
                      ? t('这次不记入阅读计划，也不催你回来。')
                      : t('慢慢来，不着急。')}
                </p>
              </div>

              {phase === 'running' ? (
                <div className="blind-box-timer" aria-label={t('还剩 {0} 秒', [remaining])}>
                  <div className="blind-box-timer-number">{remaining}</div>
                  <div className="blind-box-progress" aria-hidden="true">
                    <span style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
                  </div>
                </div>
              ) : phase === 'revealed' || phase === 'done' ? (
                <div className="blind-box-actions">
                  {phase !== 'done' && card ? (
                    <button className="blind-box-primary" type="button" onClick={startTimer}>
                      <Play size={18} />
                      {t('开始计时')}
                    </button>
                  ) : null}
                  <button className="blind-box-secondary" type="button" onClick={draw}>
                    <RotateCcw size={16} />
                    {t('再抽一张')}
                  </button>
                  <button className="blind-box-quiet" type="button" onClick={close}>
                    {t('收起来')}
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </main>

        <footer className="blind-box-footer">
          <Sparkles size={13} />
          {t('不联网 · 不读取文献 · 不留下完成记录')}
        </footer>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<BlindBoxWindow />)
