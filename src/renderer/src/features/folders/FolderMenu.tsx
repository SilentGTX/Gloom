import { Folder as FolderGlyph, FolderInput, FolderPlus, FolderTree, Pencil, Trash2 } from 'lucide-react'
import { childrenOf, flattenTree, subtreeIds, type Folder } from '@shared/library'
import { ContextMenuPopup, MenuItem, MenuSeparator, MenuSubmenu } from '../../components/ui/Menu'
import { useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { deleteFolder, newFolder } from './folders'

/** A folder's context menu: the few things you'd do to it, Delete last. */
export function FolderMenu({ folder, onRules }: { folder: Folder; onRules(): void }) {
  const apply = useLibrary((s) => s.apply)
  const folders = useLibrary((s) => s.library.folders)
  return (
    <ContextMenuPopup label={`${folder.name} actions`}>
      <MenuItem label="Rename" icon={<Pencil />} onClick={() => useUi.getState().rename({ kind: 'folder', id: folder.id })} />
      <MenuItem label="New Folder Inside" icon={<FolderPlus />} onClick={() => void newFolder(folder.id)} />
      <MenuItem label="Filing Rules…" icon={<FolderTree />} onClick={onRules} />
      <MenuSeparator />
      <MenuSubmenu label="Move To" icon={<FolderInput />}>
        <MoveTargets
          folders={folders}
          exclude={subtreeIds(folders, folder.id)}
          current={folder.parentId}
          topLevel="Top Level"
          onPick={(parentId) => void apply({ type: 'moveFolder', id: folder.id, parentId, index: childrenOf(folders, parentId).length })}
        />
      </MenuSubmenu>
      <MenuSeparator />
      <MenuItem label="Delete Folder" icon={<Trash2 />} destructive onClick={() => void deleteFolder(folder)} />
    </ContextMenuPopup>
  )
}

/**
 * Destinations for Move To: a top level (Unfiled, for sessions) and every
 * folder, indented by depth, in one submenu rather than one per level.
 */
export function MoveTargets({
  folders,
  exclude,
  current,
  topLevel,
  onPick
}: {
  folders: Folder[]
  exclude?: Set<string>
  /** Where it is now: listed, but unavailable. */
  current: string | null | undefined
  topLevel: string
  onPick(folderId: string | null): void
}) {
  const rows = flattenTree(folders, { all: true }).filter((r) => !exclude?.has(r.folder.id))
  return (
    <>
      <MenuItem label={topLevel} disabled={current === null} onClick={() => onPick(null)} />
      {rows.length > 0 && <MenuSeparator />}
      {rows.map((r) => (
        <MenuItem
          key={r.folder.id}
          label={r.folder.name}
          icon={<FolderGlyph />}
          indent={r.depth}
          disabled={current === r.folder.id}
          onClick={() => onPick(r.folder.id)}
        />
      ))}
    </>
  )
}
