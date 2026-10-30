import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'

/**
 * A collapsed column brought back over the content. It emerges from the edge
 * of whatever sits to its left and leaves the same way; keyboard toggles skip
 * the motion, and reduced motion swaps the slide for a fade.
 */
export function OverlaySheet({
  open,
  instant,
  left,
  width,
  label,
  onClose,
  children
}: {
  open: boolean
  instant: boolean
  /** Where the sheet's area starts: 0, or the inline folder column's edge. */
  left: number
  width: number
  label: string
  onClose(viaKeyboard: boolean): void
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  const transition: Transition = instant
    ? { duration: 0 }
    : reduce
      ? { duration: 0.2, ease: [0.23, 1, 0.32, 1] }
      : { type: 'spring', bounce: 0, duration: 0.3 }
  // Past its own width, so the shadow leaves too.
  const hidden = reduce ? { opacity: 0 } : { x: -width - 32 }
  const shown = reduce ? { opacity: 1 } : { x: 0 }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(true)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-30 overflow-hidden" style={{ left }}>
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
            key="sheet"
            role="dialog"
            aria-label={label}
            className="pointer-events-auto absolute inset-y-0 left-0 overflow-hidden bg-[var(--material-sheet)] shadow-[var(--shadow-sheet)] backdrop-blur-2xl"
            style={{ width }}
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
