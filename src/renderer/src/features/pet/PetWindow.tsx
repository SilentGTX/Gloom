// The page in the pet's own window (main/pet.ts): the pet in the bottom-right
// corner of a clear window, its bubble above it. Everything else in the window
// lets clicks through to the app underneath, so the page tells main whenever the
// pointer is over the pet or its bubble. Drag the pet to move it; click it, or
// its bubble, and Gloom comes forward.
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { PetView } from '@shared/ipc'
import { arrive, PetArt, petMotion } from './Pet'
import './pet-window.css'

/** Past this many pixels a press is a drag, not a click. */
const DRAG_SLOP = 4

export function PetWindow() {
  const [view, setView] = useState<PetView | null>(null)
  const reduce = useReducedMotion()
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => {
    document.documentElement.dataset.pet = ''
    const api = window.gloom?.pet
    if (!api) return
    void api.current().then(setView)
    return api.onView(setView)
  }, [])

  // Whether the pointer is over something that takes clicks; moves arrive even while clicks pass through.
  useEffect(() => {
    let over = false
    const report = (next: boolean) => {
      if (next === over) return
      over = next
      window.gloom?.pet.hover(next)
    }
    const onMove = (e: MouseEvent) => report(press.current !== null || !!(e.target as Element | null)?.closest?.('[data-pet-hit]'))
    const onLeave = () => press.current === null && report(false)
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.screenX, y: e.screenY, moved: false }
    window.gloom?.pet.drag('start')
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p) return
    if (!p.moved && Math.hypot(e.screenX - p.x, e.screenY - p.y) < DRAG_SLOP) return
    p.moved = true
    window.gloom?.pet.drag('move')
  }
  const up = () => {
    const p = press.current
    press.current = null
    window.gloom?.pet.drag('end')
    if (p && !p.moved) window.gloom?.pet.open()
  }

  if (!view) return null
  const motionProps = petMotion(view.mood, reduce)
  return (
    <div className="pet-stage">
      <AnimatePresence initial={false}>
        {view.text && (
          <motion.button
            key="bubble"
            type="button"
            data-pet-hit
            className="pet-bubble"
            role="status"
            aria-live="polite"
            title="Show Gloom"
            onClick={() => window.gloom?.pet.open()}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4 }}
            transition={arrive(reduce)}
          >
            {view.text}
          </motion.button>
        )}
      </AnimatePresence>
      <div data-pet-hit className="pet-body" title="Drag to move · Click to show Gloom" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <motion.div
          key={`${view.kind}-${view.mood}`}
          className="origin-bottom"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, ...motionProps.animate }}
          transition={{ opacity: arrive(reduce), ...(reduce ? {} : { scale: arrive(reduce) }), ...motionProps.transition }}
        >
          <PetArt kind={view.kind} mood={view.mood} size={80} />
        </motion.div>
      </div>
    </div>
  )
}
