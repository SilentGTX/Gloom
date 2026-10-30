import type { ReactElement, ReactNode } from 'react'
import { Tooltip as Base } from '@base-ui/react/tooltip'

/** Once one tooltip is showing, the next opens without the delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Base.Provider delay={600} closeDelay={0} timeout={400}>
      {children}
    </Base.Provider>
  )
}

export function Tooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement }) {
  return (
    <Base.Root>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner sideOffset={6} className="z-50">
          <Base.Popup
            className={[
              'flex items-center gap-2 rounded-[6px] bg-[var(--material-popover)] px-2 py-1 text-footnote text-label shadow-[var(--shadow-popover)] backdrop-blur-xl',
              'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-tooltip)] ease-out',
              'data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
              'data-[instant]:transition-none motion-reduce:data-[starting-style]:scale-100'
            ].join(' ')}
          >
            {label}
            {shortcut && <kbd className="font-sans text-caption text-label-tertiary tabular">{shortcut}</kbd>}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}
