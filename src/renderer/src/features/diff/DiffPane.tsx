import { forwardRef, memo, useEffect, useMemo, useState, type HTMLAttributes, type MouseEvent } from 'react'
import { GroupedVirtuoso } from 'react-virtuoso'
import { ChevronRight, Copy, FileDiff, FileMinus, FilePen, FilePlus, FileQuestion, FileWarning, FolderOpen, FoldVertical, GitBranch, GitFork, LoaderCircle, RotateCw, UnfoldVertical } from 'lucide-react'
import { totals, type DiffFile, type FileStatus, type SessionDiff, type TreeDiff } from '@shared/diff'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { GlassCapsule } from '../../components/ui/Glass'
import { ContextMenuPopup, ContextMenuRoot, ContextMenuTrigger, MenuItem, MenuSeparator } from '../../components/ui/Menu'
import { Segmented } from '../../components/ui/Segmented'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useDelayed } from '../../lib/delayed'
import { notify } from '../../lib/toast'
import { useDiff, type Loaded } from '../../stores/diff'
import { useLive } from '../../stores/live'
import { useTranscript } from '../../stores/transcript'
import { useUi, type DiffTab } from '../../stores/ui'
import { useHighlight } from '../chat/highlight'
import { resolveLanguage } from '../chat/languages'
import { PaneToolbar } from '../shell/Toolbar'

/** Lines per row of the list: a long hunk is several rows, so only what's on screen is drawn. */
const CHUNK = 48
/** After the transcript or Claude's state changes, the diff is read again once things settle. */
const SETTLE_MS = 700

const SEGMENTS = [
  { value: 'session' as const, label: 'This Session', title: 'Claude’s edits in this session' },
  { value: 'tree' as const, label: 'Working Tree', title: 'Everything git sees changed in the working folder' }
]

/**
 * The diff pane, beside the chat (over it, in a narrow window). Its toolbar
 * switches between This Session, Claude's edits composed per file, and
 * Working Tree, what git sees. Files fold under their headers, which stay put
 * at the top while their lines scroll by.
 */
export function DiffPane({ sessionId, clearCaptionButtons }: { sessionId: string | null; clearCaptionButtons: boolean }) {
  const tab = useUi((s) => s.diffTab)
  const setTab = useUi((s) => s.setDiffTab)
  useDiffRefresh(sessionId, tab)
  return (
    <aside aria-label="Diff" data-pane="diff" className="relative flex h-full min-w-0 flex-col pt-[var(--titlebar-h)]">
      <PaneToolbar clearCaptionButtons={clearCaptionButtons}>
        <Segmented label="Changes to show" value={tab} segments={SEGMENTS} onChange={(next) => setTab(next)} panel="diff-panel" />
        <div className="flex-1" />
        <GlassCapsule label="Diff">
          <Tooltip label="Refresh" shortcut="F5">
            <Button aria-label="Refresh" shape="round" disabled={!sessionId} onClick={() => sessionId && useDiff.getState().load(tab, sessionId, true)}>
              <RotateCw size={15} strokeWidth={1.75} aria-hidden />
            </Button>
          </Tooltip>
        </GlassCapsule>
      </PaneToolbar>
      <div id="diff-panel" role="tabpanel" aria-label={tab === 'session' ? 'This Session' : 'Working Tree'} className="flex min-h-0 flex-1 flex-col">
        {sessionId ? (
          <DiffContent key={`${sessionId}:${tab}`} sessionId={sessionId} tab={tab} />
        ) : (
          <EmptyState icon={<FileDiff size={40} strokeWidth={1.25} />} title="No Session Selected">
            Choose a session to see what it changed.
          </EmptyState>
        )}
      </div>
    </aside>
  )
}

/**
 * Reads the tab for the session when it shows, and again as things change: a
 * new line in the transcript (an edit landing), a turn ending, coming back to
 * Gloom (you may have changed files elsewhere).
 */
function useDiffRefresh(sessionId: string | null, tab: DiffTab): void {
  useEffect(() => {
    if (!sessionId) return
    const load = useDiff.getState().load
    load(tab, sessionId, useDiff.getState()[tab].id === sessionId)
    let timer: ReturnType<typeof setTimeout> | null = null
    const soon = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => load(tab, sessionId, true), SETTLE_MS)
    }
    const offTranscript = useTranscript.subscribe((s, before) => {
      if (s.id === sessionId && (s.results !== before.results || s.entries.length !== before.entries.length)) soon()
    })
    const offLive = useLive.subscribe((s, before) => {
      const now = s.sessions[sessionId]
      const was = before.sessions[sessionId]
      if (now && was && (now.state !== was.state || now.activity !== was.activity)) soon()
    })
    const onFocus = () => tab === 'tree' && load(tab, sessionId, true)
    window.addEventListener('focus', onFocus)
    return () => {
      if (timer) clearTimeout(timer)
      offTranscript()
      offLive()
      window.removeEventListener('focus', onFocus)
    }
  }, [sessionId, tab])
}

function DiffContent({ sessionId, tab }: { sessionId: string; tab: DiffTab }) {
  const loaded = useDiff((s) => s[tab]) as Loaded<SessionDiff | TreeDiff>
  const current = loaded.id === sessionId ? loaded : null
  const slow = useDelayed(!current?.value && current?.status !== 'error', 300)

  if (!current || (current.status === 'loading' && !current.value)) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {slow && <LoaderCircle size={20} strokeWidth={1.75} aria-label={tab === 'session' ? 'Reading this session’s edits' : 'Asking git'} className="animate-spin text-label-secondary motion-reduce:animate-none" />}
      </div>
    )
  }
  if (current.status === 'error' || !current.value) {
    return (
      <EmptyState icon={<FileWarning size={40} strokeWidth={1.25} />} title="Can’t Show the Changes">
        {current.error}
      </EmptyState>
    )
  }
  if (tab === 'session') {
    const { files } = current.value as SessionDiff
    if (!files.length) {
      return (
        <EmptyState icon={<FileDiff size={40} strokeWidth={1.25} />} title="No Edits Yet">
          Files Claude edits in this session show here. Changes made any other way are under Working Tree.
        </EmptyState>
      )
    }
    return <DiffList tab="session" files={files} />
  }
  const tree = current.value as TreeDiff
  switch (tree.kind) {
    case 'not-repo':
      return (
        <EmptyState icon={<GitFork size={40} strokeWidth={1.25} />} title="Not a Git Repository">
          This session’s working folder isn’t in a git repository, so only Claude’s own edits can be shown, under This Session.
        </EmptyState>
      )
    case 'no-git':
      return (
        <EmptyState icon={<GitFork size={40} strokeWidth={1.25} />} title="Git Isn’t Installed">
          Install Git for Windows to see what’s changed in the working folder.
        </EmptyState>
      )
    case 'missing-folder':
      return (
        <EmptyState icon={<FileWarning size={40} strokeWidth={1.25} />} title="Its Working Folder Is Gone">
          There’s no folder left to compare.
        </EmptyState>
      )
    case 'remote':
      return (
        <EmptyState icon={<FileWarning size={40} strokeWidth={1.25} />} title="It Ran on Another Machine">
          Its working folder isn’t on this PC.
        </EmptyState>
      )
    case 'error':
      return (
        <EmptyState icon={<FileWarning size={40} strokeWidth={1.25} />} title="Git Couldn’t Read the Changes">
          {tree.message}
        </EmptyState>
      )
  }
  if (!tree.files.length) {
    return (
      <EmptyState icon={<GitBranch size={40} strokeWidth={1.25} />} title="No Changes">
        {tree.since ? (
          <>
            Nothing has changed here since it left <span className="font-medium text-label">{tree.since}</span>.
          </>
        ) : tree.branch ? (
          <>
            Everything matches the last commit on <span className="font-medium text-label">{tree.branch}</span>.
          </>
        ) : (
          'Everything matches the last commit.'
        )}
      </EmptyState>
    )
  }
  return <DiffList tab="tree" files={tree.files} branch={tree.branch} since={tree.since} truncated={tree.truncated} />
}

// ─── The list ────────────────────────────────────────────────────────────────

type Item =
  | { kind: 'lines'; hunk: number; from: number; to: number; oldLine: number; newLine: number; last: boolean }
  | { kind: 'gap'; lines: number }
  | { kind: 'note'; text: string }

/** Each file's rows under its header: notes, line chunks, and the unchanged lines between hunks. */
function layoutFiles(files: DiffFile[], folded: ReadonlySet<string>, tab: DiffTab): { counts: number[]; items: Item[] } {
  const counts: number[] = []
  const items: Item[] = []
  for (const file of files) {
    const before = items.length
    if (!folded.has(`${tab}:${file.path}`)) {
      if (file.note) items.push({ kind: 'note', text: file.note })
      file.hunks.forEach((h, i) => {
        const prev = file.hunks[i - 1]
        if (prev) {
          const unchanged = h.newStart - (prev.newStart + prev.newLines)
          if (unchanged > 0) items.push({ kind: 'gap', lines: unchanged })
        }
        let oldLine = h.oldStart
        let newLine = h.newStart
        for (let from = 0; from < h.lines.length; from += CHUNK) {
          const to = Math.min(h.lines.length, from + CHUNK)
          items.push({ kind: 'lines', hunk: i, from, to, oldLine, newLine, last: to === h.lines.length && i === file.hunks.length - 1 })
          for (let k = from; k < to; k++) {
            const sign = h.lines[k][0]
            if (sign !== '+') oldLine++
            if (sign !== '-') newLine++
          }
        }
      })
    }
    counts.push(items.length - before)
  }
  return { counts, items }
}

function DiffList({ tab, files, branch, since, truncated }: { tab: DiffTab; files: DiffFile[]; branch?: string | null; since?: string; truncated?: boolean }) {
  const folded = useDiff((s) => s.folded)
  const { counts, items } = useMemo(() => layoutFiles(files, folded, tab), [files, folded, tab])
  const [menu, setMenu] = useState<number | null>(null)
  // Which file each item belongs to, for the item renderer.
  const fileOf = useMemo(() => {
    const out: number[] = []
    counts.forEach((n, f) => {
      for (let i = 0; i < n; i++) out.push(f)
    })
    return out
  }, [counts])
  const keys = files.map((f) => `${tab}:${f.path}`)
  const allFolded = keys.every((k) => folded.has(k))
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    const at = (e.target as HTMLElement).closest<HTMLElement>('[data-file]')?.dataset.file
    setMenu(at === undefined ? null : Number(at))
  }
  const menuFile = menu !== null ? files[menu] : undefined

  return (
    <ContextMenuRoot onOpenChange={(open) => !open && setMenu(null)}>
      <ContextMenuTrigger onContextMenu={onContextMenu} className="flex min-h-0 flex-1 flex-col">
        <GroupedVirtuoso<unknown, SummaryProps>
          className="scroll-edge diff-list"
          groupCounts={counts}
          increaseViewportBy={600}
          context={{ files, branch: tab === 'tree' ? branch : undefined, since, truncated }}
          components={LIST_PARTS}
          groupContent={(f) => <FileHeader file={files[f]} index={f} folded={folded.has(keys[f])} keys={keys} />}
          itemContent={(i) => <ItemView item={items[i]} file={files[fileOf[i]]} index={fileOf[i]} />}
        />
      </ContextMenuTrigger>
      <ContextMenuPopup label={menuFile ? `${menuFile.path} actions` : 'Diff actions'}>
        {menuFile && (
          <>
            <MenuItem label="Reveal in File Explorer" icon={<FolderOpen />} onClick={() => void reveal(menuFile)} disabled={menuFile.status === 'deleted'} />
            <MenuItem
              label="Copy Path"
              icon={<Copy />}
              onClick={() => void navigator.clipboard.writeText(menuFile.abs).then(() => notify('Copied the path'))}
            />
            <MenuSeparator />
          </>
        )}
        <MenuItem label={allFolded ? 'Unfold All' : 'Fold All'} icon={allFolded ? <UnfoldVertical /> : <FoldVertical />} onClick={() => useDiff.getState().setFolded(keys, !allFolded)} />
      </ContextMenuPopup>
    </ContextMenuRoot>
  )
}

async function reveal(file: DiffFile): Promise<void> {
  const ok = await window.gloom?.diff.reveal(file.abs)
  if (ok === false) notify('That file no longer exists.')
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

interface SummaryProps {
  files: DiffFile[]
  branch?: string | null
  /** A worktree's: the branch its changes are counted from. */
  since?: string
  truncated?: boolean
}

/**
 * The scroller: focusable, so arrows, Page Up/Down, Home and End move through
 * the changes, with a ring inside its edge while the keyboard is on it.
 */
const Scroller = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Scroller({ className, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      tabIndex={0}
      aria-label="Changes"
      className={cn(className, 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]')}
    />
  )
})

/** The list's own parts, defined once so Virtuoso never remounts them. */
const LIST_PARTS = {
  Scroller,
  Header: ({ context }: { context: SummaryProps }) => <Summary {...context} />,
  Footer: () => <div className="h-6" />
}

/** Above the files: how many, the lines added and removed, and the branch (a worktree's, since it left its base). */
function Summary({ files, branch, since, truncated }: SummaryProps) {
  const { added, removed } = totals(files)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1 pb-2.5 text-footnote text-label-secondary">
      {branch && (
        <span className="flex min-w-0 items-center gap-1 font-medium text-label">
          <GitBranch size={13} strokeWidth={2} aria-hidden className="shrink-0 text-label-secondary" />
          <span className="truncate">{branch}</span>
          {since && <span className="shrink-0 font-normal text-label-secondary">since {since}</span>}
        </span>
      )}
      <span>{plural(files.length, 'file')} changed</span>
      <Counts added={added} removed={removed} />
      {truncated && <span className="basis-full">Too much changed to show every line: files are listed with their counts.</span>}
    </div>
  )
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 gap-1.5 font-mono text-[0.75rem] tabular" aria-label={`${plural(added, 'line')} added, ${removed} removed`}>
      {added > 0 && <span className="text-[var(--added-text)]">+{added}</span>}
      {removed > 0 && <span className="text-[var(--removed-text)]">−{removed}</span>}
    </span>
  )
}

const STATUS: Record<FileStatus, { label: string; icon: typeof FilePen; tone: string }> = {
  modified: { label: 'Modified', icon: FilePen, tone: 'text-[var(--warning)]' },
  added: { label: 'Added', icon: FilePlus, tone: 'text-[var(--added-text)]' },
  untracked: { label: 'Untracked', icon: FileQuestion, tone: 'text-[var(--added-text)]' },
  deleted: { label: 'Deleted', icon: FileMinus, tone: 'text-[var(--removed-text)]' },
  renamed: { label: 'Renamed', icon: FilePen, tone: 'text-accent-text' }
}

/**
 * A file's header, held at the top while its lines scroll under it: a click
 * folds or unfolds it (Alt-click does every file), right-click for more. The
 * folder part of the path gives way first, so the file's name always shows.
 */
const FileHeader = memo(function FileHeader({ file, index, folded, keys }: { file: DiffFile; index: number; folded: boolean; keys: string[] }) {
  const status = STATUS[file.status]
  const Icon = status.icon
  const slash = file.path.lastIndexOf('/')
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const name = file.path.slice(slash + 1)
  const key = keys[index]
  return (
    <div className="diff-file-header" data-file={index}>
      <button
        type="button"
        aria-expanded={!folded}
        aria-label={`${file.path}, ${status.label}${file.from ? `, from ${file.from}` : ''}, ${plural(file.added, 'line')} added, ${file.removed} removed`}
        onClick={(e) => useDiff.getState().setFolded(e.altKey ? keys : [key], !folded)}
        className="no-drag flex h-8 w-full min-w-0 items-center gap-1.5 px-3 text-left outline-none select-none hover:bg-fill active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]"
      >
        <ChevronRight size={12} strokeWidth={2.25} aria-hidden className={cn('shrink-0 text-label-secondary transition-transform duration-[var(--duration-tooltip)] ease-out motion-reduce:transition-none', !folded && 'rotate-90')} />
        <Icon size={14} strokeWidth={1.75} aria-hidden className={cn('shrink-0', status.tone)} />
        <span className="flex min-w-0 flex-1 items-baseline text-[0.8125rem]" title={file.from ? `${file.from} → ${file.path}` : file.path}>
          {dir && <span className="min-w-0 truncate text-label-secondary">{dir}</span>}
          <span className="shrink-0 font-medium text-label">{name}</span>
        </span>
        <Counts added={file.added} removed={file.removed} />
      </button>
    </div>
  )
})

/** A language from a file's name: its extension, or the name itself (Dockerfile, Makefile). */
function languageOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  return resolveLanguage(ext) ? ext : resolveLanguage(name) ? name : undefined
}

function ItemView({ item, file, index }: { item: Item | undefined; file: DiffFile | undefined; index: number }) {
  if (!item || !file) return <div className="h-px" />
  if (item.kind === 'note') return <p className="px-4 py-2 text-footnote text-label-secondary" data-file={index}>{item.text}</p>
  if (item.kind === 'gap') {
    return (
      <div className="diff-gap code-text" data-file={index}>
        <span aria-hidden>⋯</span> {plural(item.lines, 'unchanged line')}
      </div>
    )
  }
  return <Lines item={item} file={file} index={index} />
}

/**
 * A chunk of a hunk's lines: line numbers (the old one for a removed line), the
 * sign, the code, highlighted. A new file is all additions, which its header
 * already says: it reads as plain code, without a screen of green.
 */
const Lines = memo(function Lines({ item, file, index }: { item: Extract<Item, { kind: 'lines' }>; file: DiffFile; index: number }) {
  const lines = file.hunks[item.hunk].lines.slice(item.from, item.to)
  const code = lines.map((l) => l.slice(1)).join('\n')
  const tokens = useHighlight(code, languageOf(file.path))
  const whole = file.status === 'added' || file.status === 'untracked'
  let oldLine = item.oldLine
  let newLine = item.newLine
  return (
    <div className={cn('code-text', item.last && 'pb-3')} data-file={index}>
      {lines.map((line, i) => {
        const sign = whole ? ' ' : line[0]
        const number = sign === '-' ? oldLine++ : newLine++
        if (sign === ' ') oldLine++
        const row = tokens?.[i]
        return (
          <div key={i} className={cn('flex pr-3', sign === '+' && 'diff-added', sign === '-' && 'diff-removed')}>
            <span className="w-11 shrink-0 pr-2 text-right text-label-secondary tabular select-none">{number}</span>
            <span aria-label={sign === '+' ? 'Added' : sign === '-' ? 'Removed' : undefined} className={cn('w-4 shrink-0 select-none', sign === '+' && 'text-[var(--added-text)]', sign === '-' && 'text-[var(--removed-text)]')}>
              {sign === '+' || sign === '-' ? sign : ''}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {row?.length
                ? row.map(([content, color, style], j) => (
                    <span key={j} style={{ color: color || undefined, fontStyle: style & 1 ? 'italic' : undefined, fontWeight: style & 2 ? 600 : undefined }}>
                      {content}
                    </span>
                  ))
                : line.slice(1) || ' '}
            </span>
          </div>
        )
      })}
    </div>
  )
})
