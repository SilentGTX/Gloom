import { Popover } from '@base-ui/react/popover'
import { Copy, FolderCode, FolderOpen, Info, SquareChevronRight } from 'lucide-react'
import { displayTitle, projectName, type SessionMeta } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { useNow } from '../../lib/now'
import { fullDate } from '../../lib/time'
import { useLibrary } from '../../stores/library'
import { useElsewhere } from '../../stores/live'
import { useUi } from '../../stores/ui'
import { folderLabel } from '../folders/folders'
import { copySessionId, resumeSession, revealSession } from '../sessions/SessionMenu'

const ENTRYPOINTS: Record<string, string> = {
  'claude-desktop': 'the Claude app',
  'sdk-ts': 'the Agent SDK',
  'sdk-cli': 'claude -p',
  cli: 'a terminal'
}

/** Where a session running elsewhere is running. */
const RUNNING_IN: Record<string, string> = {
  'claude-desktop': 'the Claude app',
  cli: 'a terminal'
}

const popupClass = [
  'glass-strong w-[min(360px,calc(100vw-24px))] rounded-[var(--radius-popover)] p-4 text-label outline-none',
  'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-menu)] ease-out',
  'data-[starting-style]:scale-[0.94] data-[starting-style]:opacity-0',
  'data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms]',
  'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100'
].join(' ')

/**
 * The chat toolbar's ⓘ: the open session's details as a card that grows out of
 * the button. Ctrl+I (File › Session Info) opens it too.
 */
export function SessionInfo({ session }: { session: SessionMeta | undefined }) {
  const open = useUi((s) => s.info)
  const setInfo = useUi((s) => s.setInfo)
  return (
    <Popover.Root open={open && !!session} onOpenChange={(next) => setInfo(next)}>
      <Tooltip label="Session Info" shortcut="Ctrl+I">
        <Popover.Trigger
          render={
            <Button aria-label="Session info" shape="round" disabled={!session}>
              <Info size={16} strokeWidth={1.75} />
            </Button>
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={8} className="z-50 outline-none">
          <Popover.Popup aria-label="Session Info" className={popupClass}>
            {session && <InfoCard session={session} onDone={() => setInfo(false)} />}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Where a session ran, when, from what, and its ID, with what you'd do with them (Resume in Terminal moved here from the toolbar, whose terminal button is the pane's now). */
function InfoCard({ session, onDone }: { session: SessionMeta; onDone(): void }) {
  const folders = useLibrary((s) => s.library.folders)
  const entry = useLibrary((s) => s.library.sessions[session.id])
  const folderId = entry?.folderId
  const title = displayTitle(session, entry)
  const now = useNow(15_000)
  const live = useElsewhere(session, now)
  const inFolder = folderId && folders.some((f) => f.id === folderId) ? folderLabel(folders, folderId) : 'Unfiled'
  const from = session.entrypoint ? (ENTRYPOINTS[session.entrypoint] ?? session.entrypoint) : null
  const facts: [string, string, string?][] = [
    ['Working folder', session.cwd ?? session.project],
    ['Folder', inFolder],
    ['Started', fullDate(session.created)],
    ['Last active', fullDate(session.updated)],
    ...(from ? ([['Started from', session.remote ? `${from}, on another machine` : from]] as [string, string][]) : []),
    ...(session.gitBranch && session.gitBranch !== 'HEAD' ? ([['Branch', session.gitBranch]] as [string, string][]) : []),
    ['Session ID', session.id, 'font-mono text-[11.5px]']
  ]
  return (
    <div className="relative z-[2]">
      <p className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-label-secondary">
        <FolderCode size={13} strokeWidth={2} aria-hidden className="shrink-0" />
        <span className="truncate">{projectName(session)}</span>
        {live && (
          <>
            <span aria-hidden>·</span>
            <span className="status-dot shrink-0" aria-hidden />
            <span className="shrink-0">Running in {RUNNING_IN[session.entrypoint ?? ''] ?? 'another app'}</span>
          </>
        )}
      </p>
      {/* Its name in full, as Get Info starts with one: the toolbar cuts a long title short. */}
      <h2 className="mt-1.5 font-display text-[0.9375rem] leading-snug font-semibold text-balance break-words text-label select-text">{title}</h2>
      {session.lastPrompt && session.lastPrompt !== title && (
        <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug break-words text-label-secondary select-text">“{session.lastPrompt}”</p>
      )}
      <dl className="code-card mt-3 divide-y divide-separator text-[12.5px]">
        {facts.map(([term, value, valueClass]) => (
          <div key={term} className="flex items-baseline justify-between gap-4 px-3 py-[7px]">
            <dt className="shrink-0 text-label-secondary">{term}</dt>
            <dd className={`min-w-0 text-right break-words text-label select-text ${valueClass ?? ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {!session.remote && session.file && (
          <Button
            size="text"
            tone="secondary"
            onClick={() => {
              void resumeSession(session.id)
              onDone()
            }}
          >
            <SquareChevronRight size={14} strokeWidth={1.75} aria-hidden />
            Resume in Terminal
          </Button>
        )}
        {!session.remote && (
          <Button
            size="text"
            tone="secondary"
            onClick={() => {
              void revealSession(session.id)
              onDone()
            }}
          >
            <FolderOpen size={14} strokeWidth={1.75} aria-hidden />
            Reveal Working Folder
          </Button>
        )}
        <Button
          size="text"
          tone="secondary"
          onClick={() => {
            void copySessionId(session.id)
            onDone()
          }}
        >
          <Copy size={14} strokeWidth={1.75} aria-hidden />
          Copy Session ID
        </Button>
      </div>
    </div>
  )
}
