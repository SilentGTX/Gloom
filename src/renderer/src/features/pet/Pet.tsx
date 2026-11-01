// The pet: a small built-in companion that floats over the bottom-right of the
// window and says what the sessions are doing. Drawn in SVG, so there's no file
// to ship. It's decorative (the bubble is the status, announced politely), and
// it never takes the pointer from the chat around it.
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import type { PetKind } from '@shared/live'
import { GlassCapsule } from '../../components/ui/Glass'
import { useFinished } from '../concept/finished'
import { useLive } from '../../stores/live'
import { petMood, type Mood } from './mood'

const PALETTE: Record<PetKind, { body: string; ink: string; shade: string }> = {
  blob: { body: '#3D7BF0', ink: '#0B1C46', shade: '#2A5FCC' },
  sprout: { body: '#2FBF7A', ink: '#0B3B26', shade: '#21985F' },
  orb: { body: '#8C6BF0', ink: '#24134F', shade: '#6B4FD0' }
}

/** Badge colours: amber for "needs you", green for "ready". */
const BADGE: Partial<Record<Mood, string>> = { needs: '#FF9F0A', ready: '#34C759' }

function Face({ kind, ink }: { kind: PetKind; ink: string }) {
  if (kind === 'blob') {
    // The `>_` face: a chevron and a cursor.
    return (
      <g fill="none" stroke={ink} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 27l6 5-6 5" />
        <path d="M32 41h11" />
      </g>
    )
  }
  if (kind === 'sprout') {
    return (
      <g fill={ink}>
        <circle cx="25" cy="31" r="2.8" />
        <circle cx="39" cy="31" r="2.8" />
        <path d="M26 39q6 5 12 0" fill="none" stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
      </g>
    )
  }
  return (
    <g fill={ink}>
      <circle cx="26" cy="31" r="2.6" />
      <circle cx="38" cy="31" r="2.6" />
    </g>
  )
}

function Body({ kind }: { kind: PetKind }) {
  const { body, shade } = PALETTE[kind]
  if (kind === 'blob') {
    // A rounded cloud with a flat-ish base, as in Codex's pet.
    return <path d="M32 7c12.5 0 21 8.6 21 21v15c0 8.3-6.2 14-14.5 14h-13C17.2 57 11 51.3 11 43V28C11 15.6 19.5 7 32 7z" fill={body} />
  }
  if (kind === 'sprout') {
    return (
      <g>
        <path d="M32 9c-2.2-6.5-9.4-8.4-14-5.6 2.7 5.3 8.5 6.6 14 5.6z" fill={shade} />
        <path d="M32 9c2.2-6.5 9.4-8.4 14-5.6-2.7 5.3-8.5 6.6-14 5.6z" fill={body} />
        <path d="M32 14c13 0 22 9 22 22 0 11-9 19-22 19S10 47 10 36c0-13 9-22 22-22z" fill={body} />
      </g>
    )
  }
  return (
    <g>
      <circle cx="32" cy="34" r="24" fill={body} />
      <ellipse cx="24" cy="23" rx="7" ry="4.5" fill="#FFFFFF" opacity={0.32} transform="rotate(-24 24 23)" />
      <circle cx="32" cy="34" r="24" fill="none" stroke={shade} strokeWidth={1.5} opacity={0.4} />
    </g>
  )
}

/** The pet's artwork: a body, its face and, for some moods, a badge. Decorative. */
export function PetArt({ kind, mood }: { kind: PetKind; mood: Mood }) {
  const badge = BADGE[mood]
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden className="block overflow-visible">
      <ellipse cx="32" cy="60" rx="15" ry="2.6" fill="#000" opacity={0.18} />
      <Body kind={kind} />
      <Face kind={kind} ink={PALETTE[kind].ink} />
      {badge && <circle cx="54" cy="10" r="5.4" fill={badge} stroke="#FFFFFF" strokeWidth={2} />}
    </svg>
  )
}

/** A critically damped spring (no bounce) for things that arrive; reduced motion gets a short fade. */
const arrive = (reduce: boolean | null): Transition => (reduce ? { duration: 0.2, ease: [0.23, 1, 0.32, 1] } : { type: 'spring', bounce: 0, duration: 0.32 })

/** How the pet moves in each mood: breathing at rest, quicker bobbing while working, a slow lift when it needs you. */
function motionFor(mood: Mood, reduce: boolean | null) {
  if (reduce) return { animate: { y: 0, scaleY: 1 }, transition: { duration: 0 } }
  if (mood === 'busy') return { animate: { y: [0, -3, 0] }, transition: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' as const } }
  if (mood === 'needs') return { animate: { y: [0, -4, 0] }, transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' as const } }
  return { animate: { scaleY: [1, 1.035, 1] }, transition: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' as const } }
}

/** Mounted once, by the app. Renders nothing while the pet is hidden. */
export function Pet() {
  const enabled = useLive((s) => s.settings.pet)
  const kind = useLive((s) => s.settings.petKind)
  const sessions = useLive((s) => s.sessions)
  const finished = useFinished((s) => s.ids)
  const reduce = useReducedMotion()
  if (!enabled) return null
  const { mood, text } = petMood(sessions, finished)
  const motionProps = motionFor(mood, reduce)
  return (
    <div className="pointer-events-none fixed right-[var(--frame)] bottom-[var(--frame)] z-30 flex flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {text && (
          <motion.div
            key="bubble"
            role="status"
            aria-live="polite"
            className="pointer-events-auto"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4 }}
            transition={arrive(reduce)}
            style={{ transformOrigin: 'bottom right' }}
          >
            <GlassCapsule className="h-auto px-3 py-1.5">
              <span className="text-[12px] font-medium whitespace-nowrap text-label">{text}</span>
            </GlassCapsule>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        key={`${kind}-${mood}`}
        className="pointer-events-auto origin-bottom"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, ...motionProps.animate }}
        transition={{ opacity: arrive(reduce), ...(reduce ? {} : { scale: arrive(reduce) }), ...motionProps.transition }}
      >
        <PetArt kind={kind} mood={mood} />
      </motion.div>
    </div>
  )
}
