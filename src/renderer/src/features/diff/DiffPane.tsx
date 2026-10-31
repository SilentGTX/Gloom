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
import { Track } from '../concept/parts'
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
 * The concept's Changes view: what the session changed as one card per file,
 * under a header that counts them, with This Session and Working Tree on a
 * small track. The first file opens; a click opens or closes the others. (The
 * shell reads the changes while this view or the inspector shows.)
 */
export function ChangesView({ sessionId }: { sessionId: string }) {
  const tab = useUi((s) => s.diffTab)
  const setTab = useUi((s) => s.setDiffTab)
  const loaded = useDiff((s) => s[tab]) as Loaded<SessionDiff | TreeDiff>
  const value = loaded.id === sessionId ? loaded.value : null
  const files = value && 'files' in value ? value.files : null
  const { added, removed } = totals(files ?? [])
  return (
    <section aria-label="Changes" data-pane="diff" className="concept-changes absolute inset-0 flex flex-col bg-[var(--surface)]">
      <header className="mx-auto flex w-full max-w-[860px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-8 pt-1.5 pb-2">
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-label">
          {files ? (files.length ? `${files.length} ${files.length === 1 ? 'File' : 'Files'} Changed` : 'No Changes') : 'Changes'}
        </h2>
        {files && files.length > 0 && <Counts added={added} removed={removed} />}
        <div className="flex-1" />
        <Track small label="Changes to show" value={tab} segments={SEGMENTS} onChange={(next) => setTab(next)} panel="changes-panel" />
        <Tooltip label="Refresh" shortcut="F5">
          <Button aria-label="Refresh" shape="round" size="small" onClick={() => useDiff.getState().load(tab, sessionId, true)}>
            <RotateCw size={14} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
      </header>
      <div id="changes-panel" role="tabpanel" aria-label={tab === 'session' ? 'This Session' : 'Working Tree'} className="flex min-h-0 flex-1 flex-col">
        <DiffContent key={`${sessionId}:${tab}`} sessionId={sessionId} tab={tab} cards />
      </div>
    </section>
  )
}

/**
 * Reads the tab for the session when it shows, and again as things change: a
 * new line in the transcript (an edit landing), a turn ending, coming back to
 * Gloom (you may have changed files elsewhere).
 */
export function useDiffRefresh(sessionId: string | null, tab: DiffTab): void {
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

function DiffContent({ sessionId, tab, cards = false }: { sessionId: string; tab: DiffTab; cards?: boolean }) {
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
    return <DiffList tab="session" files={files} cards={cards} />
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
  return <DiffList tab="tree" files={tree.files} branch={tree.branch} since={tree.since} truncated={tree.truncated} cards={cards} />
}

// ─── The list ────────────────────────────────────────────────────────────────

type Item =
  | { kind: 'lines'; hunk: number; from: number; to: number; oldLine: number; newLine: number; last: boolean }
  | { kind: 'gap'; lines: number }
  | { kind: 'note'; text: string }

/** Each file's rows under its header: notes, line chunks, and the unchanged lines between hunks. */
function layoutFiles(files: DiffFile[], closed: readonly boolean[]): { counts: number[]; items: Item[] } {
  const counts: number[] = []
  const items: Item[] = []
  for (const [f, file] of files.entries()) {
    const before = items.length
    if (!closed[f]) {
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

function DiffList({ tab, files, branch, since, truncated, cards = false }: { tab: DiffTab; files: DiffFile[]; branch?: string | null; since?: string; truncated?: boolean; cards?: boolean }) {
  const folded = useDiff((s) => s.folded)
  // The pane opens every file; the concept's cards open the first and keep the rest closed, so
  // there a key in `folded` marks a file turned from how it starts.
  const keys = useMemo(() => files.map((f) => (cards ? `${tab}:cards:${f.path}` : `${tab}:${f.path}`)), [files, tab, cards])
  const closed = useMemo(() => keys.map((k, i) => (cards && i > 0 ? !folded.has(k) : folded.has(k))), [keys, folded, cards])
  const { counts, items } = useMemo(() => layoutFiles(files, closed), [files, closed])
  const [menu, setMenu] = useState<number | null>(null)
  // Which file each item belongs to, and the last item of each, for the item renderer.
  const { fileOf, lastOf } = useMemo(() => {
    const fileOf: number[] = []
    const lastOf: boolean[] = []
    counts.forEach((n, f) => {
      for (let i = 0; i < n; i++) {
        fileOf.push(f)
        lastOf.push(i === n - 1)
      }
    })
    return { fileOf, lastOf }
  }, [counts])
  const allFolded = closed.every(Boolean)
  /** Opens or closes these files, whichever way each one starts. */
  const setOpen = (indexes: number[], open: boolean) => {
    const marked = (i: number) => (cards && i > 0 ? open : !open)
    useDiff.getState().setFolded(indexes.filter(marked).map((i) => keys[i]), true)
    useDiff.getState().setFolded(indexes.filter((i) => !marked(i)).map((i) => keys[i]), false)
  }
  const every = files.map((_, i) => i)
  // Alt-click does every file, as in the pane.
  const toggle = (f: number, all: boolean) => setOpen(all ? every : [f], closed[f])
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    const at = (e.target as HTMLElement).closest<HTMLElement>('[data-file]')?.dataset.file
    setMenu(at === undefined ? null : Number(at))
  }
  const menuFile = menu !== null ? files[menu] : undefined

  return (
    <ContextMenuRoot onOpenChange={(open) => !open && setMenu(null)}>
      <ContextMenuTrigger onContextMenu={onContextMenu} className="flex min-h-0 flex-1 flex-col">
        <GroupedVirtuoso<unknown, SummaryProps>
          className={cn('scroll-edge diff-list', cards && 'concept-file-list')}
          groupCounts={counts}
          increaseViewportBy={600}
          context={{ files, branch: tab === 'tree' ? branch : undefined, since, truncated }}
          components={cards ? CARD_PARTS : LIST_PARTS}
          groupContent={(f) =>
            cards ? (
              <FileCardHeader file={files[f]} index={f} open={!closed[f]} onToggle={(all) => toggle(f, all)} />
            ) : (
              <FileHeader file={files[f]} index={f} folded={closed[f]} onToggle={(all) => toggle(f, all)} />
            )
          }
          itemContent={(i) =>
            cards ? (
              <div className="concept-file-row">
                <div className={cn('concept-file-body', lastOf[i] && 'is-last')}>
                  <ItemView item={items[i]} file={files[fileOf[i]]} index={fileOf[i]} />
                </div>
              </div>
            ) : (
              <ItemView item={items[i]} file={files[fileOf[i]]} index={fileOf[i]} />
            )
          }
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
        <MenuItem label={allFolded ? 'Unfold All' : 'Fold All'} icon={allFolded ? <UnfoldVertical /> : <FoldVertical />} onClick={() => setOpen(every, allFolded)} />
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

/** A file's change as the diff pane draws it: its symbol in the change's colour, and the change said aloud. */
export function FileStatusIcon({ status }: { status: FileStatus }) {
  const { label, icon: Icon, tone } = STATUS[status]
  return <Icon size={14} strokeWidth={1.75} role="img" aria-label={label} className={cn('shrink-0', tone)} />
}

/**
 * A file's header, held at the top while its lines scroll under it: a click
 * folds or unfolds it (Alt-click does every file), right-click for more. The
 * folder part of the path gives way first, so the file's name always shows.
 */
const FileHeader = memo(function FileHeader({ file, index, folded, onToggle }: { file: DiffFile; index: number; folded: boolean; onToggle(all: boolean): void }) {
  const status = STATUS[file.status]
  const Icon = status.icon
  const slash = file.path.lastIndexOf('/')
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const name = file.path.slice(slash + 1)
  return (
    <div className="diff-file-header" data-file={index}>
      <button
        type="button"
        aria-expanded={!folded}
        aria-label={`${file.path}, ${status.label}${file.from ? `, from ${file.from}` : ''}, ${plural(file.added, 'line')} added, ${file.removed} removed`}
        onClick={(e) => onToggle(e.altKey)}
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

/**
 * A file's card header in the concept's Changes view: its badge, its path
 * (the folder part gives way first), and the lines added and removed. A click
 * opens or closes the card; Alt-click does every file.
 */
function FileCardHeader({ file, index, open, onToggle }: { file: DiffFile; index: number; open: boolean; onToggle(all: boolean): void }) {
  const slash = file.path.lastIndexOf('/')
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const name = file.path.slice(slash + 1)
  return (
    <div className={cn('concept-file-row', index > 0 && 'is-spaced')} data-file={index}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${file.path}, ${STATUS[file.status].label}${file.from ? `, from ${file.from}` : ''}, ${plural(file.added, 'line')} added, ${file.removed} removed`}
        onClick={(e) => onToggle(e.altKey)}
        className={cn('concept-file-head no-drag', open && 'is-open')}
      >
        <ChevronRight size={12} strokeWidth={2.25} aria-hidden className="concept-chevron" />
        <FileStatusIcon status={file.status} />
        <span className="flex min-w-0 flex-1 items-baseline font-mono text-[12.5px]" title={file.from ? `${file.from} → ${file.path}` : file.path}>
          {dir && <span className="min-w-0 truncate text-label-secondary">{dir}</span>}
          <span className="shrink-0 text-label">{name}</span>
        </span>
        <Counts added={file.added} removed={file.removed} />
      </button>
    </div>
  )
}

/** The cards' own parts: the branch above the files (Working Tree), room under the last. */
const CARD_PARTS = {
  Scroller,
  Header: ({ context }: { context: SummaryProps }) =>
    context.branch || context.truncated ? (
      <div className="concept-file-row pb-2 text-footnote text-label-secondary">
        {context.branch && (
          <span className="flex min-w-0 items-center gap-1">
            <GitBranch size={13} strokeWidth={2} aria-hidden className="shrink-0" />
            <span className="truncate font-medium text-label">{context.branch}</span>
            {context.since && <span className="shrink-0">since {context.since}</span>}
          </span>
        )}
        {context.truncated && <p>Too much changed to show every line: files are listed with their counts.</p>}
      </div>
    ) : null,
  Footer: () => <div className="h-10" />
}

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
