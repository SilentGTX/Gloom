// The pet's artwork and the main window's report of what it should show. The
// pet itself lives in a window of its own, on top of every app (main/pet.ts,
// PetWindow.tsx). The art is pixel sprites drawn with pxl (art/pets.px.js):
// each pet rests on one loop and works on another, played frame by frame here.
import { useEffect, useRef, useState } from 'react'
import type { Transition } from 'motion/react'
import type { PetKind } from '@shared/live'
import { useFinished } from '../concept/finished'
import { useLive } from '../../stores/live'
import { petMood, type Mood } from './mood'
import { PET_SPRITES, type PetLoopName } from './sprites'

/** Badge colours: amber for "needs you", green for "ready". */
const BADGE: Partial<Record<Mood, string>> = { needs: '#FF9F0A', ready: '#34C759' }

/**
 * A pet, `scale` times its pixel size with crisp pixels, playing one of its loops
 * (by default its working loop while a session works, else its resting one), with
 * a badge when one needs you or is ready. `flip` faces it left (the walk faces
 * right). A loop played `once` calls `onDone` at its end. With `still` (reduced
 * motion) it holds the loop's first frame.
 */
export function PixelPet({
  kind,
  mood,
  loop: name = mood === 'busy' ? 'busy' : 'idle',
  flip = false,
  scale = 4,
  still = false,
  onDone
}: {
  kind: PetKind
  mood: Mood
  loop?: PetLoopName
  flip?: boolean
  scale?: number
  still?: boolean
  onDone?: () => void
}) {
  const loop = PET_SPRITES[kind][name]
  const [frame, setFrame] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    setFrame(0)
    if (still || loop.durations.length < 2) {
      if (loop.once) done.current?.()
      return
    }
    let at = 0
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      timer = setTimeout(() => {
        if (loop.once && at === loop.durations.length - 1) return done.current?.()
        at = (at + 1) % loop.durations.length
        setFrame(at)
        next()
      }, loop.durations[at])
    }
    next()
    return () => clearTimeout(timer)
  }, [loop, still])
  const badge = BADGE[mood]
  return (
    <div className="relative" style={{ width: loop.w * scale, height: loop.h * scale }} aria-hidden>
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundImage: `url(${loop.src})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${loop.w * loop.durations.length * scale}px ${loop.h * scale}px`,
          backgroundPosition: `${-frame * loop.w * scale}px 0`,
          imageRendering: 'pixelated',
          transform: flip ? 'scaleX(-1)' : undefined
        }}
      />
      {badge && (
        <span
          className="absolute rounded-full"
          style={{ width: 3 * scale, height: 3 * scale, top: (loop.h - 17) * scale, right: 0, background: badge, boxShadow: `0 0 0 ${scale / 2}px #1b1630` }}
        />
      )}
    </div>
  )
}

/** A critically damped spring (no bounce) for things that arrive; reduced motion gets a short fade. */
export const arrive = (reduce: boolean | null): Transition => (reduce ? { duration: 0.2, ease: [0.23, 1, 0.32, 1] } : { type: 'spring', bounce: 0, duration: 0.32 })

/** In the main window: tells main what the pet should show, as the sessions change. Mounted once, by the app. */
export function usePetReport(): void {
  const sessions = useLive((s) => s.sessions)
  const finished = useFinished((s) => s.ids)
  const { mood, text } = petMood(sessions, finished)
  useEffect(() => {
    window.gloom?.pet.report({ mood, text })
  }, [mood, text])
}
