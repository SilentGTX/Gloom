import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'

/**
 * A collapsed column brought back as a floating panel over the card. It slides
 * out from the edge of the area it belongs to and leaves the same way; keyboard
 * toggles skip the motion, and reduced motion swaps the slide for a fade. Focus
 * moves into it on open and back where it was on close.
 */
export function OverlaySheet({
  open,
  instant,
  area,
  inset,
  width,
  label,
  onClose,
  children
}: {
  open: boolean
  instant: boolean
  /** The region the panel and scrim live in (and are clipped to), in window coordinates. */
  area: CSSProperties
  /** The panel's offset within that region. */
  inset: number
  width: number
  label: string
  onClose(viaKeyboard: boolean): void
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  const transition: Transition = instant
    ? { duration: 0 }
    : reduce
      ? { duration: 0.2, ease: [0.23, 1, 0.32, 1] }
      : { type: 'spring', bounce: 0, duration: 0.32 }
  // Past its own width, so the shadow leaves too.
  const hidden = reduce ? { opacity: 0 } : { x: -width - 40 }
  const shown = reduce ? { opacity: 1 } : { x: 0 }

  useEffect(() => {
    if (!open) return
    const returnTo = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"], input:not([disabled])')
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true })
    }
  }, [open, onClose])

  return (
    <div className="pointer-events-none absolute z-30 overflow-hidden" style={area}>
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            className="no-drag pointer-events-auto absolute inset-0 bg-[var(--scrim)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            onPointerDown={() => onClose(false)}
          />
        )}
        {open && (
          <motion.div
            key="panel"
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="pointer-events-auto absolute"
            style={{ top: inset, bottom: inset, left: inset, width }}
            initial={hidden}
            animate={shown}
            exit={hidden}
            transition={transition}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
