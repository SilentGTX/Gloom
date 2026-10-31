import { useId, useRef, type KeyboardEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '../../lib/cn'
import { Tooltip } from './Tooltip'

export interface Segment<T extends string> {
  value: T
  label: string
  /** Its tooltip: what the segment shows. */
  title?: string
}

/**
 * A segmented control for switching what a pane shows, in a glass capsule
 * (Apple puts these in a toolbar or an inspector, not in the window body). The
 * selection slides to the segment you click; from the keyboard (arrows, Home,
 * End) it moves at once. Tabs for assistive tech, each controlling `panel`.
 */
export function Segmented<T extends string>({
  label,
  value,
  segments,
  onChange,
  panel
}: {
  label: string
  value: T
  segments: Segment<T>[]
  onChange(value: T, viaKeyboard: boolean): void
  /** The id of the content the segments switch. */
  panel?: string
}) {
  const reduce = useReducedMotion()
  const id = useId()
  const keyedAt = useRef(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = segments.findIndex((s) => s.value === value)
    const next = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: segments.length - 1 }[e.key]
    if (next === undefined || next < 0 || next >= segments.length || next === at) return
    e.preventDefault()
    keyedAt.current = Date.now()
    onChange(segments[next].value, true)
    refs.current[next]?.focus()
  }
  // Moved from the keyboard just now: no slide.
  const instant = reduce || Date.now() - keyedAt.current < 150
  return (
    <div role="tablist" aria-label={label} onKeyDown={key} className="glass-capsule no-drag flex h-8 items-center p-[3px]">
      {segments.map((s, i) => {
        const selected = s.value === value
        const segment = (
          <button
            key={s.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(s.value, false)}
            className={cn(
              'relative z-[2] h-full min-w-0 flex-1 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap outline-none select-none',
              'transition-colors duration-[var(--duration-press)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]',
              selected ? 'text-label' : 'text-label-secondary hover:text-label'
            )}
          >
            {selected && (
              <motion.span
                layoutId={`${id}-thumb`}
                aria-hidden
                className="segment-thumb absolute inset-0 rounded-full"
                transition={instant ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.28 }}
              />
            )}
            <span className="relative">{s.label}</span>
          </button>
        )
        // Each segment says what it shows, as Apple asks of a toolbar's segments.
        return s.title ? (
          <Tooltip key={s.value} label={s.title}>
            {segment}
          </Tooltip>
        ) : (
          segment
        )
      })}
    </div>
  )
}
