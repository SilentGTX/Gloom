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

/** `detail` follows the label in secondary ink; `shortcut` is a key combination. */
export function Tooltip({ label, detail, shortcut, children }: { label: string; detail?: string; shortcut?: string; children: ReactElement }) {
  return (
    <Base.Root>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner sideOffset={8} className="z-50">
          <Base.Popup
            className={[
              'glass-strong flex items-center gap-2 rounded-[10px] px-2.5 py-1 text-[12px] text-label',
              'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-tooltip)] ease-out',
              'data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
              'data-[instant]:transition-none motion-reduce:data-[starting-style]:scale-100'
            ].join(' ')}
          >
            <span className="relative z-[2]">{label}</span>
            {detail && <span className="relative z-[2] text-label-secondary tabular">{detail}</span>}
            {shortcut && <kbd className="relative z-[2] font-sans text-label-secondary tabular">{shortcut}</kbd>}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}
