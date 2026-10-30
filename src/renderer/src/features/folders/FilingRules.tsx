import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Folder as FolderGlyph, FolderOpen, X } from 'lucide-react'
import { normalizePath } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { useLibrary } from '../../stores/library'

/** Your projects: the working folders sessions ran in on this PC, most recent first. */
function useProjects(): string[] {
  const sessions = useLibrary((s) => s.sessions)
  return useMemo(() => {
    const latest = new Map<string, { path: string; updated: number }>()
    for (const s of Object.values(sessions)) {
      if (!s.cwd || s.remote) continue
      const key = normalizePath(s.cwd)
      const seen = latest.get(key)
      if (!seen || s.updated > seen.updated) latest.set(key, { path: s.cwd, updated: s.updated })
    }
    return [...latest.values()].sort((a, b) => b.updated - a.updated).map((p) => p.path)
  }, [sessions])
}

/**
 * A folder's filing rules: working folders it claims. New sessions under one
 * file into it (the deepest claim wins), and adding a path also files the
 * Unfiled sessions it covers. Sessions you've placed yourself never move.
 */
export function FilingRules({ folderId, onClose }: { folderId: string | null; onClose(): void }) {
  const folder = useLibrary((s) => (folderId ? s.library.folders.find((f) => f.id === folderId) : undefined))
  const apply = useLibrary((s) => s.apply)
  const projects = useProjects()
  const [paths, setPaths] = useState<string[]>([])
  // Start from the folder's rules each time the dialog opens.
  useEffect(() => setPaths(folder?.fileFrom ?? []), [folderId])

  const add = (path: string | null) => {
    if (path && !paths.some((p) => normalizePath(p) === normalizePath(path))) setPaths([...paths, path])
  }
  const unused = projects.filter((p) => !paths.some((q) => normalizePath(q) === normalizePath(p))).slice(0, 24)
  const save = async () => {
    if (folder) await apply({ type: 'setFilingRules', id: folder.id, paths })
    onClose()
  }

  return (
    <Dialog
      open={!!folder}
      onClose={onClose}
      title={`Filing Rules for “${folder?.name ?? ''}”`}
      description={<>New sessions whose working folder is inside one of these go here. Adding one also files the Unfiled sessions it covers.</>}
    >
      {paths.length === 0 ? (
        <p className="rounded-[10px] bg-fill px-3 py-3 text-footnote text-label-secondary">No working folders yet.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Working folders">
          {paths.map((path) => (
            <li key={path} className="flex h-9 items-center gap-2.5 rounded-[10px] bg-fill pr-1 pl-3">
              <FolderGlyph size={15} strokeWidth={1.75} className="shrink-0 text-accent-text" aria-hidden />
              {/* Long paths lose their start, not the folder's own name. */}
              <span className="min-w-0 flex-1 truncate text-[13px] [direction:rtl] text-left" title={path}>
                <bdi>{path}</bdi>
              </span>
              <Button aria-label={`Remove ${path}`} size="small" shape="round" onClick={() => setPaths(paths.filter((p) => p !== path))}>
                <X size={13} strokeWidth={2} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <MenuRoot>
          <MenuTrigger
            disabled={unused.length === 0}
            render={
              <Button size="text" tone="secondary">
                Add a Project
                <ChevronDown size={13} strokeWidth={2} aria-hidden />
              </Button>
            }
          />
          <MenuPopup>
            {unused.map((p) => (
              <MenuItem key={p} label={p} icon={<FolderGlyph />} onClick={() => add(p)} />
            ))}
          </MenuPopup>
        </MenuRoot>
        <Button size="text" tone="secondary" onClick={() => void window.gloom?.pickFolder().then(add)}>
          <FolderOpen size={14} strokeWidth={1.75} aria-hidden />
          Choose Folder…
        </Button>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button size="text" tone="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button size="text" tone="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Dialog>
  )
}
