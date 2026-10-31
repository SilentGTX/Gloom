import { useEffect, useRef, type ReactNode } from 'react'
import { File as FileIcon, Folder as FolderIcon } from 'lucide-react'
import type { CommandInfo } from '@shared/live'
import { cn } from '../../lib/cn'

/**
 * A list over the composer of what can go in: the slash commands, or the files
 * `@` finds. The keyboard stays in the box: the arrows move the highlight, Tab
 * or Enter puts it in, Esc puts the list away; the pointer highlights what it
 * moves onto and a click puts that in. It comes and goes with what you type,
 * at once, as keyboard actions don't animate.
 */
export function Suggestions<T>({
  id,
  label,
  items,
  keyOf,
  highlight,
  onPick,
  onHover,
  children
}: {
  id: string
  label: string
  items: readonly T[]
  keyOf(item: T): string
  highlight: number
  onPick(item: T): void
  onHover(index: number): void
  children(item: T): ReactNode
}) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current?.querySelector(`#${id}-${highlight}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, highlight])
  return (
    <ul ref={list} id={id} role="listbox" aria-label={label} className="glass-strong absolute inset-x-0 bottom-[calc(100%+8px)] z-10 max-h-64 overflow-y-auto rounded-[var(--radius-popover)] p-1.5">
      {items.map((item, i) => (
        <li
          key={keyOf(item)}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === highlight}
          data-highlighted={i === highlight ? '' : undefined}
          onPointerMove={() => onHover(i)}
          // The box keeps the keyboard.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(item)}
          // Colours come from the component styles: Tailwind's colour utilities would outrank the highlight's.
          className={cn('suggestion-row relative z-[2] flex min-h-8 cursor-default items-center gap-3 rounded-[8px] py-1 pr-2.5 pl-2.5 text-[0.8125rem]', i === highlight && 'is-active')}
        >
          {children(item)}
        </li>
      ))}
    </ul>
  )
}

/** A slash command: its name, what it takes, what it does. */
export function CommandRow({ command }: { command: CommandInfo }) {
  return (
    <>
      <span className="shrink-0 font-mono text-[0.78125rem]">/{command.name}</span>
      {command.argumentHint && <span className="suggestion-quiet shrink-0 font-mono text-[0.75rem]">{command.argumentHint}</span>}
      <span className="suggestion-quiet min-w-0 flex-1 truncate">{command.description}</span>
    </>
  )
}

/**
 * A file or folder `@` found: its name, and in secondary ink the folder it's
 * in, shortened to the outermost folder and its own when it runs deep (all of
 * it on hover, and to a screen reader).
 */
export function FileRow({ path }: { path: string }) {
  const folder = path.endsWith('/')
  const bare = folder ? path.slice(0, -1) : path
  const cut = bare.lastIndexOf('/')
  const where = cut > 0 ? bare.slice(0, cut) : ''
  const parts = where.split('/')
  const short = parts.length > 2 ? `${parts[0]}/…/${parts.at(-1)}` : where
  const Icon = folder ? FolderIcon : FileIcon
  return (
    <>
      <Icon size={15} strokeWidth={1.75} aria-hidden className={cn('shrink-0', folder ? 'suggestion-folder' : 'suggestion-quiet')} />
      {/* Relative: the hidden words stay inside what the ellipsis cuts off, rather than widening the list. */}
      <span className="relative min-w-0 flex-1 truncate">
        {bare.slice(cut + 1)}
        {folder && <span className="sr-only"> (folder)</span>}
      </span>
      {where && (
        <span className="suggestion-quiet relative max-w-[50%] shrink-0 truncate text-[0.75rem]" title={short !== where ? where : undefined}>
          <span aria-hidden={short !== where || undefined}>{short}</span>
          {short !== where && <span className="sr-only">{where}</span>}
        </span>
      )}
    </>
  )
}
