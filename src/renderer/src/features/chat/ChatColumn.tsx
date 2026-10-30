import { Copy, FolderOpen, MessagesSquare } from 'lucide-react'
import { displayTitle, projectName, type SessionMeta } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { fullDate } from '../../lib/time'
import { useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { folderLabel } from '../folders/FolderColumn'
import { copySessionId, revealSession } from '../sessions/SessionMenu'
import { UpdateButton } from '../update/UpdateButton'
import { BarTitle, ChatControls, LeadingControls, NewSessionButton, PaneToolbar, type LeadingControl } from '../shell/Toolbar'

const ENTRYPOINTS: Record<string, string> = {
  'claude-desktop': 'the Claude app',
  'sdk-ts': 'the Agent SDK',
  'sdk-cli': 'claude -p',
  cli: 'a terminal'
}

/**
 * Chat: content, so paper, never glass. Its toolbar floats over the top; when
 * the session list is folded away it also carries the list's controls. Until
 * the transcript viewer arrives (Phase 3) it shows the selected session's
 * details.
 */
export function ChatColumn({ leading, withNewSession }: { leading: LeadingControl[]; withNewSession: boolean }) {
  const selection = useUi((s) => s.selection)
  const session = useLibrary((s) => (selection.length === 1 ? s.sessions[selection[0]] : undefined))
  const entry = useLibrary((s) => (session ? s.library.sessions[session.id] : undefined))
  const title = session ? displayTitle(session, entry) : null

  return (
    <main className="relative flex min-w-0 flex-1 flex-col pt-[var(--titlebar-h)]">
      <PaneToolbar clearCaptionButtons>
        <LeadingControls controls={leading} />
        {withNewSession && <NewSessionButton />}
        {title && <BarTitle>{title}</BarTitle>}
        <div className="flex-1" />
        <UpdateButton />
        <ChatControls />
      </PaneToolbar>
      {session ? (
        <SessionDetails session={session} />
      ) : selection.length > 1 ? (
        <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title={`${selection.length} Sessions Selected`}>
          Drag them to a folder, or right-click for more.
        </EmptyState>
      ) : (
        <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title="No Session Selected">
          Choose a session to see it here.
        </EmptyState>
      )}
    </main>
  )
}

/** Where a session ran, when, and from what; reading it comes with Phase 3. */
function SessionDetails({ session }: { session: SessionMeta }) {
  const folders = useLibrary((s) => s.library.folders)
  const folderId = useLibrary((s) => s.library.sessions[session.id]?.folderId)
  const inFolder = folderId && folders.some((f) => f.id === folderId) ? folderLabel(folders, folderId) : 'Unfiled'
  const from = session.entrypoint ? (ENTRYPOINTS[session.entrypoint] ?? session.entrypoint) : null
  const facts: [string, string][] = [
    ['Working folder', session.cwd ?? session.project],
    ['Folder', inFolder],
    ['Started', fullDate(session.created)],
    ['Last active', fullDate(session.updated)],
    ...(from ? ([['Started from', session.remote ? `${from}, on another machine` : from]] as [string, string][]) : []),
    ...(session.gitBranch && session.gitBranch !== 'HEAD' ? ([['Branch', session.gitBranch]] as [string, string][]) : []),
    ['Session ID', session.id]
  ]
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-8 pt-[9vh] pb-10">
      <div className="w-full max-w-[520px]">
        <p className="text-[0.8125rem] font-medium text-label-secondary">{projectName(session)}</p>
        {session.lastPrompt && (
          <p className="mt-2 font-display text-[1.0625rem] leading-snug text-balance text-label select-text">“{session.lastPrompt}”</p>
        )}
        <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-[0.8125rem]">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-label-secondary">{term}</dt>
              <dd className="min-w-0 break-words text-label select-text">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          {!session.remote && (
            <Button size="text" tone="secondary" onClick={() => void revealSession(session.id)}>
              <FolderOpen size={14} strokeWidth={1.75} aria-hidden />
              Reveal Working Folder
            </Button>
          )}
          <Button size="text" tone="secondary" onClick={() => void copySessionId(session.id)}>
            <Copy size={14} strokeWidth={1.75} aria-hidden />
            Copy Session ID
          </Button>
        </div>
        <p className="mt-8 text-footnote text-label-secondary">The transcript viewer arrives in Phase 3.</p>
      </div>
    </div>
  )
}
