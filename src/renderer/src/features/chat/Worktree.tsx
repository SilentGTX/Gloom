import { useEffect } from 'react'
import { create } from 'zustand'
import { GitBranch, GitMerge, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { MergeResult, WorktreeInfo } from '@shared/git'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { GlassCapsule } from '../../components/ui/Glass'
import { Tooltip } from '../../components/ui/Tooltip'
import { notify } from '../../lib/toast'
import { useLibrary } from '../../stores/library'
import { useLive } from '../../stores/live'

// Worktree sessions: the branch Claude works on, beside the chat's title, and
// Merge, which lands it on the branch it came from. Archiving one removes its
// worktree (the branch stays), asking first when that would lose changes.

interface WorktreeState {
  /** Each session's worktree, or null for one that works in a plain folder. */
  info: Record<string, WorktreeInfo | null>
  read(id: string): Promise<void>
  /** The Merge sheet: whose, and how it went. */
  merging: { id: string; result: MergeResult | null; working: boolean } | null
  /** The sheet asking before a worktree with uncommitted changes goes. */
  removing: { id: string; title: string; dirty: number; info: WorktreeInfo | null } | null
}

export const useWorktrees = create<WorktreeState>()((set, get) => ({
  info: {},
  merging: null,
  removing: null,
  read: async (id) => {
    const info = (await window.gloom?.git.worktree(id).catch(() => null)) ?? null
    set({ info: { ...get().info, [id]: info } })
  }
}))

/** The open session's worktree, read when it opens, when a turn ends and when you come back to Gloom. */
export function useWorktree(id: string | null): WorktreeInfo | null {
  const info = useWorktrees((s) => (id ? s.info[id] : null)) ?? null
  const state = useLive((s) => (id ? s.sessions[id]?.state : undefined))
  useEffect(() => {
    if (!id) return
    void useWorktrees.getState().read(id)
    const onFocus = () => void useWorktrees.getState().read(id)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [id, state])
  return info
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Beside the chat's title in a worktree session: its branch, and Merge. */
export function WorktreeCapsule({ id }: { id: string }) {
  const info = useWorktree(id)
  if (!info) return null
  const where = [info.base ? `from ${info.base}` : null, info.ahead ? `${plural(info.ahead, 'commit')} ahead` : 'nothing new yet', info.dirty ? `${plural(info.dirty, 'file')} not committed` : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <GlassCapsule label="Worktree" className="min-w-0 shrink">
      <Tooltip label={`Claude works on ${info.branch}, in a worktree of its own`} detail={where}>
        <span tabIndex={0} className="flex h-7 min-w-0 items-center gap-1.5 rounded-full pr-1.5 pl-2.5 text-[12px] text-label-secondary outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]">
          <GitBranch size={13} strokeWidth={1.75} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate font-medium text-label">{info.branch}</span>
        </span>
      </Tooltip>
      <Tooltip label={info.base ? `Merge into ${info.base}` : 'Merge'} detail={info.ahead ? plural(info.ahead, 'commit') : undefined}>
        <Button size="text" shape="round" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => useWorktrees.setState({ merging: { id, result: null, working: false } })}>
          <GitMerge size={13} strokeWidth={1.75} aria-hidden />
          Merge
        </Button>
      </Tooltip>
    </GlassCapsule>
  )
}

/** Merge: where the branch goes, what comes with it and what doesn't; then how it went. */
export function MergeSheet() {
  const merging = useWorktrees((s) => s.merging)
  const info = useWorktrees((s) => (merging ? s.info[merging.id] : null))
  const close = () => useWorktrees.setState({ merging: null })
  const ask = (text: string) => {
    if (!merging) return
    void useLive.getState().sendText(merging.id, text)
    close()
  }
  const merge = async () => {
    if (!merging || merging.working) return
    useWorktrees.setState({ merging: { ...merging, working: true } })
    const result = (await window.gloom?.git.merge(merging.id).catch((e: unknown) => ({ ok: false as const, reason: String((e as Error)?.message ?? e) }))) ?? null
    void useWorktrees.getState().read(merging.id)
    if (result?.ok) {
      close()
      notify(`Merged ${result.branch} into ${result.base}`)
      return
    }
    useWorktrees.setState({ merging: { ...merging, working: false, result } })
  }
  const result = merging?.result
  const failed = result && !result.ok ? result : null
  return (
    <Dialog open={!!merging} onClose={close} title={info ? `Merge ${info.branch}${info.base ? ` into ${info.base}` : ''}?` : 'Merge'} width={480}>
      {merging && !info && <p className="text-[13px] text-label-secondary">This session isn’t working in a worktree.</p>}
      {merging && info && (
        <div className="flex flex-col gap-3 text-[13px]">
          {!failed && (
            <p className="text-label">
              {info.ahead ? `This session’s ${plural(info.ahead, 'commit')} land on ${info.base ?? 'its branch'} in ${info.main}, with a merge commit.` : `${info.branch} has nothing ${info.base ?? 'its branch'} doesn’t have yet.`}
              {info.behind > 0 && ` ${info.base} has ${plural(info.behind, 'commit')} the worktree doesn’t; the merge brings both together.`}
            </p>
          )}
          {!failed && info.dirty > 0 && (
            <div role="note" className="flex gap-2.5 rounded-[12px] bg-fill p-3 text-[12.5px] leading-snug">
              <TriangleAlert size={15} strokeWidth={1.75} aria-hidden className="mt-px shrink-0 text-[var(--warning)]" />
              <span className="flex flex-col items-start gap-2">
                <span>{plural(info.dirty, 'file')} in the worktree {info.dirty === 1 ? 'isn’t' : 'aren’t'} committed, so {info.dirty === 1 ? 'it stays' : 'they stay'} behind. Claude can commit them first.</span>
                <Button size="text" tone="secondary" onClick={() => ask('Commit all your changes in this worktree, with a clear message.')}>
                  Ask Claude to Commit
                </Button>
              </span>
            </div>
          )}
          {failed && (
            <div role="alert" className="flex gap-2.5 rounded-[12px] bg-fill p-3 text-[12.5px] leading-snug">
              <TriangleAlert size={15} strokeWidth={1.75} aria-hidden className="mt-px shrink-0 text-[var(--warning)]" />
              <span className="flex min-w-0 flex-col items-start gap-2">
                <span>{failed.reason}</span>
                {failed.conflicts && (
                  <>
                    <ul className="max-h-24 w-full overflow-y-auto font-mono text-[11.5px] text-label-secondary">
                      {failed.conflicts.map((f) => (
                        <li key={f} className="truncate">
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="text"
                      tone="secondary"
                      onClick={() => ask(`Merging ${info.branch} into ${info.base} conflicts in: ${failed.conflicts!.join(', ')}. Merge ${info.base} into this branch, resolve the conflicts, and commit the result.`)}
                    >
                      Ask Claude to Resolve
                    </Button>
                  </>
                )}
              </span>
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button size="text" tone="secondary" onClick={close}>
              {failed ? 'Close' : 'Cancel'}
            </Button>
            {!failed && (
              <Button size="text" tone="primary" disabled={!info.ahead || !info.base || merging.working} onClick={() => void merge()}>
                {merging.working ? (
                  <>
                    <LoaderCircle size={14} strokeWidth={2} aria-hidden className="animate-spin motion-reduce:animate-none" />
                    Merging…
                  </>
                ) : (
                  'Merge'
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

/**
 * After archiving: worktree sessions' worktrees go (their branches stay). A
 * clean one goes at once; one with uncommitted changes asks first.
 */
export async function removeArchivedWorktrees(ids: string[]): Promise<void> {
  const api = window.gloom
  if (!api) return
  for (const id of ids) {
    const result = await api.git.removeWorktree(id, false).catch(() => null)
    if (!result || result.removed || !result.dirty) continue
    const meta = useLibrary.getState().sessions[id]
    const info = await api.git.worktree(id).catch(() => null)
    useWorktrees.setState({ removing: { id, title: meta?.title ?? 'this session', dirty: result.dirty, info } })
    return
  }
}

/** Asks before a worktree with uncommitted changes is removed with its archived session. */
export function RemoveWorktreeSheet() {
  const removing = useWorktrees((s) => s.removing)
  const close = () => useWorktrees.setState({ removing: null })
  const remove = async () => {
    if (!removing) return
    const result = await window.gloom?.git.removeWorktree(removing.id, true).catch(() => null)
    close()
    if (result?.removed) notify(`Removed the worktree${removing.info ? `; ${removing.info.branch} stays` : ''}`)
    else notify(`Couldn’t remove the worktree. ${result && !result.removed && result.reason ? result.reason : ''}`.trim())
  }
  return (
    <Dialog open={!!removing} onClose={close} title="Remove its worktree too?" width={460}>
      {removing && (
        <div className="flex flex-col gap-3 text-[13px]">
          <p className="text-label">
            “{removing.title}” is archived. Its worktree{removing.info ? ` at ${removing.info.path}` : ''} has {plural(removing.dirty, 'uncommitted change')}, which removing it would delete.
            {removing.info && ` The branch ${removing.info.branch} and its commits stay.`}
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <Button size="text" tone="secondary" onClick={close}>
              Keep Worktree
            </Button>
            <Button size="text" tone="secondary" className="text-[var(--destructive)]" onClick={() => void remove()}>
              Remove Worktree
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
