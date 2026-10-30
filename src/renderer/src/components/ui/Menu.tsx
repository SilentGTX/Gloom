import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Menu as Base } from '@base-ui/react/menu'

export const MenuRoot = Base.Root
export const MenuTrigger = Base.Trigger
export const MenuGroup = Base.Group

/** A glass menu that grows out of its trigger (Base UI sets --transform-origin). */
export function MenuPopup({ children, align = 'start' }: { children: ReactNode; align?: 'start' | 'center' | 'end' }) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={6} align={align} collisionPadding={8} className="z-50 outline-none">
        <Base.Popup
          className={[
            'glass-strong max-h-[var(--available-height)] min-w-64 overflow-y-auto rounded-[var(--radius-popover)] p-1.5 text-[13px] text-label outline-none',
            'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-menu)] ease-out',
            'data-[starting-style]:scale-[0.94] data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms]',
            'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100'
          ].join(' ')}
        >
          <div className="relative z-[2]">{children}</div>
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  )
}

export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <Base.GroupLabel className="px-2 pt-1.5 pb-0.5 pl-7 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">
      {children}
    </Base.GroupLabel>
  )
}

export function MenuSeparator() {
  return <Base.Separator className="mx-2 my-1 h-px bg-separator" />
}

const itemClass = [
  'flex h-7 items-center gap-6 rounded-[7px] pr-2.5 pl-7 outline-none select-none',
  'data-[highlighted]:bg-fill-strong data-[disabled]:text-label-tertiary'
].join(' ')

function Trailing({ shortcut, note, disabled }: { shortcut?: string; note?: string; disabled?: boolean }) {
  if (disabled && note) return <span className="text-[11px] text-label-tertiary">{note}</span>
  return shortcut ? <kbd className="font-sans text-label-secondary tabular">{shortcut}</kbd> : null
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
    <Base.Item disabled={disabled} onClick={onClick} className={itemClass}>
      <span className="flex-1 truncate">{label}</span>
      <Trailing shortcut={shortcut} note={note} disabled={disabled} />
    </Base.Item>
  )
}

/** A menu item with a checkmark in the leading gutter every item reserves. */
export function MenuCheckItem({ label, checked, onClick }: { label: string; checked: boolean; onClick(): void }) {
  return (
    <Base.CheckboxItem checked={checked} onCheckedChange={onClick} className={`relative ${itemClass}`}>
      <Base.CheckboxItemIndicator className="absolute left-2 flex items-center">
        <Check size={14} strokeWidth={2.25} />
      </Base.CheckboxItemIndicator>
      <span className="flex-1 truncate">{label}</span>
    </Base.CheckboxItem>
  )
}
