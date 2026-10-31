import { useEffect } from 'react'
import { FileDiff, MessagesSquare, SquarePen, SquareTerminal, TriangleAlert } from 'lucide-react'
import { formatAccelerator } from '@shared/commands'
import { displayTitle, type SessionMeta } from '@shared/library'
import type { LiveSummary } from '@shared/live'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { GlassCapsule } from '../../components/ui/Glass'
import { Tooltip } from '../../components/ui/Tooltip'
import { runCommand } from '../../lib/commands'
import { useNow } from '../../lib/now'
import { relativeTime } from '../../lib/time'
import { useLibrary } from '../../stores/library'
import { loadSnapshot, useElsewhere, useLive } from '../../stores/live'
import { useTranscript } from '../../stores/transcript'
import { useUi } from '../../stores/ui'
import { BarTitle, PaneToolbar, SidebarButton, SidebarStandIns } from '../shell/Toolbar'
import { UpdateButton } from '../update/UpdateButton'
import { Composer } from './Composer'
import { SessionInfo } from './SessionInfo'
import { Transcript } from './Transcript'

/** What the session is doing, beside its title: Gloom's own state first, then the file's. */
function status(summary: LiveSummary | undefined, updated: number, elsewhere: boolean, now: number): string {
  switch (summary?.state) {
    case 'new':
      return 'New'
    case 'starting':
      return 'Starting…'
    case 'working':
      return 'Working…'
    case 'waiting':
      return 'Waiting for you'
  }
  const last = Math.max(updated, summary?.lastActive ?? 0)
  if (elsewhere || now - last < 60_000) return 'Active now'
  const when = relativeTime(last, now)
  return /^\d/.test(when) ? `Active ${when} ago` : `Active ${when}`
}

/**
 * Chat: content, so paper, never glass. Its toolbar floats over the top: the
 * session's title and what it's doing, then one capsule with the sidebar, the
 * terminal and diff panes, and the session's info. The composer floats over
 * the foot. With the sidebar away, its menu comes along to the leading edge.
 */
export function ChatColumn({ session, sidebarShown, clearCaptionButtons }: { session: SessionMeta | undefined; sidebarShown: boolean; clearCaptionButtons: boolean }) {
  const selection = useUi((s) => s.selection)
  const entry = useLibrary((s) => (session ? s.library.sessions[session.id] : undefined))
  const summary = useLive((s) => (session ? s.sessions[session.id] : undefined))
  const now = useNow(15_000)
  const elsewhere = useElsewhere(session, now)
  const title = session ? (summary?.state === 'new' ? 'New Session' : displayTitle(session, entry)) : null
  const id = session?.id ?? null
  // A session made here has no transcript until its first message is written.
  const readable = !!session?.file

  useEffect(() => {
    useTranscript.getState().open(id, readable)
  }, [id, readable])

  useEffect(() => {
    if (!id) return
    // Whatever the stream showed before this window was looking.
    if (useLive.getState().sessions[id]) void loadSnapshot(id)
    return () => {
      // A new session you leave without writing anything goes.
      const live = useLive.getState()
      if (live.sessions[id]?.state === 'new' && !live.draft(id).text.trim()) void window.gloom?.live.discard(id)
    }
  }, [id])

  return (
    <main className="@container relative flex min-h-0 min-w-0 flex-1 flex-col pt-[var(--titlebar-h)]">
      <PaneToolbar clearCaptionButtons={clearCaptionButtons}>
        {!sidebarShown && <SidebarStandIns />}
        {session && title && (
          <BarTitle status={status(summary, session.updated, elsewhere, now)} live={summary?.state === 'working' || summary?.state === 'starting'}>
            {title}
          </BarTitle>
        )}
        <div className="flex-1" />
        <UpdateButton />
        <GlassCapsule label="Session">
          <SidebarButton shown={sidebarShown} />
          <PaneButton pane="terminal" />
          <PaneButton pane="diff" />
          <SessionInfo session={session} />
        </GlassCapsule>
      </PaneToolbar>
      {session ? (
        <>
          <Transcript sessionId={session.id} live={elsewhere} />
          <Composer key={session.id} sessionId={session.id} meta={session} />
        </>
      ) : selection.length > 1 ? (
        <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title={`${selection.length} Sessions Selected`}>
          Drag them to a folder, or right-click for more.
        </EmptyState>
      ) : (
        <Welcome />
      )}
    </main>
  )
}

/** Nothing open: what to do next, or what's missing first. */
function Welcome() {
  const claude = useLive((s) => s.claude)
  const indexed = useLibrary((s) => s.indexed)
  const none = useLibrary((s) => indexed && Object.keys(s.sessions).length === 0)
  if (claude && !claude.path) {
    return (
      <EmptyState icon={<TriangleAlert size={40} strokeWidth={1.25} />} title="Claude Code Isn’t Installed">
        <span className="flex flex-col items-center gap-3">
          <span>Gloom runs Claude Code on this PC. Install it, sign in once in a terminal, then come back.</span>
          <span className="flex gap-2">
            <Button size="text" tone="secondary" onClick={() => window.open('https://docs.claude.com/en/docs/claude-code/setup', '_blank')}>
              How to Install
            </Button>
            <Button size="text" tone="secondary" onClick={() => useLive.getState().setSettingsOpen(true)}>
              Choose claude.exe…
            </Button>
          </span>
        </span>
      </EmptyState>
    )
  }
  return (
    <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title={none ? 'No Sessions Yet' : 'No Session Selected'}>
      <span className="flex flex-col items-center gap-3">
        <span>{none ? 'Start one, and Claude gets to work in the folder you choose.' : 'Choose a session to read it here, or start a new one.'}</span>
        <Button size="text" tone="secondary" onClick={() => runCommand('session.new')}>
          <SquarePen size={14} strokeWidth={1.75} aria-hidden />
          New Session
        </Button>
      </span>
    </EmptyState>
  )
}

const PANES = {
  terminal: { name: 'Terminal', command: 'view.toggleTerminal', accelerator: 'CmdOrCtrl+`', icon: SquareTerminal },
  diff: { name: 'Diff', command: 'view.toggleDiff', accelerator: 'CmdOrCtrl+Shift+D', icon: FileDiff }
} as const

/** Shows or hides the terminal or diff pane; held in while the pane shows, as a toggle. */
function PaneButton({ pane }: { pane: keyof typeof PANES }) {
  const shown = useUi((s) => (pane === 'terminal' ? s.terminalOpen : s.diffOpen))
  const { name, command, accelerator, icon: Icon } = PANES[pane]
  return (
    <Tooltip label={`${shown ? 'Hide' : 'Show'} ${name}`} shortcut={formatAccelerator(accelerator)}>
      <Button aria-label={name} aria-pressed={shown} pressed={shown} shape="round" onClick={() => runCommand(command)}>
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </Button>
    </Tooltip>
  )
}
