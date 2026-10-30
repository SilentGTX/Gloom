import { useEffect, useState } from 'react'
import { MessagesSquare, Terminal } from 'lucide-react'
import type { ResumeResult } from '@shared/ipc'
import { displayTitle, ELSEWHERE_MS, type SessionMeta } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { GlassCapsule } from '../../components/ui/Glass'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useNow } from '../../lib/now'
import { relativeTime } from '../../lib/time'
import { useLibrary } from '../../stores/library'
import { useTranscript } from '../../stores/transcript'
import { useUi } from '../../stores/ui'
import { resumeSession } from '../sessions/SessionMenu'
import { BarTitle, PaneToolbar, SidebarButton, SidebarStandIns } from '../shell/Toolbar'
import { UpdateButton } from '../update/UpdateButton'
import { SessionInfo } from './SessionInfo'
import { Transcript } from './Transcript'

/** "Active now" while it runs in another app, else when it last did ("Active 33m ago", "Active Oct 21"). */
function activity(updated: number, now: number): string {
  if (now - updated < ELSEWHERE_MS) return 'Active now'
  const when = relativeTime(updated, now)
  return /^\d/.test(when) ? `Active ${when} ago` : `Active ${when}`
}

/**
 * Chat: content, so paper, never glass. Its toolbar floats over the top: the
 * session's title and what it's doing, then one capsule with the sidebar,
 * Resume in Terminal and the session's info. With the sidebar away, its menu
 * comes along to the leading edge.
 */
export function ChatColumn({ sidebarShown }: { sidebarShown: boolean }) {
  const selection = useUi((s) => s.selection)
  const session = useLibrary((s) => (selection.length === 1 ? s.sessions[selection[0]] : undefined))
  const entry = useLibrary((s) => (session ? s.library.sessions[session.id] : undefined))
  const title = session ? displayTitle(session, entry) : null
  const now = useNow(15_000)
  // Growing right now in the Claude app or a terminal: its last turn may still be going.
  const live = !!session && now - session.updated < ELSEWHERE_MS
  const id = session?.id ?? null

  useEffect(() => {
    useTranscript.getState().open(id)
  }, [id])

  return (
    <main className="@container relative flex min-w-0 flex-1 flex-col pt-[var(--titlebar-h)]">
      <PaneToolbar clearCaptionButtons>
        {!sidebarShown && <SidebarStandIns />}
        {session && title && <BarTitle status={activity(session.updated, now)}>{title}</BarTitle>}
        <div className="flex-1" />
        <UpdateButton />
        <GlassCapsule label="Session">
          <SidebarButton shown={sidebarShown} />
          <ResumeButton session={session} />
          <SessionInfo session={session} />
        </GlassCapsule>
      </PaneToolbar>
      {session ? (
        <Transcript sessionId={session.id} live={live} />
      ) : selection.length > 1 ? (
        <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title={`${selection.length} Sessions Selected`}>
          Drag them to a folder, or right-click for more.
        </EmptyState>
      ) : (
        <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title="No Session Selected">
          Choose a session to read it here.
        </EmptyState>
      )}
    </main>
  )
}

/**
 * Opens the session in a terminal window with `claude --resume`. When it can't
 * (its folder is gone, it ran on another machine), it stays visible and says why.
 */
function ResumeButton({ session }: { session: SessionMeta | undefined }) {
  const [check, setCheck] = useState<ResumeResult | null>(null)
  const id = session?.id
  const cwd = session?.cwd
  useEffect(() => {
    setCheck(null)
    if (!id) return
    let alive = true
    void window.gloom?.resumeSession(id, { check: true }).then((result) => alive && setCheck(result))
    return () => {
      alive = false
    }
  }, [id, cwd])
  const blocked = check?.ok === false ? check.reason : null
  return (
    <Tooltip label={blocked ?? 'Resume in Terminal'}>
      <Button
        shape="round"
        aria-label="Resume in Terminal"
        disabled={!id}
        aria-disabled={!!blocked}
        className={cn(blocked && 'opacity-40')}
        onClick={() => id && void resumeSession(id)}
      >
        <Terminal size={16} strokeWidth={1.75} aria-hidden />
      </Button>
    </Tooltip>
  )
}
