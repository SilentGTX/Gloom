// The sessions Gloom runs, as main reports them: each one's state, the lines
// the stream has shown before the transcript file has them, the reply as it
// streams. Also what you're writing to each (drafts), Gloom's settings, the
// models your plan has, your plan's usage, and Claude Code's install.
import { useEffect } from 'react'
import { create } from 'zustand'
import {
  DEFAULT_MODELS,
  DEFAULT_SETTINGS,
  type CardAnswer,
  type ClaudeInfo,
  type ImageAttachment,
  type LiveEvent,
  type LiveSummary,
  type ModelChoice,
  type NewSessionRequest,
  type Provisional,
  type SetRequest,
  type Settings,
  type StreamState,
  type UsageInfo
} from '@shared/live'
import { ELSEWHERE_MS, type SessionMeta } from '@shared/library'
import { notify } from '../lib/toast'
import { useLibrary } from './library'
import { useUi } from './ui'

export interface DraftImage extends ImageAttachment {
  /** A key for the list, and the file's name when it had one. */
  key: string
  name: string
}

export interface Draft {
  text: string
  images: DraftImage[]
}

const EMPTY_DRAFT: Draft = { text: '', images: [] }
/** Provisional entries kept per session; main sends two turns' worth at most. */
const PROVISIONAL_MAX = 600

interface LiveState {
  sessions: Record<string, LiveSummary>
  provisional: Record<string, Provisional>
  streams: Record<string, StreamState | null>
  /** When Gloom last heard from each session's process, kept after it closes. */
  ranAt: Record<string, number>
  /** Sessions you took over from another app. */
  takenOver: Record<string, true>
  drafts: Record<string, Draft>
  usage: UsageInfo | null
  models: ModelChoice[]
  settings: Settings
  claude: ClaudeInfo | null
  /** The New Session sheet, and the folder it files into. */
  newSession: { open: boolean; folderId: string | null }
  settingsOpen: boolean

  draft(id: string): Draft
  setDraft(id: string, draft: Draft): void
  /** Sends the draft. Resolves false (after saying why) when it couldn't go. */
  send(id: string): Promise<boolean>
  /** Sends this text (a command, say), leaving the draft alone. */
  sendText(id: string, text: string): Promise<boolean>
  /** Stops the turn; anything queued comes back into the draft. */
  stop(id: string): Promise<void>
  answer(id: string, answer: CardAnswer): Promise<void>
  set(id: string, request: SetRequest): Promise<void>
  unqueue(id: string, queuedId: string): Promise<void>
  takeOver(id: string): void
  /** Makes a session, files it, and opens it. */
  create(request: NewSessionRequest, folderId: string | null): Promise<string | null>
  openNewSession(folderId?: string | null): void
  closeNewSession(): void
  setSettingsOpen(open: boolean): void
  updateSettings(patch: Partial<Settings>): Promise<void>
}

function failure(error: unknown): string {
  // "Error invoking remote method 'live:send': Error: <reason>"
  return String((error as Error)?.message ?? error).replace(/^.*?Error: /, '')
}

export const useLive = create<LiveState>()((set, get) => ({
  sessions: {},
  provisional: {},
  streams: {},
  ranAt: {},
  takenOver: {},
  drafts: {},
  usage: null,
  models: DEFAULT_MODELS,
  settings: DEFAULT_SETTINGS,
  claude: null,
  newSession: { open: false, folderId: null },
  settingsOpen: false,

  draft: (id) => get().drafts[id] ?? EMPTY_DRAFT,
  setDraft: (id, draft) => set({ drafts: { ...get().drafts, [id]: draft } }),

  send: async (id) => {
    const api = window.gloom
    const draft = get().draft(id)
    if (!api || (!draft.text.trim() && !draft.images.length)) return false
    // Cleared at once, so the composer is ready for the next one; put back if it fails.
    get().setDraft(id, EMPTY_DRAFT)
    try {
      await api.live.send({ id, text: draft.text, images: draft.images.map(({ mediaType, data }) => ({ mediaType, data })) })
      return true
    } catch (error) {
      if (get().draft(id) === EMPTY_DRAFT || !get().draft(id).text) get().setDraft(id, draft)
      notify(failure(error))
      return false
    }
  },

  sendText: async (id, text) => {
    try {
      await window.gloom?.live.send({ id, text, images: [] })
      return true
    } catch (error) {
      notify(failure(error))
      return false
    }
  },

  stop: async (id) => {
    const taken = (await window.gloom?.live.interrupt(id)) ?? []
    if (!taken.length) return
    const draft = get().draft(id)
    const text = [...taken.map((q) => q.text), draft.text].filter((t) => t.trim()).join('\n\n')
    get().setDraft(id, { ...draft, text })
  },

  answer: async (id, answer) => {
    try {
      await window.gloom?.live.answer(id, answer)
    } catch (error) {
      notify(failure(error))
    }
  },

  set: async (id, request) => {
    try {
      await window.gloom?.live.set(id, request)
    } catch (error) {
      notify(failure(error))
    }
  },

  unqueue: async (id, queuedId) => {
    await window.gloom?.live.unqueue(id, queuedId)
  },

  takeOver: (id) => set({ takenOver: { ...get().takenOver, [id]: true } }),

  create: async (request, folderId) => {
    const api = window.gloom
    if (!api) return null
    let id: string
    try {
      id = await api.live.create(request)
    } catch (error) {
      notify(failure(error))
      return null
    }
    // Shown in the sidebar at once; the index's own entry takes over once the transcript exists.
    showUntilIndexed(id, request.cwd)
    if (folderId) await useLibrary.getState().apply({ type: 'moveSessions', ids: [id], folderId }, { record: false })
    useUi.getState().select([id])
    return id
  },

  // One sheet at a time: opening one closes the other.
  openNewSession: (folderId) => {
    const folder = folderId === undefined ? currentFolder() : folderId
    set({ newSession: { open: true, folderId: folder }, settingsOpen: false })
  },
  closeNewSession: () => set({ newSession: { ...get().newSession, open: false } }),
  setSettingsOpen: (open) => set(open ? { settingsOpen: true, newSession: { ...get().newSession, open: false } } : { settingsOpen: false }),

  updateSettings: async (patch) => {
    const api = window.gloom
    if (!api) return
    set({ settings: await api.setSettings(patch) })
  }
}))

/** The folder you're in: the open session's, else none. */
function currentFolder(): string | null {
  const { selection } = useUi.getState()
  const id = selection.length === 1 ? selection[0] : null
  const folderId = id ? useLibrary.getState().library.sessions[id]?.folderId : undefined
  return folderId && useLibrary.getState().library.folders.some((f) => f.id === folderId) ? folderId : null
}

/** A session that has no transcript yet still shows in the sidebar: a stand-in entry until the index finds its file. */
function showUntilIndexed(id: string, cwd: string, prompt?: string): void {
  const sessions = useLibrary.getState().sessions
  const existing = sessions[id]
  if (existing?.file) return
  const now = Date.now()
  // "New Session" until your first message names it; Claude Code's own title takes over with the transcript.
  const meta: SessionMeta = existing
    ? { ...existing, title: prompt ? null : existing.title, firstPrompt: existing.firstPrompt ?? prompt ?? null, lastPrompt: prompt ?? existing.lastPrompt, updated: now }
    : { id, file: '', project: '', cwd, title: prompt ? null : 'New Session', firstPrompt: prompt ?? null, lastPrompt: prompt ?? null, created: now, updated: now, size: 0, entrypoint: 'sdk-ts', gitBranch: null, version: null, remote: false }
  useLibrary.setState({ sessions: { ...sessions, [id]: meta } })
}

/**
 * Growing in the last minute while Gloom didn't write it: running in the Claude
 * app or a terminal. Gloom's own writes (`ran`: when it last heard from the
 * session's process) never count, and neither does a session you took over.
 */
export function runningElsewhere(meta: SessionMeta | undefined, now: number, ran: number | undefined, takenOver = false): boolean {
  if (!meta || takenOver || now - meta.updated >= ELSEWHERE_MS) return false
  return !(ran && meta.updated <= ran + 5_000)
}

/** The same, subscribed: re-renders as Gloom runs the session or you take it over. */
export function useElsewhere(meta: SessionMeta | undefined, now: number): boolean {
  const ran = useLive((s) => (meta ? s.ranAt[meta.id] : undefined))
  const taken = useLive((s) => (meta ? !!s.takenOver[meta.id] : false))
  return runningElsewhere(meta, now, ran, taken)
}

/** Whether a turn is under way (or a card waits) in a session Gloom runs. */
export function isBusy(summary: LiveSummary | undefined): boolean {
  return !!summary && (summary.state === 'starting' || summary.state === 'working' || summary.state === 'waiting')
}

// When Gloom last ran each session outlives a restart (an update, say), so a
// session it ran a minute ago doesn't come back locked as another app's.
const RAN_KEY = 'gloom.ranAt'
const RAN_KEEP_MS = ELSEWHERE_MS * 2

function loadRanAt(): Record<string, number> {
  try {
    const now = Date.now()
    const raw = JSON.parse(localStorage.getItem(RAN_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === 'number' && now - e[1] < RAN_KEEP_MS))
  } catch {
    return {}
  }
}

let ranTimer: ReturnType<typeof setTimeout> | undefined
function setRanAt(id: string, at: number): void {
  const ranAt = { ...useLive.getState().ranAt, [id]: at }
  useLive.setState({ ranAt })
  clearTimeout(ranTimer)
  ranTimer = setTimeout(() => {
    const now = Date.now()
    try {
      localStorage.setItem(RAN_KEY, JSON.stringify(Object.fromEntries(Object.entries(useLive.getState().ranAt).filter(([, t]) => now - t < RAN_KEEP_MS))))
    } catch {
      // Only a convenience.
    }
  }, 1000)
}

function onEvent(event: LiveEvent): void {
  const s = useLive.getState()
  switch (event.type) {
    case 'summary': {
      const { summary } = event
      useLive.setState({ sessions: { ...s.sessions, [summary.id]: summary } })
      setRanAt(summary.id, summary.lastActive)
      if (summary.state === 'new') showUntilIndexed(summary.id, summary.cwd)
      return
    }
    case 'closed': {
      if (event.lastActive) {
        setRanAt(event.id, event.lastActive)
        return
      }
      // A new session you left without a message: gone.
      const { [event.id]: _s, ...sessions } = s.sessions
      const { [event.id]: _p, ...provisional } = s.provisional
      useLive.setState({ sessions, provisional })
      const lib = useLibrary.getState().sessions
      if (lib[event.id] && !lib[event.id].file) {
        const { [event.id]: _m, ...rest } = lib
        useLibrary.setState({ sessions: rest })
      }
      return
    }
    case 'entries': {
      const before = event.reset ? undefined : s.provisional[event.id]
      const entries = [...(before?.entries ?? []), ...event.entries].slice(-PROVISIONAL_MAX)
      useLive.setState({ provisional: { ...s.provisional, [event.id]: { entries, results: { ...before?.results, ...event.results } } } })
      // The sidebar names a session that has no transcript yet by what you asked.
      const prompt = event.entries.find((e) => e.kind === 'prompt')
      if (prompt?.kind === 'prompt' && prompt.text) {
        const meta = useLibrary.getState().sessions[event.id]
        if (meta && !meta.file) showUntilIndexed(event.id, meta.cwd ?? '', prompt.text.slice(0, 200))
      }
      return
    }
    case 'stream':
      useLive.setState({ streams: { ...s.streams, [event.id]: event.stream } })
      return
    case 'usage':
      useLive.setState({ usage: event.usage })
      return
    case 'models':
      useLive.setState({ models: event.models })
      return
    case 'reveal':
      useUi.getState().select([event.id])
      return
  }
}

/** Loads what main knows about running sessions, and follows it. */
export function useLiveBridge(): void {
  useEffect(() => {
    const api = window.gloom
    if (!api) return
    let alive = true
    useLive.setState({ ranAt: { ...loadRanAt(), ...useLive.getState().ranAt } })
    const offEvent = api.live.onEvent(onEvent)
    const offSettings = api.onSettings((settings) => useLive.setState({ settings }))
    void Promise.all([api.live.list(), api.getSettings(), api.live.models(), api.live.usage(), api.claude.info()]).then(([list, settings, models, usage, claude]) => {
      if (!alive) return
      const s = useLive.getState()
      useLive.setState({
        sessions: { ...Object.fromEntries(list.map((l) => [l.id, l])), ...s.sessions },
        settings,
        models,
        usage: s.usage ?? usage,
        claude
      })
    })
    return () => {
      alive = false
      offEvent()
      offSettings()
    }
  }, [])
}

/** Opening a session Gloom runs: its provisional lines and stream, in case they came before this window did. */
export async function loadSnapshot(id: string): Promise<void> {
  const snap = await window.gloom?.live.snapshot(id)
  if (!snap) return
  const s = useLive.getState()
  useLive.setState({
    sessions: { ...s.sessions, [id]: snap.summary },
    provisional: { ...s.provisional, [id]: snap.provisional },
    streams: { ...s.streams, [id]: snap.stream }
  })
}
