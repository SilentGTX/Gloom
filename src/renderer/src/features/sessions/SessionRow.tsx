import type { MouseEvent, PointerEvent } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Folder as FolderGlyph, FolderCode, Pin, Server } from 'lucide-react'
import { projectName, type Folder } from '@shared/library'
import { cn } from '../../lib/cn'
import { fullDate, relativeTime } from '../../lib/time'
import { useDrag, type DragData } from '../library/drag'
import { folderLabel } from '../folders/FolderColumn'
import { RenameField } from '../folders/FolderRows'
import type { SessionItem } from './derive'

/**
 * One session: its title and when it was last active, what you last asked,
 * and the project it ran in (plus its folder, when that isn't the one you're
 * looking at). A live dot in the gutter marks a session running in another
 * app; a pin marks one you've pinned.
 */
export function SessionRow({
  item,
  selected,
  selection,
  ringed,
  renaming,
  showFolder,
  folders,
  elsewhere,
  now,
  onPress,
  onClick,
  onRenameEnd
}: {
  item: SessionItem
  selected: boolean
  /** What dragging this row carries when it's selected: the whole selection, in list order. */
  selection: string[] | undefined
  /** Its context menu is open while it isn't selected. */
  ringed: boolean
  renaming: boolean
  showFolder: boolean
  folders: Folder[]
  /** Running in the Claude app or a terminal right now. */
  elsewhere: boolean
  now: number
  /** Selection happens here, on the press. */
  onPress(e: PointerEvent): void
  onClick(e: MouseEvent): void
  onRenameEnd(title: string | null): void
}) {
  const { id, meta, entry, title } = item
  const ids = selection ?? [id]
  // The drag image names the row you grabbed; a badge counts the rest.
  const data: DragData = { kind: 'sessions', ids, title }
  const { setNodeRef, listeners } = useDraggable({ id: `session:${id}`, data, disabled: renaming })
  const dragging = useDrag((s) => s.active?.kind === 'sessions' && s.active.ids.includes(id))
  const folderId = entry?.folderId
  const project = projectName(meta)
  const label = showFolder && folderId && folders.some((f) => f.id === folderId) ? folderLabel(folders, folderId) : null
  // A folder named after the project says nothing the project doesn't.
  const inFolder = label && label.toLowerCase() !== project.toLowerCase() ? label : null
  const preview = meta.lastPrompt && meta.lastPrompt !== title ? meta.lastPrompt : meta.firstPrompt !== title ? meta.firstPrompt : null

  return (
    <div
      ref={setNodeRef}
      onPointerDown={(e) => {
        onPress(e)
        listeners?.onPointerDown?.(e)
      }}
      id={`session-${id}`}
      role="option"
      aria-selected={selected}
      data-session-id={id}
      onClick={onClick}
      className="px-2 py-px"
    >
      <div
        className={cn(
          // No transition: selection follows the arrow keys and must keep up.
          'session-row relative flex gap-1 rounded-[10px] py-2 pr-3 pl-1',
          selected ? 'is-selected' : 'hover:bg-fill',
          ringed && 'outline-2 -outline-offset-2 outline-[var(--accent-ring)]',
          dragging && 'opacity-50'
        )}
      >
        <div className="flex w-3.5 shrink-0 justify-center pt-[0.3rem]">
          {elsewhere ? (
            // It lights up only as the session comes alive, not each time the row scrolls back into view.
            <span
              className={cn('status-dot', Date.now() - meta.updated < 4000 && 'is-fresh')}
              role="img"
              aria-label="Running in another app"
              title="Running in another app"
            />
          ) : entry?.pinned ? (
            <Pin size={11} strokeWidth={2} className="row-secondary mt-px rotate-45" aria-label="Pinned" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {renaming ? (
              <RenameField initial={title} label="Session name" onDone={onRenameEnd} className="text-[0.875rem] font-semibold" />
            ) : (
              <span className="row-label min-w-0 flex-1 truncate text-[0.875rem] font-semibold">{title}</span>
            )}
            <time dateTime={new Date(meta.updated).toISOString()} title={fullDate(meta.updated)} className="row-secondary shrink-0 text-[0.75rem] tabular">
              {relativeTime(meta.updated, now)}
            </time>
          </div>
          {preview && <p className="row-secondary truncate text-[0.8125rem]">{preview}</p>}
          <div className="row-secondary mt-0.5 flex min-w-0 items-center gap-1 text-[0.75rem]">
            {meta.remote ? <Server size={11} strokeWidth={2} className="shrink-0" aria-hidden /> : <FolderCode size={11} strokeWidth={2} className="shrink-0" aria-hidden />}
            <span className="truncate" title={meta.remote ? `${meta.cwd ?? meta.project} — ran on another machine` : (meta.cwd ?? undefined)}>
              {project}
            </span>
            {inFolder && (
              <>
                <FolderGlyph size={11} strokeWidth={2} className="ml-1.5 shrink-0" aria-hidden />
                <span className="truncate">{inFolder}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
