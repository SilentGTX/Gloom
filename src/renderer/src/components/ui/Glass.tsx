import type { PointerEvent, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * A Liquid Glass capsule for toolbar controls on the sky. Holds one button or a
 * group of related ones; a soft light follows the pointer across it.
 */
export function GlassCapsule({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  const follow = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--light-x', `${e.clientX - box.left}px`)
    e.currentTarget.style.setProperty('--light-y', `${e.clientY - box.top}px`)
  }
  return (
    <div role={label ? 'group' : undefined} aria-label={label} onPointerMove={follow} className={cn('glass-capsule no-drag flex h-8 items-center gap-0.5 px-0.5', className)}>
      <span className="glass-light" aria-hidden />
      <div className="relative z-[2] flex items-center gap-0.5">{children}</div>
    </div>
  )
}
