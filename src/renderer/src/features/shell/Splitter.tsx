import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '../../lib/cn'

interface SplitterProps {
  label: string
  value: number
  min: number
  max: number
  initial: number
  onChange(width: number): void
  /** 'edge': where the paper meets the sky column, no line of its own. 'hairline': between panes. */
  variant: 'edge' | 'hairline'
}

/**
 * A column boundary. Drags 1:1 from wherever it was grabbed; arrows nudge it,
 * Home/End jump to the limits, double-click or Enter resets.
 */
export function Splitter({ label, value, min, max, initial, onChange, variant }: SplitterProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const clamp = (width: number) => Math.round(Math.min(max, Math.max(min, width)))

  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: value }
    document.documentElement.style.cursor = 'col-resize'
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onChange(clamp(drag.current.startWidth + e.clientX - drag.current.startX))
  }
  const end = () => {
    drag.current = null
    document.documentElement.style.cursor = ''
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8
    const next = { ArrowLeft: value - step, ArrowRight: value + step, Home: min, End: max, Enter: initial }[e.key]
    if (next === undefined) return
    e.preventDefault()
    onChange(clamp(next))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={key}
      // Net width zero: the 8px grab area overlaps both sides, and a hairline lands
      // on the next column's first pixel.
      className="no-drag group relative z-20 -mx-1 w-2 shrink-0 cursor-col-resize outline-none"
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1 w-px transition-colors duration-150 group-focus-visible:w-0.5 group-focus-visible:bg-accent',
          variant === 'hairline' ? 'bg-separator group-hover:bg-separator-strong' : 'bg-transparent group-hover:bg-separator-strong'
        )}
      />
    </div>
  )
}
