// The pet's artwork and the main window's report of what it should show. The
// pet itself lives in a window of its own, on top of every app (main/pet.ts,
// PetWindow.tsx). The art is pixel sprites drawn with pxl (art/pets.px.js):
// each pet rests on one loop and works on another, played frame by frame here.
import { useEffect, useRef, useState } from 'react'
import type { Transition } from 'motion/react'
import type { CustomPet, PetLoopData, PetLoopKey } from '@shared/ipc'
import { displayTitle } from '@shared/library'
import { isBuiltInPet, type PetKind } from '@shared/live'
import { useFinished } from '../concept/finished'
import { useLibrary } from '../../stores/library'
import { useLive } from '../../stores/live'
import { petCards, type Mood } from './mood'
import { PET_SPRITES, type PetLoopName } from './sprites'

/** A pet's loops: Gloom's own, or yours (a pet you created), else Blob's. */
export function loopsOf(kind: PetKind, custom: CustomPet | null | undefined): Record<PetLoopKey, PetLoopData | (typeof PET_SPRITES)['blob'][PetLoopName]> {
  if (isBuiltInPet(kind)) return PET_SPRITES[kind]
  return custom && `custom:${custom.id}` === kind ? custom.loops : PET_SPRITES.blob
}

/** How tall Gloom's own pets are, in their pixels. A taller pet you add is drawn at this height, so every pet shows the same size. */
export const PET_HEIGHT = 27

/** The screen pixels per pet pixel a pet is drawn at, for a size: the size itself for a Gloom-sized pet; less for a taller one, so it shows as tall as they do. */
export function petScale(kind: PetKind, custom: CustomPet | null | undefined, size: number): number {
  const tallest = Math.max(...Object.values(loopsOf(kind, custom)).map((l) => l.h))
  return tallest > PET_HEIGHT ? (size * PET_HEIGHT) / tallest : size
}

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
  custom,
  onDone
}: {
  kind: PetKind
  /** The pet you created, when kind is one. */
  custom?: CustomPet | null
  mood: Mood
  loop?: PetLoopName
  flip?: boolean
  scale?: number
  still?: boolean
  onDone?: () => void
}) {
  const loop = loopsOf(kind, custom)[name]
  // A taller pet is drawn smaller, as tall as Gloom's own; the dot keeps its size.
  const px = petScale(kind, custom, scale)
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
  // A pet you added may say where its dot goes; else the top right of a Gloom-sized pet.
  const spot = custom && `custom:${custom.id}` === kind ? custom.badge : undefined
  const place = spot ? { left: spot.x * px, top: spot.y * px } : { top: (loop.h - 17) * px, right: 0 }
  return (
    <div className="relative" style={{ width: loop.w * px, height: loop.h * px }} aria-hidden>
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundImage: `url(${loop.src})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${loop.w * loop.durations.length * px}px ${loop.h * px}px`,
          backgroundPosition: `${-frame * loop.w * px}px 0`,
          imageRendering: 'pixelated',
          transform: flip ? 'scaleX(-1)' : undefined
        }}
      />
      {badge && (
        <span
          className="absolute rounded-full"
          style={{ width: 3 * scale, height: 3 * scale, ...place, background: badge, boxShadow: `0 0 0 ${scale / 2}px #1b1630` }}
        />
      )}
    </div>
  )
}

/** A critically damped spring (no bounce) for things that arrive; reduced motion gets a short fade. */
export const arrive = (reduce: boolean | null): Transition => (reduce ? { duration: 0.2, ease: [0.23, 1, 0.32, 1] } : { type: 'spring', bounce: 0, duration: 0.32 })

/** How often the pet hears of a reply as it streams in, at most. */
const REPORT_MS = 250

/** In the main window: tells main what the pet should show, as the sessions change. Mounted once, by the app. */
export function usePetReport(): void {
  const sessions = useLive((s) => s.sessions)
  const streams = useLive((s) => s.streams)
  const provisional = useLive((s) => s.provisional)
  const finished = useFinished((s) => s.ids)
  const metas = useLibrary((s) => s.sessions)
  const entries = useLibrary((s) => s.library.sessions)
  const cards = petCards(sessions, finished, {
    title: (id) => (metas[id] ? displayTitle(metas[id], entries[id]) : 'New Session'),
    stream: (id) => streams[id],
    entries: (id) => provisional[id]?.entries
  })
  const key = JSON.stringify(cards)
  const sent = useRef({ key: '', at: 0 })
  useEffect(() => {
    const send = () => {
      sent.current = { key, at: Date.now() }
      window.gloom?.pet.report(JSON.parse(key))
    }
    if (key === sent.current.key) return
    const wait = REPORT_MS - (Date.now() - sent.current.at)
    if (wait <= 0) return send()
    const timer = setTimeout(send, wait)
    return () => clearTimeout(timer)
  }, [key])
}
