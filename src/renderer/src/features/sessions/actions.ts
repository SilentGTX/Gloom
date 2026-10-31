// What you can do to a session beyond its folder and pin, from its menu, the
// File menu, the command palette and the inspector alike: export it, give it
// another folder, mark it unread or completed, switch fast mode and how its
// conversation shows. Each says what happened, or why it couldn't.
import { TRANSCRIPT_VIEWS, type TranscriptView } from '@shared/live'
import { notify } from '../../lib/toast'
import { useLibrary } from '../../stores/library'
import { useLive } from '../../stores/live'
import { useUi } from '../../stores/ui'
import { useFinished } from '../concept/finished'

function failure(error: unknown): string {
  return String((error as Error)?.message ?? error).replace(/^.*?Error: /, '')
}

const megabytes = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`)

/** A zip of the session's transcripts in Downloads, as the Claude app's Export; the toast shows it in File Explorer. */
export async function exportSession(id: string): Promise<void> {
  const api = window.gloom
  if (!api) return
  try {
    const { path, size } = await api.exportSession(id)
    const name = path.split(/[\\/]/).pop() ?? path
    notify(`Exported ${name} to Downloads (${megabytes(size)})`, { action: { label: 'Show in Folder', onClick: () => void api.diff.reveal(path) } })
  } catch (error) {
    notify(`Couldn’t export it. ${failure(error)}`)
  }
}

/** The folders besides its working folder a session may use: its running process's, else the library's. */
export function sessionFolders(id: string): string[] {
  return useLive.getState().sessions[id]?.folders ?? useLibrary.getState().library.sessions[id]?.folders ?? []
}

/** Gives the session another folder to use (picked in the system's folder picker). */
export async function addFolder(id: string): Promise<void> {
  const api = window.gloom
  const folder = await api?.pickFolder()
  if (!api || !folder) return
  const folders = sessionFolders(id)
  if (folders.some((f) => f.toLowerCase() === folder.toLowerCase())) return notify('It can use that folder already.')
  await setFolders(id, [...folders, folder])
  notify(`Claude can use ${folder.split(/[\\/]/).filter(Boolean).pop() ?? folder} too`)
}

export async function removeFolder(id: string, folder: string): Promise<void> {
  await setFolders(id, sessionFolders(id).filter((f) => f !== folder))
}

async function setFolders(id: string, folders: string[]): Promise<void> {
  try {
    await window.gloom?.live.set(id, { folders })
  } catch (error) {
    notify(failure(error))
  }
}

export function isUnread(id: string): boolean {
  return !!useLibrary.getState().library.sessions[id]?.unread
}

/** The blue dot, by hand. Opening the session reads it again. */
export function setUnread(ids: string[], unread: boolean): void {
  void useLibrary.getState().apply({ type: 'setUnread', ids, unread }, { record: false })
}

/** A finished (or failed) mark seen to without opening the session. */
export function markCompleted(ids: string[]): void {
  const finished = useFinished.getState().ids
  if (ids.some((id) => finished.has(id))) useFinished.setState({ ids: new Set([...finished].filter((id) => !ids.includes(id))) })
  setUnread(ids, false)
}

/** Whether a session has a mark to see to: finished while you were elsewhere, or marked unread. */
export function hasMark(id: string): boolean {
  return useFinished.getState().ids.has(id) || isUnread(id)
}

/** Fast mode for a session, from its next request on. */
export async function toggleFast(id: string): Promise<void> {
  const live = useLive.getState().sessions[id]
  const on = !live?.fast
  await useLive.getState().set(id, { fast: on })
  notify(on ? 'Fast mode is on for this session' : 'Fast mode is off')
}

/** How a conversation shows: yours if you switched it, else Settings' default. */
export function transcriptViewOf(id: string | null): TranscriptView {
  return (id && useUi.getState().transcriptViews[id]) || useLive.getState().settings.transcriptView
}

export function setTranscriptView(id: string, view: TranscriptView, viaKeyboard = false): void {
  useUi.getState().setTranscriptView(id, view)
  if (viaKeyboard) notify(`Transcript View: ${TRANSCRIPT_VIEWS.find((v) => v.id === view)?.label ?? view}`)
}

/** The same, subscribed: re-renders when you switch it, or Settings' default changes. */
export function useTranscriptView(id: string | null): TranscriptView {
  const mine = useUi((s) => (id ? s.transcriptViews[id] : undefined))
  const fallback = useLive((s) => s.settings.transcriptView)
  return mine ?? fallback
}
