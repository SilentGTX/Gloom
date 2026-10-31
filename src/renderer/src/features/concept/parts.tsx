// Small pieces the concept design shares: its segmented track, and the
// spinner that marks work under way.
import { useRef, type KeyboardEvent } from 'react'
import { useReducedMotion } from 'motion/react'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useUi } from '../../stores/ui'

export const useConcept = () => useUi((s) => s.design === 'concept')

export interface TrackSegment<T extends string> {
  value: T
  label: string
  /** Its tooltip: what the segment shows. */
  title: string
  shortcut?: string
}

/**
 * The concept's segmented control: equal segments on a quiet track, one raised
 * thumb sliding under the chosen one (220 ms, ease-out; CSS, so a second
 * click mid-slide turns it from where it is). From the keyboard (arrows, Home,
 * End) it moves at once, as does everything under reduced motion. Tabs for
 * assistive tech, each controlling `panel`.
 */
export function Track<T extends string>({
  label,
  value,
  segments,
  onChange,
  panel,
  small
}: {
  label: string
  value: T
  segments: TrackSegment<T>[]
  onChange(value: T, viaKeyboard: boolean): void
  panel?: string
  /** A shorter track, inside a view rather than in the toolbar. */
  small?: boolean
}) {
  const reduce = useReducedMotion()
  const keyedAt = useRef(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = Math.max(0, segments.findIndex((s) => s.value === value))
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: segments.length - 1 }[e.key]
    if (next === undefined || next < 0 || next >= segments.length || next === at) return
    e.preventDefault()
    keyedAt.current = Date.now()
    onChange(segments[next].value, true)
    refs.current[next]?.focus()
  }
  const instant = reduce || Date.now() - keyedAt.current < 150
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={key}
      className={cn('concept-track no-drag', small && 'is-small')}
      style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="concept-track-thumb"
        style={{ width: `calc((100% - 4px) / ${segments.length})`, transform: `translateX(${at * 100}%)`, transition: instant ? 'none' : undefined }}
      />
      {segments.map((s, i) => {
        const selected = i === at
        return (
          <Tooltip key={s.value} label={s.title} shortcut={s.shortcut}>
            <button
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panel}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(s.value, false)}
              className={cn('concept-track-segment', selected && 'is-selected')}
            >
              {s.label}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** Work under way: a small ring with the accent running round it (it holds still under reduced motion). */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  return <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('concept-spinner', className)} />
}
