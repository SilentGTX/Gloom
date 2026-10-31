import { Archive, ArchiveRestore, CircleCheck, CircleDot, Copy, FileArchive, FolderInput, FolderOpen, FolderPlus, MailOpen, Pencil, Pin, PinOff, SquareChevronRight } from 'lucide-react'
import { ContextMenuPopup, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator, MenuSubmenu } from '../../components/ui/Menu'
import { notify } from '../../lib/toast'
import { applyWithUndo, useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { removeArchivedWorktrees } from '../chat/Worktree'
import { useFinished } from '../concept/finished'
import { MoveTargets } from '../folders/FolderMenu'
import { addFolder, exportSession, markCompleted, setUnread } from './actions'

const sessionsLabel = (n: number) => (n === 1 ? '1 session' : `${n} sessions`)

/** How long Undo is offered before an archived session's worktree goes. */
const WORKTREE_GRACE_MS = 9_000

/**
 * Archives sessions, with an Undo toast. Transcripts are never deleted; a
 * worktree session's worktree goes once Undo has passed (its branch stays).
 */
export function archiveSessions(ids: string[]): void {
  if (!ids.length) return
  void applyWithUndo({ type: 'setArchived', ids, archived: true }, `Archived ${sessionsLabel(ids.length)}`)
  setTimeout(() => {
    const still = ids.filter((id) => useLibrary.getState().library.sessions[id]?.archived)
    if (still.length) void removeArchivedWorktrees(still)
  }, WORKTREE_GRACE_MS)
}

/** Opens a session's working folder in Explorer, or says why it can't. */
export async function revealSession(id: string): Promise<void> {
  const ok = await window.gloom?.revealSession(id)
  if (ok === false) notify('Its working folder no longer exists.')
}

export async function copySessionId(id: string): Promise<void> {
  await window.gloom?.copySessionId(id)
  notify('Copied the session ID')
}

/** Opens `claude --resume` for the session in a terminal window, or says why it can't. */
export async function resumeSession(id: string): Promise<void> {
  const result = await window.gloom?.resumeSession(id)
  if (!result) return
  notify(result.ok ? 'Resumed in a terminal window' : `Can’t resume this session. ${result.reason}`)
}

/**
 * What you can do to the sessions a right-click picked: one session, or every
 * selected one. Items that don't apply are left out rather than dimmed.
 */
export function SessionMenu({ ids }: { ids: string[] }) {
  const library = useLibrary((s) => s.library)
  const sessions = useLibrary((s) => s.sessions)
  const apply = useLibrary((s) => s.apply)
  const entries = ids.map((id) => library.sessions[id])
  const pinned = entries.every((e) => e?.pinned)
  const archived = entries.every((e) => e?.archived)
  const unread = entries.every((e) => e?.unread)
  const finished = useFinished((s) => ids.some((id) => s.ids.has(id)))
  const folderIds = new Set(entries.map((e) => (e?.folderId && library.folders.some((f) => f.id === e.folderId) ? e.folderId : null)))
  const current = folderIds.size === 1 ? [...folderIds][0] : undefined
  const single = ids.length === 1 ? sessions[ids[0]] : undefined

  return (
    <ContextMenuPopup label={ids.length === 1 ? 'Session actions' : `${ids.length} sessions actions`}>
      <MenuGroup>
        {ids.length > 1 && <MenuGroupLabel>{ids.length} Sessions</MenuGroupLabel>}
        {single && <MenuItem label="Rename" icon={<Pencil />} onClick={() => useUi.getState().rename({ kind: 'session', id: single.id })} />}
        <MenuItem label={pinned ? 'Unpin' : 'Pin'} icon={pinned ? <PinOff /> : <Pin />} onClick={() => void apply({ type: 'setPinned', ids, pinned: !pinned })} />
        <MenuSubmenu label="Move To" icon={<FolderInput />}>
          <MoveTargets folders={library.folders} current={current} topLevel="Unfiled" onPick={(folderId) => void apply({ type: 'moveSessions', ids, folderId })} />
        </MenuSubmenu>
        {archived ? (
          <MenuItem label="Unarchive" icon={<ArchiveRestore />} onClick={() => void apply({ type: 'setArchived', ids, archived: false })} />
        ) : (
          <MenuItem label="Archive" icon={<Archive />} onClick={() => archiveSessions(ids)} />
        )}
        <MenuItem label={unread ? 'Mark as Read' : 'Mark as Unread'} icon={unread ? <MailOpen /> : <CircleDot />} onClick={() => setUnread(ids, !unread)} />
        {(finished || unread) && <MenuItem label="Mark as Completed" icon={<CircleCheck />} onClick={() => markCompleted(ids)} />}
        {single && (
          <>
            <MenuSeparator />
            {!single.remote && <MenuItem label="Resume in Terminal" icon={<SquareChevronRight />} onClick={() => void resumeSession(single.id)} />}
            {!single.remote && <MenuItem label="Reveal Working Folder" icon={<FolderOpen />} onClick={() => void revealSession(single.id)} />}
            {!single.remote && <MenuItem label="Add Folder to Session…" icon={<FolderPlus />} onClick={() => void addFolder(single.id)} />}
            <MenuItem label="Copy Session ID" icon={<Copy />} onClick={() => void copySessionId(single.id)} />
            {single.file && <MenuItem label="Export…" icon={<FileArchive />} onClick={() => void exportSession(single.id)} />}
          </>
        )}
      </MenuGroup>
    </ContextMenuPopup>
  )
}
