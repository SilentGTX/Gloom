import { Archive, ArchiveRestore, Copy, FolderInput, FolderOpen, Pencil, Pin, PinOff, SquareChevronRight } from 'lucide-react'
import { ContextMenuPopup, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator, MenuSubmenu } from '../../components/ui/Menu'
import { notify } from '../../lib/toast'
import { applyWithUndo, useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { MoveTargets } from '../folders/FolderMenu'

const sessionsLabel = (n: number) => (n === 1 ? '1 session' : `${n} sessions`)

/** Archives sessions, with an Undo toast. Nothing is ever deleted. */
export function archiveSessions(ids: string[]): void {
  if (ids.length) void applyWithUndo({ type: 'setArchived', ids, archived: true }, `Archived ${sessionsLabel(ids.length)}`)
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
        {single && (
          <>
            <MenuSeparator />
            {!single.remote && <MenuItem label="Resume in Terminal" icon={<SquareChevronRight />} onClick={() => void resumeSession(single.id)} />}
            {!single.remote && <MenuItem label="Reveal Working Folder" icon={<FolderOpen />} onClick={() => void revealSession(single.id)} />}
            <MenuItem label="Copy Session ID" icon={<Copy />} onClick={() => void copySessionId(single.id)} />
          </>
        )}
      </MenuGroup>
    </ContextMenuPopup>
  )
}
