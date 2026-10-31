import type { ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { ContextMenu as BaseContext } from '@base-ui/react/context-menu'
import { Menu as Base } from '@base-ui/react/menu'

export const MenuRoot = Base.Root
export const MenuTrigger = Base.Trigger
export const MenuGroup = Base.Group
export const ContextMenuRoot = BaseContext.Root
export const ContextMenuTrigger = BaseContext.Trigger

const popupClass = [
  // At most as wide as a long item needs to be read: longer ones end in an ellipsis and say the rest on hover.
  'glass-strong max-h-[var(--available-height)] max-w-[min(400px,var(--available-width))] min-w-64 overflow-y-auto rounded-[var(--radius-popover)] p-1.5 text-[13px] text-label outline-none',
  'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-menu)] ease-out',
  'data-[starting-style]:scale-[0.94] data-[starting-style]:opacity-0',
  'data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms]',
  'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100'
].join(' ')

/** A glass menu that grows out of its trigger (Base UI sets --transform-origin). */
export function MenuPopup({ children, align = 'start' }: { children: ReactNode; align?: 'start' | 'center' | 'end' }) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={6} align={align} collisionPadding={8} className="z-50 outline-none">
        <Base.Popup className={popupClass}>
          <div className="relative z-[2]">{children}</div>
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  )
}

/** The same glass menu, opened at the pointer by a right click. */
export function ContextMenuPopup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <BaseContext.Portal>
      <BaseContext.Positioner collisionPadding={8} className="z-50 outline-none">
        <BaseContext.Popup aria-label={label} className={`${popupClass} min-w-56`}>
          <div className="relative z-[2]">{children}</div>
        </BaseContext.Popup>
      </BaseContext.Positioner>
    </BaseContext.Portal>
  )
}

/** One level of submenu, as Apple's guidelines allow in a context menu. */
export function MenuSubmenu({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Base.SubmenuRoot>
      <Base.SubmenuTrigger className={`relative ${itemClass} data-[popup-open]:bg-fill-strong`}>
        <Leading icon={icon} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={14} strokeWidth={2} className="-mr-1 text-label-secondary" aria-hidden />
      </Base.SubmenuTrigger>
      <Base.Portal>
        <Base.Positioner sideOffset={2} alignOffset={-6} collisionPadding={8} className="z-50 outline-none">
          <Base.Popup className={`${popupClass} min-w-52`}>
            <div className="relative z-[2]">{children}</div>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.SubmenuRoot>
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

/** Every item keeps a leading gutter, for a checkmark or an icon. */
function Leading({ icon }: { icon?: ReactNode }) {
  return icon ? (
    <span className="absolute left-2 flex size-3.5 items-center justify-center text-label-secondary [&>svg]:size-3.5" aria-hidden>
      {icon}
    </span>
  ) : null
}

function Trailing({ shortcut, note, disabled }: { shortcut?: string; note?: string; disabled?: boolean }) {
  if (disabled && note) return <span className="text-[11px] text-label-tertiary">{note}</span>
  return shortcut ? <kbd className="font-sans text-label-secondary tabular">{shortcut}</kbd> : null
}

export function MenuItem({
  label,
  shortcut,
  note,
  detail,
  disabled,
  icon,
  destructive,
  indent = 0,
  onClick
}: {
  label: string
  shortcut?: string
  /** Shown instead of the shortcut on disabled items, e.g. the phase that builds them. */
  note?: string
  /** What it does, on a second line in secondary ink. */
  detail?: string
  disabled?: boolean
  icon?: ReactNode
  /** Destroys something: red, and listed last. */
  destructive?: boolean
  /** Nesting depth, for menus that list folders. */
  indent?: number
  onClick?: () => void
}) {
  return (
    <Base.Item
      disabled={disabled}
      onClick={onClick}
      className={`relative ${detail ? detailItemClass : itemClass} ${destructive ? 'text-[var(--destructive)] [&_svg]:text-[var(--destructive)]' : ''}`}
      style={indent ? { paddingLeft: 28 + indent * 14 } : undefined}
    >
      <Leading icon={icon} />
      {detail ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{label}</span>
          <span className="text-[11.5px] leading-snug whitespace-normal text-label-secondary">{detail}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
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
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Base.CheckboxItem>
  )
}

/** One choice of several, with a checkmark on the current one. */
export function MenuRadioGroup<T extends string>({ value, onChange, children }: { value: T; onChange(value: T): void; children: ReactNode }) {
  return (
    <Base.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
      {children}
    </Base.RadioGroup>
  )
}

/** A choice; `detail` explains it on a second line, in secondary ink. */
export function MenuRadioItem({ label, value, detail, destructive }: { label: string; value: string; detail?: string; destructive?: boolean }) {
  return (
    <Base.RadioItem
      value={value}
      closeOnClick
      className={`relative ${detail ? detailItemClass : itemClass} ${destructive ? 'text-[var(--destructive)]' : ''}`}
    >
      <Base.RadioItemIndicator className={`absolute left-2 flex items-center ${detail ? 'top-[7px]' : ''}`}>
        <Check size={14} strokeWidth={2.25} />
      </Base.RadioItemIndicator>
      {detail ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{label}</span>
          <span className="text-[11.5px] leading-snug whitespace-normal text-label-secondary">{detail}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
    </Base.RadioItem>
  )
}

const detailItemClass = [
  'flex min-h-7 items-start gap-6 rounded-[7px] py-[5px] pr-2.5 pl-7 outline-none select-none',
  'data-[highlighted]:bg-fill-strong data-[disabled]:text-label-tertiary'
].join(' ')
