import { useEffect, useState, type ReactNode } from 'react'
import { FolderOpen, PanelRight, SquareChevronRight } from 'lucide-react'
import { totals, type DiffFile, type SessionDiff, type TreeDiff } from '@shared/diff'
import { modeInfo, modelLabel } from '@shared/live'
import type { SessionMeta } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { runCommand } from '../../lib/commands'
import { notify } from '../../lib/toast'
import { useDiff, type Loaded } from '../../stores/diff'
import { useLive } from '../../stores/live'
import { useUi } from '../../stores/ui'
import { useWorktrees } from '../chat/Worktree'
import { resumeSession, revealSession } from '../sessions/SessionMenu'
import { PaneToolbar } from '../shell/Toolbar'
import { ChangeBadge } from './parts'

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000).toLocaleString()}K` : n.toLocaleString())
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The editor a folder opens in (VS Code, when it's installed), asked once. */
let editorAsked: Promise<string | null> | null = null
function useEditorName(): string | null | undefined {
  const [name, setName] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    editorAsked ??= window.gloom?.editorName().catch(() => null) ?? Promise.resolve(null)
    let alive = true
    void editorAsked.then((n) => alive && setName(n))
    return () => {
      alive = false
    }
  }, [])
  return name
}

/**
 * The concept's inspector, on the trailing side: what the open session
 * changed, how full its context is, and its details. It follows the session
 * you choose, as an inspector does; Ctrl+I shows and hides it.
 */
export function Inspector({ session, clearCaptionButtons }: { session: SessionMeta | undefined; clearCaptionButtons: boolean }) {
  return (
    <aside aria-label="Inspector" data-pane="inspector" className="concept-inspector relative flex h-full min-w-0 flex-col pt-[var(--titlebar-h)]">
      <PaneToolbar clearCaptionButtons={clearCaptionButtons}>
        <h2 className="px-1 font-display text-[13px] font-semibold text-label">Inspector</h2>
      </PaneToolbar>
      {session ? (
        <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-3.5 pt-1 pb-4">
          <Changes session={session} />
          <Context id={session.id} />
          <Details session={session} />
        </div>
      ) : (
        <p className="px-4 pt-2 text-footnote text-label-secondary">Choose a session to see its changes, its context and its details.</p>
      )}
    </aside>
  )
}

function Section({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 flex items-baseline justify-between gap-3 text-[12px] font-semibold text-label-secondary">
        <span>{title}</span>
        {count && <span className="font-normal tabular">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

/** The files the session changed, as a list with their counts; Review Diff opens them in the Changes view. */
function Changes({ session }: { session: SessionMeta }) {
  const tab = useUi((s) => s.diffTab)
  const loaded = useDiff((s) => s[tab]) as Loaded<SessionDiff | TreeDiff>
  const current = loaded.id === session.id ? loaded : null
  const files = current?.value && 'files' in current.value ? current.value.files : null
  const editor = useEditorName()
  const review = () => useUi.getState().setView('changes')
  const openEditor = async () => {
    const opened = await window.gloom?.openInEditor(session.id).catch(() => false)
    if (opened === false) notify('Its working folder isn’t on this PC any more.')
  }

  let body: ReactNode
  if (files?.length) {
    body = (
      <ul className="concept-list">
        {files.map((file) => (
          <FileRow key={file.path} file={file} onOpen={review} />
        ))}
      </ul>
    )
  } else {
    const note = !current || current.status === 'loading' ? 'Reading the changes…' : current.status === 'error' ? current.error : files ? (tab === 'session' ? 'Claude hasn’t edited anything yet.' : 'Nothing has changed.') : treeNote(current.value as TreeDiff | null)
    body = <p className="concept-list px-3 py-2.5 text-[12.5px] text-label-secondary">{note}</p>
  }
  const { added, removed } = totals(files ?? [])
  return (
    <Section title={tab === 'session' ? 'Changes' : 'Working Tree'} count={files?.length ? plural(files.length, 'file') : undefined}>
      {body}
      {files && files.length > 1 && (
        <p className="sr-only">
          {plural(added, 'line')} added, {plural(removed, 'line')} removed
        </p>
      )}
      <div className="mt-2.5 flex gap-2">
        <Button size="text" tone="secondary" className="flex-1" disabled={!files?.length} onClick={review}>
          Review Diff
        </Button>
        {!session.remote && (
          <Button size="text" tone="secondary" className="flex-1" disabled={editor === undefined} onClick={() => void (editor ? openEditor() : revealSession(session.id))}>
            {editor ? 'Open in Editor' : 'Show in Explorer'}
          </Button>
        )}
      </div>
    </Section>
  )
}

function treeNote(tree: TreeDiff | null): string {
  switch (tree?.kind) {
    case 'not-repo':
      return 'Not a git repository.'
    case 'no-git':
      return 'Git isn’t installed.'
    case 'missing-folder':
      return 'Its working folder is gone.'
    case 'remote':
      return 'It ran on another machine.'
    case 'error':
      return tree.message
    default:
      return 'Nothing has changed.'
  }
}

function FileRow({ file, onOpen }: { file: DiffFile; onOpen(): void }) {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1)
  return (
    <li>
      <button type="button" onClick={onOpen} title={file.path} className="concept-list-row no-drag">
        <ChangeBadge status={file.status} />
        <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-label">{name}</span>
        <span className="flex shrink-0 gap-1.5 text-[12px] font-medium tabular">
          {file.added > 0 && <span className="text-[var(--added-text)]">+{file.added}</span>}
          {file.removed > 0 && <span className="text-[var(--removed-text)]">−{file.removed}</span>}
        </span>
      </button>
    </li>
  )
}

/** How full the context is: a ring, the share, and the tokens. */
function Context({ id }: { id: string }) {
  const context = useLive((s) => s.sessions[id]?.context ?? null)
  const percent = context ? Math.round(context.percent) : 0
  return (
    <Section title="Context">
      <div className="concept-ring-card">
        <span
          className="concept-ring"
          role="meter"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={context ? percent : undefined}
          style={{ '--ring': `${context ? percent : 0}%` } as React.CSSProperties}
        />
        <div className="min-w-0">
          <p className="font-display text-[16px] font-semibold text-label tabular">{context ? `${percent}%` : '—'}</p>
          <p className="text-[12px] text-label-secondary tabular">{context ? `${tokens(context.used)} of ${tokens(context.max)} tokens` : 'Measured after Claude’s next reply'}</p>
        </div>
      </div>
    </Section>
  )
}

/** The model, the permission mode, the branch and the folder; and the session's two ways out of Gloom. */
function Details({ session }: { session: SessionMeta }) {
  const summary = useLive((s) => s.sessions[session.id])
  const settings = useLive((s) => s.settings)
  const models = useLive((s) => s.models)
  const worktree = useWorktrees((s) => s.info[session.id])
  const model = summary ? (summary.activeModel ?? summary.model) : settings.model
  const mode = summary?.mode ?? settings.mode
  const branch = worktree?.branch ?? (session.gitBranch && session.gitBranch !== 'HEAD' ? session.gitBranch : null)
  const folder = summary?.cwd ?? session.cwd ?? session.project
  const facts: [string, string, boolean?][] = [
    ['Model', modelLabel(model, models)],
    ['Permissions', modeInfo(mode).label],
    ...(branch ? ([['Branch', branch, true]] as [string, string, boolean][]) : []),
    ['Folder', folder, true]
  ]
  return (
    <Section title="Session">
      <dl className="concept-facts">
        {facts.map(([term, value, mono]) => (
          <div key={term} className="contents">
            <dt>{term}</dt>
            <dd className={mono ? 'font-mono text-[12px]' : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      {!session.remote && (
        <div className="mt-3 flex gap-2">
          {session.file && (
            <Tooltip label="Carry on in a terminal window, in Claude Code itself">
              <Button size="text" tone="secondary" className="flex-1" onClick={() => void resumeSession(session.id)}>
                <SquareChevronRight size={14} strokeWidth={1.75} aria-hidden />
                Resume in Terminal
              </Button>
            </Tooltip>
          )}
          <Tooltip label="Show Working Folder">
            <Button size="text" tone="secondary" aria-label="Show working folder" onClick={() => void revealSession(session.id)}>
              <FolderOpen size={14} strokeWidth={1.75} aria-hidden />
            </Button>
          </Tooltip>
        </div>
      )}
    </Section>
  )
}

/** The toolbar's inspector button: held in while the inspector shows. */
export function InspectorButton({ shown }: { shown: boolean }) {
  return (
    <Tooltip label={shown ? 'Hide Inspector' : 'Show Inspector'} shortcut="Ctrl+I">
      <Button aria-label="Inspector" aria-pressed={shown} pressed={shown} shape="round" onClick={() => runCommand('session.info')}>
        <PanelRight size={16} strokeWidth={1.75} aria-hidden />
      </Button>
    </Tooltip>
  )
}
