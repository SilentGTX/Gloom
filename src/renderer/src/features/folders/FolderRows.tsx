// The sidebar's rows: smart folders and your folders, each a tree item that
// selects on click, takes drops, and (for yours) drags, renames in place and
// discloses its subfolders.
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronRight, Folder as FolderIcon, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { TreeRow } from '@shared/library'
import { cn } from '../../lib/cn'
import { useDrag, type DropData } from '../library/drag'

/**
 * Sidebar rows share one shape; selection lays the accent tint over a neutral
 * base. Selection snaps rather than fades: arrow keys move it many times a day.
 */
export function rowClass(selected: boolean, extra?: string) {
  return cn(
    'no-drag relative flex h-8 w-full items-center gap-2 rounded-[var(--radius-row)] text-left outline-none select-none',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]',
    selected ? 'font-medium text-[var(--selection-label)] shadow-[0_1px_2px_rgb(0_0_0/0.06)] [background:var(--selection)]' : 'text-label hover:bg-fill active:bg-fill-pressed',
    extra
  )
}

function Count({ value }: { value: number }) {
  return value > 0 ? <span className="shrink-0 pl-1 text-[12px] font-normal text-label-secondary tabular">{value}</span> : null
}

/** The highlight a row shows while something that can land on it hovers, and as it takes the drop. */
function useDropHighlight(dropId: string) {
  const zone = useDrag((s) => (s.target?.id === dropId ? s.target.zone : null))
  const landed = useDrag((s) => s.landed === dropId)
  return { zone, landed }
}

export function SmartRow({
  navKey,
  label,
  icon: Icon,
  count,
  selected,
  tabbable,
  accepts,
  onSelect,
  onChoose
}: {
  navKey: string
  label: string
  icon: LucideIcon
  count: number
  selected: boolean
  /** The sidebar's one tab stop: the selected row, or the first when that one isn't showing. */
  tabbable: boolean
  /** Which drop it takes: Unfiled files sessions out of folders, Pinned pins, Archived archives. */
  accepts?: Extract<DropData, { kind: 'smart' }>['smart']
  /** On press, as Apple's lists respond: before the button comes up. */
  onSelect(): void
  /** On click: a sheet the sidebar slid in as goes away. */
  onChoose(): void
}) {
  const dropId = `drop:${navKey}`
  const { setNodeRef } = useDroppable({ id: dropId, data: accepts ? ({ kind: 'smart', smart: accepts } satisfies DropData) : undefined, disabled: !accepts })
  const { zone, landed } = useDropHighlight(dropId)
  return (
    <li
      ref={setNodeRef}
      role="treeitem"
      aria-level={1}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      data-nav={navKey}
      data-label={label}
      onPointerDown={(e) => e.button === 0 && onSelect()}
      onClick={onChoose}
      className={rowClass(selected, cn('px-2.5', zone && 'drop-inside', landed && 'drop-landed'))}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Count value={count} />
    </li>
  )
}

/** Indent per level, in pixels: chrome keeps its shape when text grows. */
const INDENT = 14

export function FolderRow({
  row,
  count,
  selected,
  tabbable,
  renaming,
  menuOpen,
  onSelect,
  onChoose,
  onToggle,
  onRename,
  onRenameEnd
}: {
  row: TreeRow
  count: number
  selected: boolean
  tabbable: boolean
  renaming: boolean
  /** Its context menu is open: ringed, as Finder rings the item it acts on. */
  menuOpen: boolean
  /** On press, as Apple's lists respond: before the button comes up. */
  onSelect(): void
  /** On click: a sheet the sidebar slid in as goes away. */
  onChoose(): void
  /** `all`: Alt-click opens or closes everything below, as Option-click does in Finder. */
  onToggle(all: boolean): void
  /** A click on the already-selected row renames it, after a beat, as in Finder. */
  onRename(): void
  onRenameEnd(name: string | null): void
}) {
  const { folder, depth, hasChildren } = row
  const dragging = useDrag((s) => s.active?.kind === 'folder' && s.active.id === folder.id)
  const { setNodeRef: dragRef, listeners } = useDraggable({ id: `folder:${folder.id}`, data: { kind: 'folder', id: folder.id, name: folder.name }, disabled: renaming })
  const dropId = `drop:folder:${folder.id}`
  const { setNodeRef: dropRef } = useDroppable({ id: dropId, data: { kind: 'folder', id: folder.id } satisfies DropData })
  const { zone, landed } = useDropHighlight(dropId)
  const wasSelected = useRef(false)
  const renameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(renameTimer.current ?? undefined), [])

  const down = (e: PointerEvent<HTMLLIElement>) => {
    wasSelected.current = selected
    if (e.button === 0 && !(e.target as HTMLElement).closest('[data-disclosure]')) onSelect()
    listeners?.onPointerDown?.(e)
  }
  const click = (e: MouseEvent<HTMLLIElement>) => {
    if ((e.target as HTMLElement).closest('[data-disclosure]')) return
    onChoose()
    if (wasSelected.current && e.detail === 1 && !e.altKey && !e.ctrlKey && !e.shiftKey) renameTimer.current = setTimeout(onRename, 550)
  }
  const doubleClick = () => {
    clearTimeout(renameTimer.current ?? undefined)
    if (hasChildren) onToggle(false)
  }

  return (
    <motion.li
      layout="position"
      ref={(node) => {
        dragRef(node)
        dropRef(node)
      }}
      role="treeitem"
      aria-level={depth + 1}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={hasChildren ? folder.expanded : undefined}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      data-nav={`folder:${folder.id}`}
      data-label={folder.name}
      data-folder-id={folder.id}
      onPointerDown={down}
      onClick={click}
      onDoubleClick={doubleClick}
      className={rowClass(
        selected,
        cn(
          'pr-2.5',
          zone === 'inside' && 'drop-inside',
          landed && 'drop-landed',
          menuOpen && 'outline-2 -outline-offset-2 outline-[var(--accent-ring)]',
          dragging && 'opacity-45'
        )
      )}
      style={{ paddingLeft: 4 + depth * INDENT }}
    >
      <span
        data-disclosure
        aria-hidden
        onClick={(e) => {
          e.stopPropagation()
          if (hasChildren) onToggle(e.altKey)
        }}
        className={cn('flex size-4 shrink-0 items-center justify-center rounded-[4px] text-label-secondary', hasChildren && 'hover:text-label')}
      >
        {hasChildren && (
          <ChevronRight
            size={12}
            strokeWidth={2.25}
            className={cn('disclosure transition-transform duration-[var(--duration-press)] ease-out motion-reduce:transition-none', folder.expanded && 'rotate-90')}
          />
        )}
      </span>
      <FolderIcon size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-text" />
      {renaming ? <RenameField initial={folder.name} label="Folder name" onDone={onRenameEnd} /> : <span className="min-w-0 flex-1 truncate">{folder.name}</span>}
      {!renaming && <Count value={count} />}
      {(zone === 'before' || zone === 'after') && <InsertionLine at={zone} indent={4 + depth * INDENT + 16} />}
    </motion.li>
  )
}

/** Where a dragged folder would land: a line between rows, starting at the folder's icon. */
function InsertionLine({ at, indent }: { at: 'before' | 'after'; indent: number }) {
  return (
    <span aria-hidden className={cn('pointer-events-none absolute right-1.5 h-0.5 rounded-full bg-accent', at === 'before' ? '-top-px' : '-bottom-px')} style={{ left: indent }}>
      <span className="absolute -top-[3px] -left-1 size-2 rounded-full border-2 border-accent bg-[var(--surface)]" />
    </span>
  )
}

/**
 * Renames in place. Enter or leaving the field keeps the name, Escape keeps the
 * old one; either way focus goes back to the row.
 */
export function RenameField({ initial, label, onDone, className }: { initial: string; label: string; onDone(name: string | null): void; className?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') finish(e.currentTarget.value)
    else if (e.key === 'Escape') finish(null)
  }
  return (
    <input
      ref={input}
      defaultValue={initial}
      aria-label={label}
      spellCheck={false}
      onKeyDown={key}
      onBlur={(e) => finish(e.currentTarget.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'no-drag -mx-1 h-6 min-w-0 flex-1 rounded-[5px] bg-[var(--field)] px-1 text-label outline-2 outline-[var(--accent-ring)] select-text',
        className
      )}
    />
  )
}

/** A section heading in the sidebar, with room for one trailing control. */
export function SidebarHeading({ children, action, dropRef, dropping }: { children: ReactNode; action?: ReactNode; dropRef?(node: HTMLElement | null): void; dropping?: boolean }) {
  return (
    <div ref={dropRef} className={cn('mt-5 flex h-7 items-center justify-between rounded-[var(--radius-row)] pr-1 pl-2.5', dropping && 'drop-inside')}>
      <span className="text-[12px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">{children}</span>
      {action}
    </div>
  )
}
