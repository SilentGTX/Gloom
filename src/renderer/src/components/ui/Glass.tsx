import { useRef, type PointerEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * A Liquid Glass capsule for toolbar controls on the sky. Holds one button or a
 * group of related ones; a soft light follows the pointer across it. The
 * capsule is measured as the pointer arrives, and the light alone restyles as
 * it moves.
 */
export function GlassCapsule({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  const light = useRef<HTMLSpanElement>(null)
  const box = useRef<DOMRect | null>(null)
  const follow = (e: PointerEvent<HTMLDivElement>) => {
    const b = (box.current ??= e.currentTarget.getBoundingClientRect())
    light.current?.style.setProperty('--light-x', `${e.clientX - b.left}px`)
    light.current?.style.setProperty('--light-y', `${e.clientY - b.top}px`)
  }
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      onPointerEnter={(e) => (box.current = e.currentTarget.getBoundingClientRect())}
      onPointerMove={follow}
      className={cn('glass-capsule no-drag flex h-8 items-center gap-0.5 px-0.5', className)}
    >
      <span ref={light} className="glass-light" aria-hidden />
      <div className="relative z-[2] flex items-center gap-0.5">{children}</div>
    </div>
  )
}
