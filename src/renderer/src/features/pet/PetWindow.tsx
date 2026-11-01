// The page in the pet's own window (main/pet.ts): the pet, under it a small
// toolbar while the pointer is on it, and under that a card, as Codex's pet has:
// the session it's about, with a line of what's going on in it. Everything else in
// the window lets clicks through to the app underneath, so the page tells main
// whenever the pointer is over the pet, its toolbar or its card.
//
// The pet acts out what happens to it: carried sideways it walks (facing the way
// it's going), held up or carried up and down it dangles, under the pointer it's
// happy, and clicked it jumps. Clicking it also minimizes Gloom, or brings it back;
// right-clicking it opens its menu (Pet Settings…, Next Pet, Hide Pet).
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, ChevronRight, CircleCheck, Shuffle, SquarePen } from 'lucide-react'
import type { PetAction, PetView } from '@shared/ipc'
import { HELLOS, othersLine, type Mood } from './mood'
import { arrive, PixelPet } from './Pet'
import type { PetLoopName } from './sprites'
import './pet-window.css'

/** Past this many pixels a press is a drag, not a click. */
const DRAG_SLOP = 4
/** Faster than this sideways (px/ms, smoothed), and more sideways than up or down, the pet walks. */
const WALK_SPEED = 0.12
/** Held still this long while carried, it dangles. */
const STILL_MS = 160
/** The toolbar and card stay this long after the pointer leaves, so they can be reached. */
const LINGER_MS = 350

type Carry = { loop: 'walk' | 'fall'; left: boolean } | null

const act = (what: PetAction, sessionId?: string | null) => window.gloom?.pet.action(what, sessionId)
const menu = (e: MouseEvent) => {
  e.preventDefault()
  act('menu')
}

export function PetWindow() {
  const [view, setView] = useState<PetView | null>(null)
  const [hover, setHover] = useState(false)
  const [carry, setCarry] = useState<Carry>(null)
  const [jumping, setJumping] = useState(0)
  const [hello, setHello] = useState(() => Math.floor(Math.random() * HELLOS.length))
  // The card you cycled to, by its session; none: the most urgent.
  const [pick, setPick] = useState<string | null>(null)
  const top = view?.cards[0]?.sessionId ?? null
  // A new most urgent session takes the card back.
  useEffect(() => setPick(null), [top])
  const reduce = useReducedMotion()
  const press = useRef<{ x: number; y: number; t: number; vx: number; vy: number; moved: boolean; left: boolean } | null>(null)
  const stillTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    document.documentElement.dataset.pet = ''
    const api = window.gloom?.pet
    if (!api) return
    void api.current().then(setView)
    return api.onView(setView)
  }, [])

  // Whether the pointer is over something that takes clicks (moves arrive even while
  // clicks pass through): main lets the window take them, and the toolbar shows.
  useEffect(() => {
    let over = false
    let linger: ReturnType<typeof setTimeout> | undefined
    const report = (next: boolean) => {
      if (next === over) return
      over = next
      window.gloom?.pet.hover(next)
      clearTimeout(linger)
      if (next) {
        setHover(true)
        setHello((h) => (h + 1) % HELLOS.length)
      } else linger = setTimeout(() => setHover(false), LINGER_MS)
    }
    const onMove = (e: globalThis.MouseEvent) => report(press.current !== null || !!(e.target as Element | null)?.closest?.('[data-pet-hit]'))
    const onLeave = () => press.current === null && report(false)
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      clearTimeout(linger)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const dangleSoon = () => {
    clearTimeout(stillTimer.current)
    stillTimer.current = setTimeout(() => press.current?.moved && setCarry({ loop: 'fall', left: press.current.left }), STILL_MS)
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.screenX, y: e.screenY, t: e.timeStamp, vx: 0, vy: 0, moved: false, left: false }
    window.gloom?.pet.drag('start')
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p) return
    const dx = e.screenX - p.x
    const dy = e.screenY - p.y
    if (!p.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
    const dt = Math.max(1, e.timeStamp - p.t)
    // Smoothed velocity, so one jittery move doesn't flip the pet around.
    p.vx = p.vx * 0.6 + (dx / dt) * 0.4
    p.vy = p.vy * 0.6 + (dy / dt) * 0.4
    Object.assign(p, { x: e.screenX, y: e.screenY, t: e.timeStamp, moved: true })
    window.gloom?.pet.drag('move')
    const sideways = Math.abs(p.vx) > WALK_SPEED && Math.abs(p.vx) > Math.abs(p.vy) * 1.2
    if (sideways) p.left = p.vx < 0
    setCarry({ loop: sideways ? 'walk' : 'fall', left: p.left })
    dangleSoon()
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current
    press.current = null
    clearTimeout(stillTimer.current)
    setCarry(null)
    window.gloom?.pet.drag('end')
    if (p && !p.moved && e.button === 0) {
      setJumping((n) => n + 1)
      window.gloom?.pet.open()
    }
  }

  if (!view) return null
  // The card on show (the one you cycled to while it's still there, else the most urgent), and what the others are.
  const index = Math.max(0, view.cards.findIndex((c) => c.sessionId === pick))
  const shown = view.cards[index] ?? null
  const mood: Mood = shown?.mood ?? 'rest'
  const others = othersLine(view.cards, index)
  const next = () => setPick(view.cards[(index + 1) % view.cards.length]?.sessionId ?? null)
  const loop: PetLoopName = carry ? carry.loop : jumping ? 'jump' : hover ? 'happy' : mood === 'busy' ? 'busy' : 'idle'
  // At rest the card only says hello while the pointer is on the pet.
  const resting = mood === 'rest'
  const card = !carry && (!resting || hover)
  return (
    <div className="pet-stage">
      <div data-pet-hit className="pet-body" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={menu}>
        <motion.div key={view.kind} className="origin-bottom" initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={arrive(reduce)}>
          <PixelPet
            key={`${loop}-${jumping}`}
            kind={view.kind}
            custom={view.custom}
            mood={mood}
            loop={loop}
            scale={view.size}
            flip={!!carry?.left}
            still={!!reduce}
            onDone={() => setJumping(0)}
          />
        </motion.div>
      </div>
      <div className="pet-toolbar-slot">
        <AnimatePresence>
          {hover && !carry && (
            <motion.div
              key="toolbar"
              data-pet-hit
              role="toolbar"
              aria-label="Pet"
              className="pet-toolbar"
              onContextMenu={menu}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -2 }}
              transition={arrive(reduce)}
            >
              <ToolButton tip="New session" onClick={() => act('new-session')}>
                <SquarePen size={15} strokeWidth={2} />
              </ToolButton>
              <span className="pet-tool-divider" aria-hidden />
              <ToolButton tip="Next pet" onClick={() => act('next-pet')}>
                <Shuffle size={15} strokeWidth={2} />
              </ToolButton>
              <span className="pet-tool-divider" aria-hidden />
              <ToolButton tip="More" onClick={() => act('menu')}>
                <ChevronDown size={15} strokeWidth={2} />
              </ToolButton>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="pet-card-slot">
        <AnimatePresence>
          {card && (
            <motion.div
              key="card"
              data-pet-hit
              className="pet-card"
              onContextMenu={menu}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -2 }}
              transition={arrive(reduce)}
            >
              <button type="button" className="pet-card-main" role="status" aria-live="polite" onClick={() => act('open-card', shown?.sessionId)}>
                <span className="pet-card-title">
                  <Status mood={mood} />
                  <span className="truncate">{resting ? 'Start a conversation' : shown?.title}</span>
                </span>
                <span className="pet-card-detail">{resting ? HELLOS[hello] : shown?.detail}</span>
              </button>
              {others && (
                <button type="button" className="pet-card-more" onClick={next} aria-label={`Next session: ${others}`}>
                  <span className="truncate">{others}</span>
                  <ChevronRight size={13} strokeWidth={2.25} aria-hidden />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** The card's status: a spinner while working, an amber dot when it needs you, a green check when it's done. */
function Status({ mood }: { mood: Mood }) {
  if (mood === 'busy') return <span className="pet-spinner" aria-label="Working" />
  if (mood === 'needs') return <span className="pet-needs" aria-label="Needs you" />
  if (mood === 'ready') return <CircleCheck className="pet-ready" size={15} strokeWidth={2.4} aria-label="Done" />
  return null
}

/** An icon button with a styled tooltip above it (the native ones look out of place on the desktop). */
function ToolButton({ tip, onClick, children }: { tip: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="pet-tool" aria-label={tip} data-tip={tip} onClick={onClick}>
      {children}
    </button>
  )
}
