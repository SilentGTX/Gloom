import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '../../lib/cn'

interface SplitterProps {
  label: string
  value: number
  min: number
  max: number
  initial: number
  onChange(size: number): void
  /** 'edge': where the paper meets the sky column, no line of its own. 'hairline': between panes. */
  variant: 'edge' | 'hairline'
  /** Between columns (the default), or between a pane and the one under it. */
  orientation?: 'vertical' | 'horizontal'
  /** The pane it sizes sits after it (the diff pane, the terminal), so dragging toward it shrinks it. */
  sizes?: 'before' | 'after'
}

/**
 * A boundary between panes. Drags 1:1 from wherever it was grabbed; arrows
 * nudge it, Home/End jump to the limits, double-click or Enter resets.
 */
export function Splitter({ label, value, min, max, initial, onChange, variant, orientation = 'vertical', sizes = 'before' }: SplitterProps) {
  const drag = useRef<{ start: number; startSize: number } | null>(null)
  const clamp = (size: number) => Math.round(Math.min(max, Math.max(min, size)))
  const vertical = orientation === 'vertical'
  const sign = sizes === 'before' ? 1 : -1
  const cursor = vertical ? 'col-resize' : 'row-resize'

  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { start: vertical ? e.clientX : e.clientY, startSize: value }
    document.documentElement.style.cursor = cursor
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    // Only real changes: each one re-lays the window out.
    const next = clamp(drag.current.startSize + sign * ((vertical ? e.clientX : e.clientY) - drag.current.start))
    if (next !== value) onChange(next)
  }
  const end = () => {
    drag.current = null
    document.documentElement.style.cursor = ''
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 32 : 8) * sign
    const [less, more] = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    const next = { [less]: value - step, [more]: value + step, Home: min, End: max, Enter: initial }[e.key]
    if (next === undefined) return
    e.preventDefault()
    onChange(clamp(next))
  }

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, value)}
      tabIndex={0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={key}
      // Net size zero: the 8px grab area overlaps both sides, and a hairline lands
      // on the next pane's first pixel.
      className={cn('no-drag group relative z-20 shrink-0 outline-none', vertical ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize')}
    >
      <div
        className={cn(
          'pointer-events-none absolute transition-colors duration-150 group-focus-visible:bg-accent',
          vertical ? 'inset-y-0 left-1 w-px group-focus-visible:w-0.5' : 'inset-x-0 top-1 h-px group-focus-visible:h-0.5',
          variant === 'hairline' ? 'bg-separator group-hover:bg-separator-strong' : 'bg-transparent group-hover:bg-separator-strong'
        )}
      />
    </div>
  )
}
