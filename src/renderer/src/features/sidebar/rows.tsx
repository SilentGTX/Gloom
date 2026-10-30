// The sidebar's rows: library groups and your folders, which open to show what's
// inside them, and the sessions nested in them. What opens grows into its room
// and what closes gives it back, so everything below moves with it; rows spring
// to their new places when the order changes.
import { createContext, useContext, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Archive, ChevronRight, Clock3, Folder as FolderIcon, Inbox, MessagesSquare, Pin, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ELSEWHERE_MS, type SmartFolder } from '@shared/library'
import { cn } from '../../lib/cn'
import { fullDate, relativeTime } from '../../lib/time'
import { useDrag, type DragData, type DropData } from '../library/drag'
import { SMART_LABELS, type GroupRow as GroupRowData, type SessionRow as SessionRowData } from './tree'

export const SMART_ICONS: Record<SmartFolder, LucideIcon> = {
  all: MessagesSquare,
  recent: Clock3,
  pinned: Pin,
  unfiled: Inbox,
  archived: Archive
}

/** Indent per level, in pixels: chrome keeps its shape when text grows. */
const INDENT = 14
/** A group's guide runs down the middle of its disclosure, past everything inside it. */
const guideX = (level: number) => 12 + level * INDENT

/**
 * How rows move. `instant`: after a key, nothing animates. `layout`: rows
 * spring to new places (off for lists that change as you type, and for huge trees).
 */
export const RowMotion = createContext({ instant: false, layout: true })

/**
 * What comes and goes in the tree (a row, an open group's contents) grows from
 * nothing into its room and shrinks back out of it, in the layout itself: the
 * rows and headings below, and the scroll, follow it in the same frame, so
 * nothing gets ahead of anything. It turns around from wherever it is when
 * clicked again mid-way. Reduced motion fades instead.
 * (A departure from transform-only motion: transforms let a heading or a
 * scrolled list run ahead of a closing group.)
 */
function useReveal() {
  const { instant, layout } = useContext(RowMotion)
  const reduce = useReducedMotion()
  const animate = layout && !instant
  return {
    layout: layout ? ('position' as const) : false,
    initial: !layout ? false : reduce ? { opacity: 0 } : { height: 0, overflow: 'hidden' },
    // Unclipped at rest, so focus rings and insertion lines at the edges show.
    animate: reduce ? { opacity: 1 } : { height: 'auto', transitionEnd: { overflow: 'visible' } },
    exit: !animate ? { opacity: 0, transition: { duration: 0 } } : reduce ? { opacity: 0 } : { height: 0, overflow: 'hidden' }
  }
}

/** An open group's contents: its subfolders and sessions, opening and closing as one. */
export function GroupContents({ ref, children }: { ref?: Ref<HTMLLIElement>; children: ReactNode }) {
  return (
    <motion.li ref={ref} role="none" {...useReveal()} className="relative">
      <ul role="none" className="relative flex flex-col">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </motion.li>
  )
}

/** One ref callback for several refs, kept stable so dnd kit doesn't see the node come and go on every render. */
function useRefs<T>(...refs: (Ref<T> | ((node: T | null) => void) | undefined)[]) {
  return useMemo(
    () => (node: T | null) => {
      for (const ref of refs) {
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as { current: T | null }).current = node
      }
    },
    refs
  )
}

/** The lines down the left of nested rows, one per open group they sit in. The one a drop is headed into lights up. */
function Guides({ trail, lit }: { trail: readonly string[]; lit?: string }) {
  return trail.map((group, level) => (
    <span
      key={level}
      aria-hidden
      className={cn('pointer-events-none absolute inset-y-0 w-px', group === lit ? 'bg-accent' : 'bg-separator-strong')}
      style={{ left: guideX(level) }}
    />
  ))
}

/** The group a drop is headed into, as its trail names it ('folder:<id>'). */
function useLitGroup(): string | undefined {
  return useDrag((s) => (s.target?.folderId ? `folder:${s.target.folderId}` : undefined))
}

function Count({ value }: { value: number }) {
  return value > 0 ? <span className="shrink-0 pl-1 text-[12px] font-normal text-label-secondary tabular">{value}</span> : null
}

/** One shape for the rows that hold things: a library group, a folder, Archived. */
const groupBox = 'relative flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-row)] py-1 pr-2.5 text-left text-label hover:bg-fill active:bg-fill-pressed'

/**
 * A library group or one of your folders. A click anywhere on it opens or
 * closes it (Alt-click: everything below too, as Option-click does in Finder);
 * folders also drag, take drops, and rename in place.
 */
export function GroupRow({
  row,
  tabbable,
  renaming,
  menuOpen,
  accepts,
  ref,
  onToggle,
  onRenameEnd
}: {
  row: GroupRowData
  /** The sidebar's one tab stop. */
  tabbable: boolean
  renaming: boolean
  /** Its context menu is open: ringed, as Finder rings the item it acts on. */
  menuOpen: boolean
  /** For a library group, the drop it takes: Unfiled files sessions out of folders, Pinned pins. */
  accepts?: 'unfiled' | 'pinned'
  ref?: Ref<HTMLLIElement>
  /** `all`: Alt-click, for everything below. */
  onToggle(all: boolean): void
  onRenameEnd(name: string | null): void
}) {
  const motionProps = useReveal()
  const folder = row.kind === 'folder' ? row.folder : undefined
  const label = folder ? folder.name : SMART_LABELS[(row as Extract<GroupRowData, { kind: 'smart' }>).smart]
  const Icon = folder ? FolderIcon : SMART_ICONS[(row as Extract<GroupRowData, { kind: 'smart' }>).smart]
  const dropId = folder ? `drop:folder:${folder.id}` : `drop:${row.key}`
  const dropData: DropData | undefined = folder ? { kind: 'folder', id: folder.id } : accepts ? { kind: 'smart', smart: accepts } : undefined
  const { setNodeRef: dropRef } = useDroppable({ id: dropId, data: dropData, disabled: !dropData })
  const dragData: DragData | undefined = folder ? { kind: 'folder', id: folder.id, name: folder.name } : undefined
  const { setNodeRef: dragRef, listeners } = useDraggable({ id: `drag:${row.key}`, data: dragData, disabled: !folder || renaming })
  const dragging = useDrag((s) => !!folder && s.active?.kind === 'folder' && s.active.id === folder.id)
  // Lit while a drop is headed into it, whether the pointer is on the row or on a session inside it.
  const zone = useDrag((s) => (s.target?.id === dropId ? s.target.zone : folder && s.target?.folderId === folder.id ? 'inside' : null))
  const landed = useDrag((s) => s.landed === dropId)
  const lit = useLitGroup()
  const refs = useRefs(ref, dragRef, dropRef)
  const trail = row.kind === 'folder' ? row.trail : []

  // Every click counts, however fast they come. (dnd kit swallows the click a drag ends with.)
  const click = (e: MouseEvent) => onToggle(e.altKey)

  // The item that comes and goes is the list item; the row you see is inside it,
  // so its height can open from nothing.
  return (
    <motion.li
      {...motionProps}
      ref={refs}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={row.hasChildren ? row.open : undefined}
      tabIndex={tabbable ? 0 : -1}
      data-nav={row.key}
      data-label={label}
      data-folder-id={folder?.id}
      onPointerDown={(e: PointerEvent<HTMLLIElement>) => listeners?.onPointerDown?.(e)}
      onClick={click}
      className="group/row no-drag relative outline-none select-none"
    >
      <Guides trail={trail} lit={lit} />
      <div
        className={cn(
          groupBox,
          'group-focus-visible/row:outline-2 group-focus-visible/row:-outline-offset-2 group-focus-visible/row:outline-[var(--accent-ring)]',
          zone === 'inside' && 'drop-inside',
          landed && 'drop-landed',
          menuOpen && 'outline-2 -outline-offset-2 outline-[var(--accent-ring)]',
          dragging && 'opacity-45'
        )}
        style={{ paddingLeft: 4 + row.depth * INDENT }}
      >
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center text-label-secondary">
          {row.hasChildren && (
            <ChevronRight
              size={12}
              strokeWidth={2.25}
              className={cn('disclosure transition-transform duration-[var(--duration-press)] ease-out motion-reduce:transition-none', row.open && 'rotate-90')}
            />
          )}
        </span>
        <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-text" />
        {renaming ? (
          <RenameField initial={label} label="Folder name" onDone={onRenameEnd} />
        ) : (
          <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
        )}
        {!renaming && <Count value={row.count} />}
        {(zone === 'before' || zone === 'after') && <InsertionLine at={zone} indent={4 + row.depth * INDENT + 22} />}
      </div>
    </motion.li>
  )
}

/**
 * One session, nested in its group: its title and when it was last active,
 * then what you last asked. Light sweeps across the title of a session running
 * in another app; a pin marks one you've pinned. Selected, it takes Gloom's
 * indigo.
 */
export function SessionRow({
  row,
  selected,
  selection,
  tabbable,
  ringed,
  renaming,
  now,
  ref,
  onPress,
  onClick,
  onRenameEnd
}: {
  row: SessionRowData
  selected: boolean
  /** What dragging this row carries when it's selected: the whole selection, in sidebar order. */
  selection: string[] | undefined
  tabbable: boolean
  /** Its context menu is open while it isn't selected. */
  ringed: boolean
  renaming: boolean
  now: number
  ref?: Ref<HTMLLIElement>
  /** Selection happens here, on the press. */
  onPress(e: PointerEvent): void
  onClick(e: MouseEvent): void
  onRenameEnd(title: string | null): void
}) {
  const motionProps = useReveal()
  const { item, folderId } = row
  const { id, meta, entry, title } = item
  // The drag image names the row you grabbed; a badge counts the rest.
  const data: DragData = { kind: 'sessions', ids: selection ?? [id], title }
  const { setNodeRef: dragRef, listeners } = useDraggable({ id: `drag:${row.key}`, data, disabled: renaming })
  // Inside a folder, a session takes drops for its folder: a tall open folder is one big target.
  const drop: DropData | undefined = folderId ? { kind: 'folder', id: folderId, nested: true } : undefined
  const { setNodeRef: dropRef } = useDroppable({ id: `drop:${row.key}`, data: drop, disabled: !drop })
  const dragging = useDrag((s) => s.active?.kind === 'sessions' && s.active.ids.includes(id))
  const lit = useLitGroup()
  const refs = useRefs(ref, dragRef, dropRef)
  const elsewhere = now - meta.updated < ELSEWHERE_MS
  const preview = meta.lastPrompt && meta.lastPrompt !== title ? meta.lastPrompt : meta.firstPrompt !== title ? meta.firstPrompt : null

  return (
    <motion.li
      {...motionProps}
      ref={refs}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      data-nav={row.key}
      data-label={title}
      data-session-id={id}
      onPointerDown={(e: PointerEvent<HTMLLIElement>) => {
        onPress(e)
        listeners?.onPointerDown?.(e)
      }}
      onClick={onClick}
      className="group/row no-drag relative flex flex-col outline-none select-none"
      style={{ paddingLeft: row.depth ? guideX(row.depth - 1) + 10 : 0 }}
    >
      <Guides trail={row.trail} lit={lit} />
      <div
        className={cn(
          // No transition: selection follows the arrow keys and must keep up.
          // Its spacing is a margin inside the item, so a closing row shrinks to nothing.
          'session-row relative my-px rounded-[var(--radius-row)] py-[5px] pr-2.5 pl-2.5',
          // The keyboard's ring; on the selected row the selection itself shows where you are, as on the Mac.
          !selected && 'group-focus-visible/row:outline-2 group-focus-visible/row:-outline-offset-2 group-focus-visible/row:outline-[var(--accent-ring)]',
          selected ? 'is-selected' : 'hover:bg-fill active:bg-fill-pressed',
          ringed && 'outline-2 -outline-offset-2 outline-[var(--accent-ring)]',
          dragging && 'opacity-50'
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {entry?.pinned && <Pin size={11} strokeWidth={2} className="row-secondary shrink-0 rotate-45" aria-label="Pinned" />}
          {renaming ? (
            <RenameField initial={title} label="Session name" onDone={onRenameEnd} className="text-[0.875rem] font-semibold" />
          ) : (
            <span className={cn('row-label min-w-0 flex-1 truncate text-[0.875rem] leading-snug font-semibold', elsewhere && !selected && 'live-title')}>{title}</span>
          )}
          {/* The shimmer says it to the eye ("Now" too, under reduced motion); this says it to a screen reader. */}
          {elsewhere && <span className="sr-only">Running in another app</span>}
          <time dateTime={new Date(meta.updated).toISOString()} title={fullDate(meta.updated)} className="row-secondary shrink-0 pl-1 text-[0.75rem] tabular">
            {relativeTime(meta.updated, now)}
          </time>
        </div>
        {preview && <p className="row-secondary truncate text-[0.8125rem] leading-snug">{preview}</p>}
      </div>
    </motion.li>
  )
}

/** Archived, at the foot of the sidebar: it shows the archive in place of the library, and takes sessions dropped on it. */
export function ArchiveRow({ open, tabbable, onToggle }: { open: boolean; tabbable: boolean; onToggle(): void }) {
  const dropId = 'drop:archive'
  const { setNodeRef } = useDroppable({ id: dropId, data: { kind: 'smart', smart: 'archived' } satisfies DropData })
  const zone = useDrag((s) => (s.target?.id === dropId ? s.target.zone : null))
  const landed = useDrag((s) => s.landed === dropId)
  return (
    <li
      ref={setNodeRef}
      role="treeitem"
      aria-level={1}
      aria-selected={open}
      tabIndex={tabbable ? 0 : -1}
      data-nav="archive"
      data-label="Archived"
      onClick={onToggle}
      className={cn(
        'no-drag outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]',
        groupBox,
        'pl-2.5',
        open && '[background:var(--row-selected-tint)]',
        zone && 'drop-inside',
        landed && 'drop-landed'
      )}
    >
      <Archive size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1 truncate font-medium">Archived</span>
    </li>
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

/** A section heading in the sidebar, with room for a count and one trailing control. */
export function SectionHeading({
  children,
  count,
  action,
  first,
  dropRef,
  dropping
}: {
  children: ReactNode
  count?: number
  action?: ReactNode
  /** The first heading sits closer to the search field. */
  first?: boolean
  dropRef?(node: HTMLElement | null): void
  dropping?: boolean
}) {
  return (
    <div ref={dropRef} className={cn('flex h-7 items-center justify-between gap-2 rounded-[var(--radius-row)] pr-1 pl-2.5', first ? 'mt-0.5' : 'mt-4', dropping && 'drop-inside')}>
      <h2 className="flex min-w-0 items-baseline gap-1.5 text-[12px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">
        <span className="truncate">{children}</span>
        {count !== undefined && <span className="font-normal tabular">{count}</span>}
      </h2>
      {action}
    </div>
  )
}
