import type { ReactNode } from 'react'
import { Dialog as Base } from '@base-ui/react/dialog'

/**
 * A glass sheet over a dimmed window, for one short task. It grows in from
 * just below full size; focus moves into it and comes back when it closes.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  width = 460
}: {
  open: boolean
  onClose(): void
  title: string
  description?: ReactNode
  children: ReactNode
  width?: number
}) {
  return (
    <Base.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Backdrop className="no-drag fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-[var(--duration-panel)] ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Base.Popup
          className={[
            'no-drag glass-strong fixed top-[14%] left-1/2 z-50 max-h-[76vh] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-y-auto rounded-[16px] p-5 text-label outline-none',
            'transition-[transform,opacity] duration-[var(--duration-panel)] ease-out',
            'data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:duration-[150ms]',
            'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100'
          ].join(' ')}
          style={{ width }}
        >
          <div className="relative z-[2]">
            <Base.Title className="font-display text-headline font-semibold tracking-[var(--tracking-title)]">{title}</Base.Title>
            {description && <Base.Description className="mt-1.5 text-footnote text-label-secondary">{description}</Base.Description>}
            <div className="mt-4">{children}</div>
          </div>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}
