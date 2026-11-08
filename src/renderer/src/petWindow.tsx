import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { PetRuntimeConfig, PetSnapshot, PetState } from '@shared/pet'
import { getLocale, localeFromStored, setLocale, subscribeLocale, t } from '@shared/i18n'

try {
  setLocale(localeFromStored(window.localStorage.getItem('arbor-locale')))
} catch {
  /* config from the main process will correct the locale */
}
import './themes.css'
import './pet.css'

interface StateDef {
  label: string
  fps: number
  frames: number
}

const FALLBACK: Record<PetState, StateDef> = {
  typing: { label: '正在写作', fps: 10, frames: 6 },
  reading: { label: '正在阅读', fps: 5, frames: 6 },
  thinking: { label: '正在思考', fps: 4, frames: 6 },
  active: { label: '四处看看', fps: 8, frames: 6 },
  idle: { label: '摸一会儿鱼', fps: 3, frames: 6 },
  away: { label: '睡着了', fps: 2, frames: 4 },
  busy: { label: 'AI 正在干活', fps: 10, frames: 6 },
  happy: { label: '开心', fps: 12, frames: 6 }
}

const QUIPS: Record<PetState, string[]> = {
  typing: ['这段写得真顺～', '灵感来了！', '打字好快，我跟不上啦'],
  reading: ['这段有点意思', '要不要做个笔记？', '我陪你一起读'],
  thinking: ['嗯……让我也想想', '这个问题值得琢磨', '我闻到灵感的味道了'],
  active: ['我看看你在做什么', '今天读哪一篇？', '尾巴摇摇～'],
  idle: ['摸会儿鱼也没关系', '要不……休息一下？', '我有点困了'],
  away: ['Zzz…', '我先眯一会儿', '晚安～'],
  busy: ['AI 正在帮你干活', '马上就好～', '推车推车！'],
  happy: ['搞定！', '耶！', '尾巴要飞起来了']
}

const WELCOME_KEY = 'arbor-pet-welcomed'

function applyTheme(id: string): void {
  const root = document.documentElement
  root.dataset.theme = id || 'light'
  if (id === 'dark' || id === 'midnight') root.dataset.dark = 'true'
  else delete root.dataset.dark
  root.style.colorScheme = id === 'dark' || id === 'midnight' ? 'dark' : 'light'
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function PetWindow(): React.JSX.Element {
  useSyncExternalStore(subscribeLocale, getLocale)
  const [manifest, setManifest] = useState<Record<string, StateDef>>(FALLBACK)
  const [snapshot, setSnapshot] = useState<PetSnapshot>({
    state: 'active',
    since: Date.now(),
    label: t("四处看看"),
    view: 'library'
  })
  const [frame, setFrame] = useState(0)
  const [bubble, setBubble] = useState<string | null>(null)
  const [config, setConfig] = useState<PetRuntimeConfig>({
    enabled: true,
    bubbles: true,
    quietUntil: 0,
    language: 'zh-CN'
  })
  const [dragging, setDragging] = useState(false)
  const bubbleTimer = useRef<number | null>(null)
  const lastBubble = useRef(Date.now())
  const drag = useRef<{
    startX: number
    startY: number
    winX: number
    winY: number
    moved: boolean
    raf: number | null
  } | null>(null)
  const dragToken = useRef<object | null>(null)

  const showBubble = (text: string): void => {
    setBubble(text)
    lastBubble.current = Date.now()
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 5200)
  }

  useEffect(() => {
    void fetch('./pet/manifest.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        const merged = { ...FALLBACK }
        for (const key of Object.keys(FALLBACK) as PetState[]) {
          if (data[key]) merged[key] = { ...FALLBACK[key], ...data[key] }
        }
        setManifest(merged)
        for (const state of Object.keys(merged) as PetState[]) {
          for (let i = 0; i < merged[state].frames; i++) {
            const img = new Image()
            img.src = `./pet/${state}/${i}.png`
          }
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const initial = localStorage.getItem('zotagent-theme') ?? 'light'
    applyTheme(initial)
    const onStorage = (event: StorageEvent): void => {
      if (event.key === 'zotagent-theme') applyTheme(localStorage.getItem('zotagent-theme') ?? 'light')
    }
    const offTheme = window.api.pet.onTheme(applyTheme)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      offTheme()
    }
  }, [])

  useEffect(() => {
    void window.api.pet.getState().then(setSnapshot)
    void window.api.pet.getConfig().then((next) => {
      setConfig(next)
      setLocale(next.language)
    })
    const offState = window.api.pet.onState(setSnapshot)
    const offConfig = window.api.pet.onConfig((next) => {
      setConfig(next)
      setLocale(next.language)
    })
    const offSettings = window.api.pet.onSettingsChanged((next) =>
      setConfig((prev) => ({ ...prev, ...next }))
    )
    return () => {
      offState()
      offConfig()
      offSettings()
    }
  }, [])

  useEffect(() => {
    const def = manifest[snapshot.state] ?? FALLBACK[snapshot.state]
    setFrame(0)
    if (def.frames <= 1) return
    const timer = window.setInterval(
      () => setFrame((value) => (value + 1) % def.frames),
      Math.max(70, Math.round(1000 / def.fps))
    )
    return () => window.clearInterval(timer)
  }, [snapshot.state, manifest])

  useEffect(() => {
    if (!config.bubbles || Date.now() < config.quietUntil) return
    if (Date.now() - lastBubble.current < 15000) return
    showBubble(t(pick(QUIPS[snapshot.state])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.state])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!config.bubbles || Date.now() < config.quietUntil) return
      try {
        if (!localStorage.getItem(WELCOME_KEY)) {
          showBubble(t('我是阿栗，陪你一起读论文～'))
          localStorage.setItem(WELCOME_KEY, '1')
        }
      } catch {
        /* ignore storage errors */
      }
    }, 1200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.bubbles, config.quietUntil])

  useEffect(() => {
    let ignoring = true
    window.api.pet.window.ignoreMouse(true)
    const onMove = (event: MouseEvent): void => {
      const target = document.elementFromPoint(event.clientX, event.clientY)
      const over = Boolean(target?.closest('[data-pet-hit]'))
      const nextIgnore = !over
      if (nextIgnore === ignoring) return
      ignoring = nextIgnore
      window.api.pet.window.ignoreMouse(nextIgnore)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.api.pet.window.ignoreMouse(true)
    }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const token = {}
    dragToken.current = token
    const startX = event.screenX
    const startY = event.screenY
    void window.api.pet.window.bounds().then((bounds) => {
      if (!bounds || dragToken.current !== token) return
      drag.current = {
        startX,
        startY,
        winX: bounds.x,
        winY: bounds.y,
        moved: false,
        raf: null
      }
      setDragging(true)
    })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current) return
    const dx = event.screenX - current.startX
    const dy = event.screenY - current.startY
    if (!current.moved && Math.abs(dx) + Math.abs(dy) > 3) current.moved = true
    if (!current.moved) return
    if (current.raf) window.cancelAnimationFrame(current.raf)
    current.raf = window.requestAnimationFrame(() => {
      window.api.pet.window.move(current.winX + dx, current.winY + dy)
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    dragToken.current = null
    drag.current = null
    setDragging(false)
    if (!current) return
    if (current.raf) window.cancelAnimationFrame(current.raf)
    if (current.moved) return
    if (event.detail >= 2) {
      window.api.pet.openMain()
      return
    }
    window.api.pet.openAliChat()
  }

  const def = manifest[snapshot.state] ?? FALLBACK[snapshot.state]
  const source = `./pet/${snapshot.state}/${Math.min(frame, def.frames - 1)}.png`

  return (
    <div className="pet-stage">
      <div className={`pet-bubble${bubble ? ' show' : ''}`} data-pet-hit>
        {bubble ?? ''}
      </div>
      <div
        className={`pet-wrap${dragging ? ' dragging' : ''}`}
        data-pet-hit
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragToken.current = null
          drag.current = null
          setDragging(false)
        }}
        onDoubleClick={() => window.api.pet.openMain()}
        onContextMenu={(event) => {
          event.preventDefault()
          window.api.pet.menu()
        }}
      >
        <img className="pet-sprite" src={source} alt="" draggable={false} key={snapshot.state} />
        <span className="pet-tag">{t(snapshot.label)}</span>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<PetWindow />)
