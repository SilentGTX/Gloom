import type { ReactNode } from 'react'
import { Menu as Base } from '@base-ui/react/menu'

export const MenuRoot = Base.Root
export const MenuTrigger = Base.Trigger
export const MenuGroup = Base.Group

/** Grows out of its trigger (Base UI sets --transform-origin), never from nothing. */
export function MenuPopup({ children, align = 'start' }: { children: ReactNode; align?: 'start' | 'center' | 'end' }) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={4} align={align} collisionPadding={8} className="z-50 outline-none">
        <Base.Popup
          className={[
            'max-h-[var(--available-height)] min-w-60 overflow-y-auto rounded-[var(--radius-popover)] p-1 outline-none',
            'bg-[var(--material-popover)] text-body text-label shadow-[var(--shadow-popover)] backdrop-blur-2xl backdrop-saturate-150',
            'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-menu)] ease-out',
            'data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms]',
            'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100'
          ].join(' ')}
        >
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  )
}

export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <Base.GroupLabel className="px-2.5 pt-1.5 pb-0.5 text-caption font-semibold tracking-[var(--tracking-caption)] text-label-tertiary">
      {children}
    </Base.GroupLabel>
  )
}

export function MenuSeparator() {
  return <Base.Separator className="mx-2 my-1 h-px bg-separator" />
}

export function MenuItem({
  label,
  shortcut,
  note,
  disabled,
  onClick
}: {
  label: string
  shortcut?: string
  /** Shown instead of the shortcut on disabled items, e.g. the phase that builds them. */
  note?: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <Base.Item
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex h-7 items-center gap-6 rounded-[5px] px-2.5 outline-none select-none',
        'data-[highlighted]:bg-fill-strong data-[disabled]:text-label-tertiary'
      ].join(' ')}
    >
      <span className="flex-1 truncate">{label}</span>
      {disabled && note ? (
        <span className="text-caption text-label-quaternary">{note}</span>
      ) : (
        shortcut && <kbd className="font-sans text-footnote text-label-tertiary tabular">{shortcut}</kbd>
      )}
    </Base.Item>
  )
}
