import { useEffect, useState } from 'react'
import { MessagesSquare, SquareChevronRight } from 'lucide-react'
import type { ResumeResult } from '@shared/ipc'
import { displayTitle, ELSEWHERE_MS, type SessionMeta } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { GlassCapsule } from '../../components/ui/Glass'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useNow } from '../../lib/now'
import { useLibrary } from '../../stores/library'
import { useTranscript } from '../../stores/transcript'
import { useUi } from '../../stores/ui'
import { resumeSession } from '../sessions/SessionMenu'
import { UpdateButton } from '../update/UpdateButton'
import { BarTitle, ChatControls, LeadingControls, NewSessionButton, PaneToolbar, type LeadingControl } from '../shell/Toolbar'
import { Transcript } from './Transcript'

/**
 * Chat: content, so paper, never glass. Its toolbar floats over the top with
 * the session's title, and Resume in Terminal until Gloom can send messages
 * itself; when the session list is folded away it carries the list's controls.
 */
export function ChatColumn({ leading, withNewSession }: { leading: LeadingControl[]; withNewSession: boolean }) {
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
        <LeadingControls controls={leading} />
        {withNewSession && <NewSessionButton />}
        {title && <BarTitle>{title}</BarTitle>}
        {live && <span className="status-dot no-drag shrink-0" role="img" aria-label="Running in another app" title="Running in another app" />}
        <div className="flex-1" />
        {session && <ResumeButton session={session} />}
        <UpdateButton />
        <ChatControls />
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
function ResumeButton({ session }: { session: SessionMeta }) {
  const [check, setCheck] = useState<ResumeResult | null>(null)
  useEffect(() => {
    let alive = true
    void window.gloom?.resumeSession(session.id, { check: true }).then((result) => alive && setCheck(result))
    return () => {
      alive = false
    }
  }, [session.id, session.cwd])
  const blocked = check?.ok === false ? check.reason : null
  return (
    <GlassCapsule>
      <Tooltip label={blocked ?? 'Continue this session in a terminal window'}>
        <Button
          size="text"
          shape="round"
          aria-label="Resume in Terminal"
          aria-disabled={!!blocked}
          className={cn('gap-1.5 text-label', blocked && 'opacity-40')}
          onClick={() => void resumeSession(session.id)}
        >
          <SquareChevronRight size={15} strokeWidth={1.75} aria-hidden />
          <span className="@max-[620px]:hidden">Resume in Terminal</span>
        </Button>
      </Tooltip>
    </GlassCapsule>
  )
}
