import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { PetRuntimeConfig, PetSnapshot, PetState } from '@shared/pet'
import {
  PET_ACTOR_HEIGHT,
  PET_ACTOR_WIDTH,
  type PetSkillId,
  type PetStageState
} from '@shared/petPlay'
import { getLocale, localeFromStored, setLocale, subscribeLocale, t } from '@shared/i18n'
import './themes.css'
import './pet.css'
import { installUiLocale } from './locale'

try {
  setLocale(localeFromStored(window.localStorage.getItem('arbor-locale')))
} catch {
  /* config from the main process will correct the locale */
}
installUiLocale('桌面伙伴')

interface StateDef {
  label: string
  fps: number
  frames: number
}

interface Point {
  x: number
  y: number
}

type MotionKind = 'idle' | 'wander' | 'run' | 'fetch' | 'dash'

interface MotionState {
  kind: MotionKind
  targets: Point[]
  speed: number
  onDone?: () => void
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  kind: 'dust' | 'star'
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
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

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
    label: t('四处看看'),
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
  const [motionKind, setMotionKind] = useState<MotionKind>('idle')
  const [ballVisible, setBallVisible] = useState(false)
  const [stage, setStage] = useState<PetStageState | null>(null)
  const ballHeld = useRef(false)

  const stageRef = useRef<PetStageState | null>(null)
  const snapshotRef = useRef(snapshot)
  const actorRef = useRef({ x: 0, y: 0, facing: 'right' as 'left' | 'right' })
  const motionRef = useRef<MotionState>({ kind: 'idle', targets: [], speed: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const spriteRef = useRef<HTMLImageElement>(null)
  const ballRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bubbleTimer = useRef<number | null>(null)
  const ballHideTimer = useRef<number | null>(null)
  const lastBubble = useRef(Date.now())
  const dragToken = useRef<object | null>(null)
  const drag = useRef<{
    startX: number
    startY: number
    actorX: number
    actorY: number
    moved: boolean
    pointerId: number
  } | null>(null)
  const lastPointer = useRef<Point>({ x: 0, y: 0 })
  const particles = useRef<Particle[]>([])
  const lastDust = useRef(0)
  const nextWanderAt = useRef(Date.now() + 6000 + Math.random() * 7000)

  snapshotRef.current = snapshot

  const showBubble = (text: string): void => {
    setBubble(text)
    lastBubble.current = Date.now()
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 5200)
  }

  const stageLimits = (): { maxX: number; maxY: number } => {
    const bounds = stageRef.current?.bounds ?? { width: 0, height: 0 }
    return {
      maxX: Math.max(0, bounds.width - PET_ACTOR_WIDTH),
      maxY: Math.max(0, bounds.height - PET_ACTOR_HEIGHT)
    }
  }

  const updateActorStyle = (): void => {
    const actor = actorRef.current
    const wrap = wrapRef.current
    if (wrap) wrap.style.transform = `translate3d(${actor.x}px, ${actor.y}px, 0)`
    const sprite = spriteRef.current
    if (sprite) sprite.style.transform = actor.facing === 'left' ? 'scaleX(-1)' : ''
    if (ballHeld.current && ballRef.current) {
      ballRef.current.style.transform = `translate3d(${actor.x + 87}px, ${actor.y + 121}px, 0)`
    }
  }

  const saveActorPosition = (): void => {
    const { maxX, maxY } = stageLimits()
    if (!stageRef.current || maxX <= 0 || maxY <= 0) return
    window.api.pet.window.saveActor(actorRef.current.x / maxX, actorRef.current.y / maxY)
  }

  const randomPoint = (minY = 0.2): Point => {
    const { maxX, maxY } = stageLimits()
    return {
      x: 20 + Math.random() * Math.max(0, maxX - 40),
      y: maxY * minY + Math.random() * Math.max(0, maxY * (1 - minY))
    }
  }

  const placeBall = (point: Point, held = false): void => {
    const ball = ballRef.current
    ballHeld.current = held
    setBallVisible(true)
    if (!ball) return
    const next = held
      ? { x: actorRef.current.x + 87, y: actorRef.current.y + 121 }
      : point
    ball.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`
    ball.classList.toggle('held', held)
  }

  const hideBallSoon = (): void => {
    if (ballHideTimer.current) window.clearTimeout(ballHideTimer.current)
    ballHideTimer.current = window.setTimeout(() => {
      ballHideTimer.current = null
      ballHeld.current = false
      setBallVisible(false)
    }, 3000)
  }

  const dropBall = (): void => {
    if (!ballHeld.current) return
    placeBall({
      x: actorRef.current.x + (actorRef.current.facing === 'right' ? 165 : 8),
      y: actorRef.current.y + 185
    })
    hideBallSoon()
  }

  const beginMotion = (
    kind: Exclude<MotionKind, 'idle'>,
    targets: Point[],
    speed: number,
    onDone?: () => void
  ): void => {
    motionRef.current = { kind, targets, speed, onDone }
    setMotionKind(kind)
  }

  const stopMotion = (save = true): void => {
    motionRef.current = { kind: 'idle', targets: [], speed: 0 }
    setMotionKind('idle')
    if (save) saveActorPosition()
  }

  const runFetch = (): void => {
    if (ballHideTimer.current) {
      window.clearTimeout(ballHideTimer.current)
      ballHideTimer.current = null
    }
    const target = randomPoint(0.18)
    placeBall(target)
    beginMotion('fetch', [target], 620, () => {
      placeBall(actorRef.current, true)
      const returnPoint = randomPoint(0.3)
      beginMotion('fetch', [returnPoint], 520, () => {
        dropBall()
        showBubble('球捡回来啦')
      })
    })
  }

  const runZoomies = (): void => {
    dropBall()
    const targets = Array.from({ length: 6 }, (_, index) => {
      const point = randomPoint(index % 2 ? 0.12 : 0.48)
      return {
        x: point.x,
        y: point.y
      }
    })
    burstStars(actorRef.current, 18)
    beginMotion('run', targets, 560, () => {
      window.api.pet.celebrate()
      burstStars(actorRef.current, 12)
      showBubble('跑够啦！')
    })
  }

  const runDash = (): void => {
    dropBall()
    const limits = stageLimits()
    let target = {
      x: clamp(lastPointer.current.x - PET_ACTOR_WIDTH / 2, 0, limits.maxX),
      y: clamp(lastPointer.current.y - PET_ACTOR_HEIGHT / 2, 0, limits.maxY)
    }
    if (distance(actorRef.current, target) < 120) target = randomPoint(0.1)
    burstStars(actorRef.current, 8)
    beginMotion('dash', [target], 1150, () => {
      showBubble('嗖——')
    })
  }

  const playSkill = (skill: PetSkillId): void => {
    if (skill === 'fetch') runFetch()
    else if (skill === 'zoomies') runZoomies()
    else runDash()
  }

  const burstStars = (point: Point, count = 14): void => {
    if (reducedMotion()) return
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 40 + Math.random() * 150
      particles.current.push({
        x: point.x + PET_ACTOR_WIDTH / 2,
        y: point.y + PET_ACTOR_HEIGHT / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 700 + Math.random() * 500,
        maxLife: 1200,
        size: 2 + Math.random() * 4,
        color: index % 2 ? '#8b9d77' : '#d4a373',
        kind: 'star'
      })
    }
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
          for (let index = 0; index < merged[state].frames; index++) {
            const image = new Image()
            image.src = `./pet/${state}/${index}.png`
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
      setConfig((previous) => ({ ...previous, ...next }))
    )
    const offSkill = window.api.pet.onSkill(playSkill)
    return () => {
      offState()
      offConfig()
      offSettings()
      offSkill()
    }
    // playSkill only reads mutable refs and stable state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const applyStage = (next: PetStageState): void => {
      stageRef.current = next
      setStage(next)
      const maxX = Math.max(0, next.bounds.width - next.actorWidth)
      const maxY = Math.max(0, next.bounds.height - next.actorHeight)
      actorRef.current.x = clamp(next.xRatio * maxX, 0, maxX)
      actorRef.current.y = clamp(next.yRatio * maxY, 0, maxY)
      updateActorStyle()
    }
    void window.api.pet.window.state().then(applyStage)
    const offStage = window.api.pet.onStageChanged(applyStage)
    const onResize = (): void => {
      void window.api.pet.window.state().then(applyStage)
    }
    window.addEventListener('resize', onResize)
    return () => {
      offStage()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    if (stage) updateActorStyle()
    // The actor ref is positioned before React has committed the stage DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  useEffect(() => {
    const def = manifest[
      motionKind === 'idle' || motionKind === 'wander' ? snapshot.state : 'active'
    ] ?? FALLBACK[snapshot.state]
    setFrame(0)
    if (def.frames <= 1) return
    const timer = window.setInterval(
      () => setFrame((value) => (value + 1) % def.frames),
      Math.max(70, Math.round(1000 / def.fps))
    )
    return () => window.clearInterval(timer)
  }, [motionKind, snapshot.state, manifest])

  useEffect(() => {
    if (!config.bubbles || Date.now() < config.quietUntil) return
    if (Date.now() - lastBubble.current < 15000) return
    showBubble(pick(QUIPS[snapshot.state]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.state])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!config.bubbles || Date.now() < config.quietUntil) return
      try {
        if (!localStorage.getItem(WELCOME_KEY)) {
          showBubble('我是阿栗，陪你一起读论文～')
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
    if (snapshot.state === 'away') {
      dropBall()
      if (motionRef.current.kind !== 'idle') stopMotion()
    }
    if (snapshot.state !== 'idle' && motionRef.current.kind === 'wander') stopMotion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.state])

  useEffect(() => {
    let ignoring = true
    window.api.pet.window.ignoreMouse(true)
    const onMove = (event: MouseEvent): void => {
      lastPointer.current = { x: event.clientX, y: event.clientY }
      if (drag.current) return
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !stage) return
    const context = canvas.getContext('2d')
    if (!context) return
    let raf = 0
    let previous = performance.now()
    let lastTick = 0

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(window.innerWidth * dpr))
      canvas.height = Math.max(1, Math.round(window.innerHeight * dpr))
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const finishMotion = (): void => {
      const callback = motionRef.current.onDone
      stopMotion()
      callback?.()
    }

    const loop = (now: number): void => {
      if (now - lastTick < 33) {
        raf = window.requestAnimationFrame(loop)
        return
      }
      const dt = Math.min(66, now - previous)
      previous = now
      lastTick = now
      const motion = motionRef.current
      const actor = actorRef.current
      const { maxX, maxY } = stageLimits()

      if (motion.kind !== 'idle' && motion.targets.length) {
        const target = motion.targets[0]
        const dx = target.x - actor.x
        const dy = target.y - actor.y
        const remaining = Math.hypot(dx, dy)
        const step = motion.speed * dt / 1000
        if (remaining <= step + 1) {
          actor.x = clamp(target.x, 0, maxX)
          actor.y = clamp(target.y, 0, maxY)
          motion.targets.shift()
          if (!motion.targets.length) finishMotion()
        } else {
          actor.x += (dx / remaining) * step
          actor.y += (dy / remaining) * step
          if (Math.abs(dx) > 2) actor.facing = dx < 0 ? 'left' : 'right'
        }
        updateActorStyle()

        if (!reducedMotion() && now - lastDust.current > (motion.kind === 'dash' ? 34 : 72)) {
          lastDust.current = now
          particles.current.push({
            x: actor.x + PET_ACTOR_WIDTH / 2 + (actor.facing === 'right' ? -65 : 65),
            y: actor.y + PET_ACTOR_HEIGHT - 9,
            vx: (actor.facing === 'right' ? -1 : 1) * (8 + Math.random() * 22),
            vy: -5 - Math.random() * 15,
            life: motion.kind === 'dash' ? 420 : 300,
            maxLife: 420,
            size: 2 + Math.random() * 4,
            color: '#918475',
            kind: 'dust'
          })
        }
      } else if (
        motion.kind === 'idle' &&
        snapshotRef.current.state === 'idle' &&
        !reducedMotion() &&
        now >= nextWanderAt.current
      ) {
        nextWanderAt.current = now + 10000 + Math.random() * 12000
        beginMotion('wander', [randomPoint(0.55)], 92)
      }

      if (motion.kind !== 'idle' || particles.current.length) {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight)
        const nextParticles: Particle[] = []
        for (const particle of particles.current) {
          particle.life -= dt
          if (particle.life <= 0) continue
          particle.x += particle.vx * dt / 1000
          particle.y += particle.vy * dt / 1000
          if (particle.kind === 'dust') particle.vy -= 9 * dt / 1000
          else particle.vy += 28 * dt / 1000
          const alpha = Math.max(0, particle.life / particle.maxLife)
          context.globalAlpha = alpha
          context.fillStyle = particle.color
          context.beginPath()
          context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
          context.fill()
          nextParticles.push(particle)
        }
        context.globalAlpha = 1
        particles.current = nextParticles
      }
      raf = window.requestAnimationFrame(loop)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = window.requestAnimationFrame(loop)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
    // Motion helpers intentionally use refs rather than being recreated per frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  useEffect(
    () => () => {
      if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
      if (ballHideTimer.current) window.clearTimeout(ballHideTimer.current)
      saveActorPosition()
    },
    []
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    dragToken.current = {}
    drag.current = {
      startX: event.screenX,
      startY: event.screenY,
      actorX: actorRef.current.x,
      actorY: actorRef.current.y,
      moved: false,
      pointerId: event.pointerId
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current) return
    const dx = event.screenX - current.startX
    const dy = event.screenY - current.startY
    if (!current.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      current.moved = true
      dropBall()
      motionRef.current = { kind: 'idle', targets: [], speed: 0 }
      setMotionKind('idle')
    }
    if (!current.moved) return
    const { maxX, maxY } = stageLimits()
    actorRef.current.x = clamp(current.actorX + dx, 0, maxX)
    actorRef.current.y = clamp(current.actorY + dy, 0, maxY)
    if (Math.abs(dx) > 2) actorRef.current.facing = dx < 0 ? 'left' : 'right'
    updateActorStyle()
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    dragToken.current = null
    drag.current = null
    setDragging(false)
    if (!current) return
    if (current.moved) {
      saveActorPosition()
      nextWanderAt.current = Date.now() + 5000
      return
    }
    if (event.detail >= 2) {
      window.api.pet.openMain()
      return
    }
    window.api.pet.openAliChat()
  }

  const spriteState: PetState =
    motionKind === 'idle' || motionKind === 'wander' ? snapshot.state : 'active'
  const def = manifest[spriteState] ?? FALLBACK[spriteState]
  const source = `./pet/${spriteState}/${Math.min(frame, def.frames - 1)}.png`
  const motionLabel =
    motionKind === 'run'
      ? t('撒欢中')
      : motionKind === 'fetch'
        ? t('捡球中')
        : motionKind === 'dash'
          ? t('冲刺！')
          : t(snapshot.label)

  return (
    <div className={`pet-stage${dragging ? ' dragging' : ''}`}>
      <canvas ref={canvasRef} className="pet-effects" aria-hidden="true" />
      {stage ? (
        <>
          <button
            ref={ballRef}
            type="button"
            className={`pet-ball${ballVisible ? ' show' : ''}`}
            data-pet-hit
            aria-label={t('把球扔出去')}
            onClick={runFetch}
          >
            <span />
          </button>
          <div
            ref={wrapRef}
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
            onContextMenu={(event) => {
              event.preventDefault()
              window.api.pet.menu()
            }}
          >
            <div className={`pet-bubble${bubble ? ' show' : ''}`}>
              {bubble ? t(bubble) : ''}
            </div>
            <img
              ref={spriteRef}
              className="pet-sprite"
              src={source}
              alt=""
              draggable={false}
              key={`${spriteState}-${motionKind}`}
            />
            <span className="pet-tag">{motionLabel}</span>
          </div>
        </>
      ) : null}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<PetWindow />)
