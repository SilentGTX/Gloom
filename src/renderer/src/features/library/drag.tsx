// Drag and drop in the sidebar: sessions onto a folder (or onto the sessions
// nested in it, or Unfiled, Pinned, Archived), folders onto each other to
// reorder or nest. The drag image is a small glass capsule at the pointer. A
// drop that lands goes into its folder, which acknowledges it; one that can't
// flies back to its row.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimationFunction,
  type Modifier
} from '@dnd-kit/core'
import { Folder as FolderIcon, MessageSquareText } from 'lucide-react'
import { create } from 'zustand'
import { childrenOf, subtreeIds, type LibraryOp } from '@shared/library'
import { applyWithUndo, useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'

export type DragData = { kind: 'sessions'; ids: string[]; title: string } | { kind: 'folder'; id: string; name: string }

/** `nested`: a session row inside the folder, which takes sessions for it. */
export type DropData = { kind: 'folder'; id: string; nested?: boolean } | { kind: 'smart'; smart: 'unfiled' | 'pinned' | 'archived' } | { kind: 'root' }

/** Where a folder lands relative to the row under the pointer. Sessions only ever go inside. */
export type Zone = 'before' | 'inside' | 'after'

interface DragState {
  active: DragData | null
  /**
   * The droppable under the pointer and where the drop would land, when it can.
   * `folderId`: the folder that takes it, which lights up even when the
   * pointer is over one of its sessions.
   */
  target: { id: string; zone: Zone; folderId?: string } | null
  /** The droppable that just took a drop, for a moment, so it can acknowledge it. */
  landed: string | null
}

/** Rows read this to draw their drop highlight. */
export const useDrag = create<DragState>(() => ({ active: null, target: null, landed: null }))

/** Where the last drop landed, in window coordinates, for the drop animation to aim at. */
let landedAt: { x: number; y: number } | null = null

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

/**
 * The drag image's last move. Landed: it travels to the folder's icon,
 * shrinking and fading, as an item dropping in. Refused: it flies back to the
 * row it came from. Reduced motion: it only fades.
 */
function dropAnimation(reduced: boolean): DropAnimationFunction {
  return ({ dragOverlay: { node } }) => {
    const target = landedAt
    landedAt = null
    const start = node.style.transform
    const now = node.getBoundingClientRect()
    // Scale about the capsule's leading edge, which is what travels to the icon.
    node.style.transformOrigin = '0 16px'
    const keyframes = reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : target
        ? [
            { transform: start, opacity: 1 },
            { transform: `${start} translate3d(${target.x - now.left}px, ${target.y - now.top - 16}px, 0) scale(0.55)`, opacity: 0 }
          ]
        : [
            { transform: start, opacity: 1 },
            { transform: 'translate3d(0, 0, 0)', opacity: 0.4 }
          ]
    return node
      .animate(keyframes, { duration: reduced ? 120 : target ? 200 : 240, easing: EASE_OUT, fill: 'forwards' })
      .finished.then(() => undefined)
  }
}

/**
 * Drop targets are measured all through a drag, not just at its start: a folder
 * that springs open mid-drag shows new rows, and they must take drops too.
 * The targets are only the sidebar's rows, so this stays cheap.
 */
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } }

/** Hovering inside a closed folder this long opens it (spring loading). */
const SPRING_MS = 700

const sessionsLabel = (n: number) => (n === 1 ? '1 session' : `${n} sessions`)

/** Where `active` would land on `over`, or null where it can't (or where it already is). */
function landing(active: DragData, over: DropData, pointerY: number, rect: { top: number; height: number }): Zone | null {
  const { library } = useLibrary.getState()
  if (active.kind === 'sessions') {
    const entries = active.ids.map((id) => library.sessions[id])
    if (over.kind === 'root') return null
    if (over.kind === 'folder') return entries.every((e) => e?.folderId === over.id) ? null : 'inside'
    if (over.smart === 'pinned') return entries.every((e) => e?.pinned) ? null : 'inside'
    if (over.smart === 'archived') return entries.every((e) => e?.archived) ? null : 'inside'
    return entries.every((e) => !e?.folderId || !library.folders.some((f) => f.id === e.folderId)) ? null : 'inside'
  }
  if (over.kind === 'smart') return null
  if (over.kind === 'root') return 'inside'
  if (over.nested || subtreeIds(library.folders, active.id).has(over.id)) return null
  const at = (pointerY - rect.top) / rect.height
  return at < 0.28 ? 'before' : at > 0.72 ? 'after' : 'inside'
}

/** The operation a drop performs. */
function dropOp(active: DragData, over: DropData, zone: Zone): LibraryOp | null {
  const { library } = useLibrary.getState()
  const folders = library.folders
  if (active.kind === 'sessions') {
    if (over.kind === 'folder') return { type: 'moveSessions', ids: active.ids, folderId: over.id }
    if (over.kind === 'smart' && over.smart === 'unfiled') return { type: 'moveSessions', ids: active.ids, folderId: null }
    if (over.kind === 'smart' && over.smart === 'pinned') return { type: 'setPinned', ids: active.ids, pinned: true }
    if (over.kind === 'smart' && over.smart === 'archived') return { type: 'setArchived', ids: active.ids, archived: true }
    return null
  }
  if (over.kind === 'root') return { type: 'moveFolder', id: active.id, parentId: null, index: childrenOf(folders, null).length }
  if (over.kind !== 'folder') return null
  const target = folders.find((f) => f.id === over.id)
  if (!target) return null
  const kids = childrenOf(folders, target.id).filter((f) => f.id !== active.id)
  if (zone === 'inside') return { type: 'moveFolder', id: active.id, parentId: target.id, index: kids.length }
  // Just below an open folder is its first child, as in Finder: its subfolders
  // and then its sessions follow the row, so that's where the line is.
  const shows = kids.length > 0 || Object.values(library.sessions).some((e) => e.folderId === target.id && !e.archived)
  if (zone === 'after' && target.expanded && shows) return { type: 'moveFolder', id: active.id, parentId: target.id, index: 0 }
  const siblings = childrenOf(folders, target.parentId).filter((f) => f.id !== active.id)
  const index = siblings.findIndex((f) => f.id === target.id) + (zone === 'after' ? 1 : 0)
  return { type: 'moveFolder', id: active.id, parentId: target.parentId, index }
}

/** The folder row a drop goes into, for the drop animation to aim at its icon. */
function folderRowRect(id: string): DOMRect | undefined {
  return document.querySelector(`[data-folder-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
}

/** The drag image sits just below and right of the pointer, not over the row it came from. */
const nearPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!(activatorEvent instanceof PointerEvent) || !draggingNodeRect) return transform
  return {
    ...transform,
    x: transform.x + activatorEvent.clientX - draggingNodeRect.left + 14,
    y: transform.y + activatorEvent.clientY - draggingNodeRect.top + 10
  }
}

export function LibraryDnd({ children }: { children: ReactNode }) {
  // About three points before a drag begins, so clicks stay clicks.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const active = useDrag((s) => s.active)
  const spring = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const clearSpring = () => {
    if (spring.current) clearTimeout(spring.current.timer)
    spring.current = null
  }

  const onStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData
    // Dragging a row outside the selection selects it, as in Finder.
    if (data.kind === 'sessions' && data.ids.join() !== useUi.getState().selection.join()) useUi.getState().select(data.ids)
    useDrag.setState({ active: data, target: null })
  }

  // dnd kit names a new target in onDragOver, a beat after the move that reached
  // it; moves within a target come through onDragMove. Both feed the same check,
  // or a drag that stops on its first move into a folder would never land.
  const track = (e: DragMoveEvent | DragOverEvent) => {
    const data = e.active.data.current as DragData
    const over = e.over
    const drop = over?.data.current as DropData | undefined
    const pointerY = e.activatorEvent instanceof PointerEvent ? e.activatorEvent.clientY + e.delta.y : 0
    const zone = over && drop ? landing(data, drop, pointerY, over.rect) : null
    const folderId = drop?.kind === 'folder' && zone === 'inside' ? drop.id : undefined
    const target = over && zone ? { id: String(over.id), zone, folderId } : null
    const prev = useDrag.getState().target
    if (prev?.id !== target?.id || prev?.zone !== target?.zone) useDrag.setState({ target })

    // Spring loading: rest on a closed folder and it opens.
    const springId = folderId && !(drop as { nested?: boolean }).nested ? folderId : null
    if (spring.current?.id === springId) return
    clearSpring()
    const { library } = useLibrary.getState()
    const folder = springId ? library.folders.find((f) => f.id === springId) : undefined
    const shows = folder && (childrenOf(library.folders, folder.id).length > 0 || Object.values(library.sessions).some((s) => s.folderId === folder.id && !s.archived))
    if (folder && !folder.expanded && shows) {
      spring.current = {
        id: folder.id,
        timer: setTimeout(() => void useLibrary.getState().apply({ type: 'setExpanded', ids: [folder.id], expanded: true }), SPRING_MS)
      }
    }
  }

  const onEnd = (e: DragEndEvent) => {
    clearSpring()
    const data = e.active.data.current as DragData
    const target = useDrag.getState().target
    const op = e.over && target ? dropOp(data, e.over.data.current as DropData, target.zone) : null
    // Aim at the folder's icon (its row, even when dropped on one of its
    // sessions), or at the line between rows where a folder goes.
    const r = (target?.folderId && folderRowRect(target.folderId)) || e.over?.rect
    landedAt = op && r && target ? { x: r.left + 22, y: target.zone === 'before' ? r.top : target.zone === 'after' ? r.top + r.height : r.top + r.height / 2 } : null
    // The folder that took it acknowledges it, wherever over it the drop was.
    const landed = op && target?.zone === 'inside' ? (target.folderId ? `drop:folder:${target.folderId}` : target.id) : null
    useDrag.setState({ active: null, target: null, landed })
    if (landed) setTimeout(() => useDrag.getState().landed === landed && useDrag.setState({ landed: null }), 700)
    if (!op) return
    if (op.type === 'setArchived' && data.kind === 'sessions') void applyWithUndo(op, `Archived ${sessionsLabel(data.ids.length)}`)
    else void useLibrary.getState().apply(op)
  }

  const onCancel = () => {
    clearSpring()
    landedAt = null
    useDrag.setState({ active: null, target: null })
  }
  const animation = useMemo(() => dropAnimation(reduced), [reduced])

  return (
    <DndContext
      sensors={sensors}
      measuring={MEASURING}
      collisionDetection={pointerWithin}
      onDragStart={onStart}
      onDragMove={track}
      onDragOver={track}
      onDragEnd={onEnd}
      onDragCancel={onCancel}
    >
      {children}
      {/* A ghost: clicks go through it, even while it flies to where it landed. */}
      <DragOverlay modifiers={[nearPointer]} dropAnimation={animation} zIndex={60} style={{ pointerEvents: 'none' }}>
        {active && <DragImage data={active} />}
      </DragOverlay>
    </DndContext>
  )
}

/** A translucent capsule naming what's being dragged, with a count when it's several. */
function DragImage({ data }: { data: DragData }) {
  const count = data.kind === 'sessions' ? data.ids.length : 1
  const label = data.kind === 'sessions' ? data.title : data.name
  const Icon = data.kind === 'sessions' ? MessageSquareText : FolderIcon
  return (
    <div className="pointer-events-none inline-flex">
      <div className="glass-strong relative flex h-8 max-w-[240px] items-center gap-2 rounded-full pr-3.5 pl-3 text-[13px] text-label opacity-95">
        <Icon size={15} strokeWidth={1.75} className="relative z-[2] shrink-0 text-accent-text" aria-hidden />
        <span className="relative z-[2] truncate">{label}</span>
        {count > 1 && (
          <span className="absolute -top-1.5 -right-1.5 z-[3] flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-[var(--on-accent)] tabular shadow-[0_2px_6px_rgb(0_0_0/0.25)]">
            {count}
          </span>
        )}
      </div>
    </div>
  )
}
