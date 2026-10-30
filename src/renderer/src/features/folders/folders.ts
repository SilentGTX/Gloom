// What you do to folders from anywhere in the window: make one, delete one, name where a session lives.
import { folderPath, subtreeIds, type Folder } from '@shared/library'
import { applyWithUndo, useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'

/** Creates a folder and starts naming it. */
export async function newFolder(parentId: string | null): Promise<void> {
  const result = await useLibrary.getState().apply({ type: 'createFolder', parentId })
  if (result?.folderId) useUi.getState().rename({ kind: 'folder', id: result.folderId })
}

/** Deletes a folder and everything below it; its sessions go to Unfiled. A toast offers Undo. */
export async function deleteFolder(folder: Folder): Promise<void> {
  const { library } = useLibrary.getState()
  const ids = subtreeIds(library.folders, folder.id)
  const sessions = Object.values(library.sessions).filter((e) => e.folderId && ids.has(e.folderId)).length
  const moved = sessions === 1 ? ' · 1 session moved to Unfiled' : sessions ? ` · ${sessions} sessions moved to Unfiled` : ''
  await applyWithUndo({ type: 'deleteFolder', id: folder.id }, `Deleted “${folder.name}”${moved}`)
}

/** "Work › Clients", for showing where a session lives. */
export function folderLabel(folders: Folder[], id: string): string {
  return folderPath(folders, id)
    .map((f) => f.name)
    .join(' › ')
}
