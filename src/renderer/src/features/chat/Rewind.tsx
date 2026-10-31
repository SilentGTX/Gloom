import { createContext, useEffect, useState } from 'react'
import { create } from 'zustand'
import { FileText, LoaderCircle, Pencil, TriangleAlert, Undo2, X } from 'lucide-react'
import type { CodeRewind, RewindPreview } from '@shared/live'
import type { PromptEntry, TranscriptEntry } from '@shared/transcript'
import { displayPath } from '@shared/diff'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { notify } from '../../lib/toast'
import { useLibrary } from '../../stores/library'
import { useLive } from '../../stores/live'
import { focusComposer } from './Composer'

// Rewind and edit, as Claude Code's /rewind: going back to before one of your
// messages restores the conversation (Claude forgets that message and what
// came after), the code (Claude's own Write and Edit changes, from Claude
// Code's checkpoints), or both. Edit is a rewind of the conversation that
// sends your reworded message in its place.

type Restore = 'both' | 'conversation' | 'code'

interface Target {
  sessionId: string
  messageId: string
  text: string
}

interface RewindState {
  /** The rewind sheet's message. */
  target: Target | null
  preview: RewindPreview | null
  error: string | null
  open(sessionId: string, entry: PromptEntry): void
  close(): void
}

const failure = (error: unknown) => String((error as Error)?.message ?? error).replace(/^.*?Error: /, '')

/** A message's whole text: what the page holds, or the rest read from the file. */
async function fullText(sessionId: string, entry: PromptEntry): Promise<string> {
  if (entry.command) return entry.command
  if (!entry.more) return entry.text
  const whole = await window.gloom?.transcriptBlob(sessionId, entry.more).catch(() => null)
  return typeof whole === 'string' ? whole : entry.text
}

export const useRewind = create<RewindState>()((set, get) => ({
  target: null,
  preview: null,
  error: null,
  open: (sessionId, entry) => {
    const target = { sessionId, messageId: entry.key, text: entry.command ?? entry.text }
    set({ target, preview: null, error: null })
    void fullText(sessionId, entry).then((text) => get().target === target && set({ target: { ...target, text } }))
    window.gloom?.live.rewindPreview(sessionId, entry.key).then(
      (preview) => get().target?.messageId === entry.key && set({ preview }),
      (error) => get().target?.messageId === entry.key && set({ error: failure(error) })
    )
  },
  close: () => set({ target: null, preview: null, error: null })
}))

/** Files a code rewind would put back, said plainly: "3 files, +12 −40". */
function codeSummary(code: CodeRewind): string {
  const n = code.files.length
  return `${n === 1 ? '1 file' : `${n} files`}, +${code.insertions} −${code.deletions}`
}

/** Why code can't go back, in Gloom's words rather than the CLI's. */
function codeNote(code: CodeRewind): string {
  if (!code.can) return 'Claude Code kept no checkpoint there, so the code can’t go back. It keeps them for Claude’s Write and Edit changes, from sessions with checkpoints on (Gloom turns them on from 0.8).'
  return 'Claude made no Write or Edit changes after this message.'
}

/**
 * The rewind sheet: what to restore, with what the code part would change.
 * Rewinding the conversation puts your message back in the composer, as
 * Claude Code does, and can be taken back until you send something.
 */
export function RewindSheet() {
  const { target, preview, error, close } = useRewind()
  const cwd = useLive((s) => (target ? s.sessions[target.sessionId]?.cwd : undefined)) ?? null
  const [choice, setChoice] = useState<Restore>('both')
  const [working, setWorking] = useState(false)
  const code = preview?.code
  const codeHas = !!code?.can && code.files.length > 0
  const conversation = preview?.conversation ?? false
  const allowed: Record<Restore, boolean> = { both: conversation && codeHas, conversation, code: codeHas }

  // The fullest choice that applies, once it's known what does.
  useEffect(() => {
    if (!preview) return
    setChoice(allowed.both ? 'both' : allowed.conversation ? 'conversation' : 'code')
  }, [preview])

  const go = async () => {
    if (!target || !allowed[choice] || working) return
    setWorking(true)
    const { sessionId, messageId, text } = target
    const request = { messageId, conversation: choice !== 'code', code: choice !== 'conversation' }
    try {
      await window.gloom?.live.rewind(sessionId, request)
    } catch (e) {
      setWorking(false)
      notify(`Couldn’t rewind. ${failure(e)}`)
      return
    }
    setWorking(false)
    close()
    if (!request.conversation) {
      notify(`Restored ${codeSummary(code!)} to how they were before your message`)
      return
    }
    // Your message comes back to the composer, to send again or reword.
    const live = useLive.getState()
    const before = live.draft(sessionId)
    if (!before.text.trim() && !before.images.length) live.setDraft(sessionId, { text, images: [] })
    focusComposer()
    if (request.code) {
      notify(`Rewound the conversation, and ${codeSummary(code!)}`)
      return
    }
    // The conversation alone can come back (Edit › Undo Rewind too), until you send something.
    const entry = useLibrary.getState().pushUndo('Rewind', async () => {
      const undone = await window.gloom?.live.undoRewind(sessionId)
      if (!undone) {
        notify('Too late to undo the rewind: a message has gone since.')
        return
      }
      if (useLive.getState().draft(sessionId).text === text) useLive.getState().setDraft(sessionId, before)
    })
    notify('Rewound to before your message', { id: entry.id, action: { label: 'Undo', onClick: () => void useLibrary.getState().undo(entry.id) } })
  }

  const option = (value: Restore, label: string, detail: string) => (
    <label
      className={cn(
        'flex cursor-default items-start gap-2.5 rounded-[10px] px-3 py-2 text-[13px]',
        allowed[value] ? 'hover:bg-fill' : 'opacity-45',
        choice === value && allowed[value] && 'bg-fill-strong hover:bg-fill-strong'
      )}
    >
      <input type="radio" name="restore" className="mt-[3px] accent-[var(--signal)]" checked={choice === value} disabled={!allowed[value]} onChange={() => setChoice(value)} />
      <span>
        <span className="block font-medium text-label">{label}</span>
        <span className="block text-[12px] leading-snug text-label-secondary">{detail}</span>
      </span>
    </label>
  )

  return (
    <Dialog open={!!target} onClose={close} title="Rewind to before this message?" width={500}>
      {target && (
        <div className="flex flex-col gap-3">
          <blockquote className="line-clamp-3 rounded-[12px] bg-[var(--bubble)] px-3 py-2 text-[13px] leading-snug break-words whitespace-pre-wrap text-label">{target.text}</blockquote>
          {error ? (
            <p role="alert" className="flex gap-2 text-[13px] text-label">
              <TriangleAlert size={15} strokeWidth={1.75} aria-hidden className="mt-px shrink-0 text-[var(--warning)]" />
              {error}
            </p>
          ) : !preview ? (
            <p className="flex items-center gap-2 py-3 text-[13px] text-label-secondary">
              <LoaderCircle size={15} strokeWidth={1.75} aria-hidden className="animate-spin motion-reduce:animate-none" />
              Asking Claude Code what it can restore…
            </p>
          ) : (
            <>
              <div role="radiogroup" aria-label="What to restore" className="flex flex-col gap-0.5">
                {option('both', 'Conversation and Code', 'Claude forgets this message and what came after, and files go back to how they were.')}
                {option('conversation', 'Conversation Only', 'Files stay as they are now.')}
                {option('code', 'Code Only', 'The conversation stays as it is.')}
              </div>
              {code && (
                <div className="rounded-[12px] bg-fill px-3 py-2 text-[12px] leading-snug">
                  {codeHas ? (
                    <>
                      <p className="font-medium text-label">Code: {codeSummary(code)}</p>
                      <ul className="mt-1 max-h-28 overflow-y-auto text-label-secondary">
                        {code.files.map((f) => (
                          <li key={f} className="flex min-w-0 items-center gap-1.5">
                            <FileText size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
                            <span className="truncate" title={f}>
                              {displayPath(f, cwd)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-label-secondary">Only Claude’s Write and Edit changes go back, not what commands or you changed.</p>
                    </>
                  ) : (
                    <p className="text-label-secondary">{codeNote(code)}</p>
                  )}
                </div>
              )}
              {!conversation && <p className="text-[12px] text-label-secondary">This is where the conversation starts, so only code can go back.</p>}
            </>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button size="text" tone="secondary" onClick={close}>
              Cancel
            </Button>
            <Button size="text" tone="primary" disabled={!preview || !allowed[choice] || working} onClick={() => void go()}>
              {working ? 'Rewinding…' : 'Rewind'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ─── Edit ────────────────────────────────────────────────────────────────────

/** Puts one of your messages in the composer to reword; sending it rewinds to before it and sends the new words. */
export async function startEdit(sessionId: string, entry: PromptEntry): Promise<void> {
  const live = useLive.getState()
  const text = await fullText(sessionId, entry)
  live.beginEdit(sessionId, entry.key, text)
  focusComposer()
  try {
    const preview = await window.gloom!.live.rewindPreview(sessionId, entry.key)
    useLive.getState().updateEdit(sessionId, entry.key, { preview, restoreCode: preview.code.can && preview.code.files.length > 0 })
  } catch (error) {
    useLive.getState().updateEdit(sessionId, entry.key, { error: failure(error) })
  }
}

/** Above the composer while you reword a message: what sending will do, the code choice, and a way out. */
export function EditBanner({ sessionId }: { sessionId: string }) {
  const edit = useLive((s) => s.editing[sessionId])
  if (!edit) return null
  const code = edit.preview?.code
  const codeHas = !!code?.can && code.files.length > 0
  const first = edit.preview && !edit.preview.conversation
  return (
    <div role="status" className="glass-strong flex flex-col gap-1 rounded-[14px] px-3.5 py-2 text-[13px] text-label">
      <div className="relative z-[2] flex items-center gap-2">
        <Pencil size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
        <span className="min-w-0 flex-1">
          {first ? 'That’s where the conversation starts: it can’t be edited. Start a new session instead.' : 'Editing your message. Sending it goes back to before it, and Claude answers again.'}
        </span>
        <Tooltip label="Stop Editing" shortcut="Esc">
          <Button size="small" shape="round" aria-label="Stop editing" onClick={() => useLive.getState().endEdit(sessionId, true)}>
            <X size={13} strokeWidth={2} />
          </Button>
        </Tooltip>
      </div>
      {edit.error && <p className="relative z-[2] pl-[22px] text-[12px] text-label-secondary">{edit.error}</p>}
      {codeHas && !first && (
        <label className="relative z-[2] flex items-center gap-2 pl-[22px] text-[12.5px] text-label-secondary">
          <input type="checkbox" className="accent-[var(--signal)]" checked={edit.restoreCode} onChange={(e) => useLive.getState().updateEdit(sessionId, edit.messageId, { restoreCode: e.target.checked })} />
          Also restore the code Claude changed after it ({codeSummary(code)})
        </label>
      )}
    </div>
  )
}

// ─── On your messages ────────────────────────────────────────────────────────

/** Whether your messages offer Edit and Rewind: not while Claude works, or while another app runs the session. */
export const RewindAllowed = createContext(false)

/** Hovering one of your messages (or tabbing to it): Edit, and Rewind to Here. */
export function PromptActions({ sessionId, entry }: { sessionId: string; entry: PromptEntry }) {
  return (
    <div
      className={cn(
        'glass-capsule no-drag flex h-7 shrink-0 items-center gap-0.5 px-0.5',
        'opacity-0 transition-opacity duration-[var(--duration-tooltip)] ease-out group-hover/prompt:opacity-100 focus-within:opacity-100',
        // Blurs only while it shows: one waits unseen beside every message you sent.
        '[backdrop-filter:none] group-hover/prompt:[backdrop-filter:var(--capsule-blur)] focus-within:[backdrop-filter:var(--capsule-blur)]'
      )}
    >
      <Tooltip label="Edit">
        <Button size="small" shape="round" aria-label="Edit this message" onClick={() => void startEdit(sessionId, entry)}>
          <Pencil size={13} strokeWidth={1.75} />
        </Button>
      </Tooltip>
      <Tooltip label="Rewind to Here">
        <Button size="small" shape="round" aria-label="Rewind to before this message" onClick={() => useRewind.getState().open(sessionId, entry)}>
          <Undo2 size={14} strokeWidth={1.75} />
        </Button>
      </Tooltip>
    </div>
  )
}

/** What a rewound conversation shows: up to the message rewound to, not it or what came after. */
export function cutAt(entries: TranscriptEntry[], messageId: string | null | undefined): TranscriptEntry[] {
  if (!messageId) return entries
  const at = entries.findIndex((e) => e.key === messageId)
  return at < 0 ? entries : entries.slice(0, at)
}
