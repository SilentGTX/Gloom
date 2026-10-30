// Sessions Gloom runs. While a session's `claude` process lives, main tells
// the window what it's doing: its state, the reply as it streams, the prompt
// cards waiting for you, what's queued. The transcript file stays the record:
// what the stream says is shown at once, and gives way to the file's own lines
// as Claude Code writes them (same UUIDs). Pure, shared by main and the window.
import type { ToolResult, TranscriptEntry } from './transcript'

// ─── Modes, models, effort ───────────────────────────────────────────────────

/** Claude Code's permission modes, as the mode picker names them. */
export const MODES = [
  { id: 'default', label: 'Ask Permissions', short: 'Ask', detail: 'Asks before it edits files or runs commands.' },
  { id: 'acceptEdits', label: 'Accept Edits', short: 'Accept Edits', detail: 'Edits files without asking. Asks before running commands.' },
  { id: 'plan', label: 'Plan', short: 'Plan', detail: 'Reads and plans. Changes nothing until you approve the plan.' },
  { id: 'auto', label: 'Auto', short: 'Auto', detail: 'Approves safe actions itself and asks about the rest.' },
  { id: 'bypassPermissions', label: 'Bypass Permissions', short: 'Bypass', detail: 'Never asks. Only for folders you can afford to lose.' }
] as const

export type ModeId = (typeof MODES)[number]['id']

export function isMode(v: unknown): v is ModeId {
  return MODES.some((m) => m.id === v)
}

export function modeInfo(id: ModeId): (typeof MODES)[number] {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export const EFFORT_LABELS: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' }

export function isEffort(v: unknown): v is Effort {
  return (EFFORTS as readonly unknown[]).includes(v)
}

export interface ModelChoice {
  /** What `--model` takes: an alias ("opus") or a model ID. */
  value: string
  label: string
  description: string
  /** Effort levels it takes; empty when it has none. */
  efforts: Effort[]
}

/** Claude Code's aliases, until a session reports the models your plan has. */
export const DEFAULT_MODELS: ModelChoice[] = [
  { value: 'default', label: 'Default', description: 'The model Claude Code recommends', efforts: [...EFFORTS] },
  { value: 'opus', label: 'Opus', description: 'For complex work', efforts: [...EFFORTS] },
  { value: 'sonnet', label: 'Sonnet', description: 'For everyday work', efforts: [...EFFORTS] },
  { value: 'haiku', label: 'Haiku', description: 'Fastest, for quick answers', efforts: [] }
]

/** The picker's name for a model value: its listed label, else the value made readable. */
export function modelLabel(value: string | null, models: readonly ModelChoice[]): string {
  if (!value) return 'Default'
  const listed = models.find((m) => m.value === value)
  if (listed) return listed.label
  // "claude-opus-5-5" → "Opus 5.5"
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(value)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] && m[3].length < 3 ? `.${m[3]}` : ''}`
  return value[0].toUpperCase() + value.slice(1)
}

// ─── A running session, as the window sees it ────────────────────────────────

/**
 * - `new`: made in Gloom, nothing sent yet, no process
 * - `starting`: its process is starting
 * - `working`: a turn is under way
 * - `waiting`: a prompt card waits for you
 * - `idle`: its process lives, nothing running
 */
export type RunState = 'new' | 'starting' | 'working' | 'waiting' | 'idle'

/** What Claude is doing within a turn, for the working line. */
export type Activity = 'requesting' | 'thinking' | 'writing' | 'tool' | 'compacting'

export interface PermissionCard {
  kind: 'permission'
  requestId: string
  toolName: string
  /** Long strings cut, as transcript inputs are. */
  input: Record<string, unknown>
  /** The CLI's own sentence for the request, when it sends one ("Claude wants to read foo.txt"). */
  title: string | null
  description: string | null
  displayName: string | null
  blockedPath: string | null
  reason: string | null
  /** The ways "Always Allow" can be saved, each saying what it allows and where. */
  always: { label: string; detail: string }[]
  /** Open on Deny, with no one-key approve (the CLI asks for it on risky requests). */
  defaultToNo: boolean
}

export interface PlanCard {
  kind: 'plan'
  requestId: string
  plan: string
}

export interface Question {
  question: string
  /** A short tag for the question ("Auth method"). */
  header: string
  options: { label: string; description: string }[]
  multiSelect: boolean
}

export interface QuestionCard {
  kind: 'question'
  requestId: string
  questions: Question[]
}

export type PromptCard = PermissionCard | PlanCard | QuestionCard

/** Your answer to a prompt card. */
export type CardAnswer =
  | { kind: 'permission'; requestId: string; decision: 'once' | 'always' | 'deny'; always?: number; note?: string }
  | { kind: 'plan'; requestId: string; approve: true; mode: ModeId }
  | { kind: 'plan'; requestId: string; approve: false; note: string }
  | { kind: 'question'; requestId: string; answers: Record<string, string> }
  | { kind: 'question'; requestId: string; declined: true }

/** A message sent while Claude works: it goes once the turn ends. */
export interface Queued {
  id: string
  text: string
  images: number
}

export interface ContextInfo {
  used: number
  max: number
  /** 0–100. */
  percent: number
}

export type LiveErrorKind = 'exited' | 'login' | 'failed'

export interface LiveError {
  kind: LiveErrorKind
  message: string
  /** The CLI's last words on stderr, for Details. */
  detail?: string
}

export interface LiveSummary {
  id: string
  state: RunState
  cwd: string
  /** The model you picked; null is Claude Code's default. */
  model: string | null
  /** The model replying, read from its messages (plan mode may switch it). */
  activeModel: string | null
  mode: ModeId
  /** The effort Gloom set; the stream never reports it back. */
  effort: Effort | null
  /** When the turn under way started. */
  turnStarted: number | null
  activity: Activity | null
  queued: Queued[]
  cards: PromptCard[]
  context: ContextInfo | null
  error: LiveError | null
  /** Its last sign of life, ms since the epoch. */
  lastActive: number
  /** The CLI's version, once it has said. */
  version: string | null
}

// ─── The reply as it streams ─────────────────────────────────────────────────

export interface StreamBlock {
  kind: 'text' | 'thinking' | 'tool'
  text: string
  /** A tool's name, as its call streams in. */
  name?: string
}

/** The response being streamed. A block is null once its finished message has arrived. */
export interface StreamState {
  messageId: string
  blocks: (StreamBlock | null)[]
}

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)

/** Applies one streaming event (the Messages API's) to the response being streamed. */
export function applyStreamEvent(state: StreamState | null, event: unknown): StreamState | null {
  if (!isObj(event)) return state
  switch (event.type) {
    case 'message_start': {
      const id = isObj(event.message) && typeof event.message.id === 'string' ? event.message.id : `m${Date.now()}`
      return { messageId: id, blocks: [] }
    }
    case 'content_block_start': {
      if (!state || typeof event.index !== 'number' || !isObj(event.content_block)) return state
      const b = event.content_block
      const block: StreamBlock | null =
        b.type === 'text'
          ? { kind: 'text', text: typeof b.text === 'string' ? b.text : '' }
          : b.type === 'thinking' || b.type === 'redacted_thinking'
            ? { kind: 'thinking', text: typeof b.thinking === 'string' ? b.thinking : '' }
            : b.type === 'tool_use' || b.type === 'server_tool_use'
              ? { kind: 'tool', text: '', name: typeof b.name === 'string' ? b.name : undefined }
              : null
      if (!block) return state
      const blocks = state.blocks.slice()
      blocks[event.index] = block
      return { ...state, blocks }
    }
    case 'content_block_delta': {
      if (!state || typeof event.index !== 'number' || !isObj(event.delta)) return state
      const block = state.blocks[event.index]
      if (!block) return state
      const d = event.delta
      const more = d.type === 'text_delta' ? d.text : d.type === 'thinking_delta' ? d.thinking : d.type === 'input_json_delta' ? d.partial_json : null
      if (typeof more !== 'string' || !more) return state
      const blocks = state.blocks.slice()
      blocks[event.index] = { ...block, text: block.text + more }
      return { ...state, blocks }
    }
    case 'message_stop':
      return null
    default:
      return state
  }
}

/**
 * A finished block arrived as its own message (the CLI sends one per block, in
 * order): the first block still streaming is done.
 */
export function finishStreamBlock(state: StreamState | null, messageId: string): StreamState | null {
  if (!state || state.messageId !== messageId) return state
  const i = state.blocks.findIndex((b) => b !== null && b !== undefined)
  if (i < 0) return state
  const blocks = state.blocks.slice()
  blocks[i] = null
  return { ...state, blocks }
}

// ─── The stream meeting the file ─────────────────────────────────────────────

export interface Provisional {
  entries: TranscriptEntry[]
  results: Record<string, ToolResult>
}

/**
 * The transcript with what the stream has said that the file doesn't hold yet.
 * The file catches up in order, so that's whatever follows the last streamed
 * entry the file already has.
 */
export function mergeProvisional(
  entries: TranscriptEntry[],
  results: Record<string, ToolResult>,
  provisional: Provisional | undefined
): { entries: TranscriptEntry[]; results: Record<string, ToolResult> } {
  if (!provisional || (!provisional.entries.length && !Object.keys(provisional.results).length)) return { entries, results }
  const keys = new Set(entries.map((e) => e.key))
  let last = -1
  provisional.entries.forEach((e, i) => {
    if (keys.has(e.key)) last = i
  })
  const fresh = provisional.entries.slice(last + 1).filter((e) => !keys.has(e.key))
  const merged = Object.keys(provisional.results).length ? { ...provisional.results, ...results } : results
  return { entries: fresh.length ? [...entries, ...fresh] : entries, results: merged }
}

// ─── Usage, settings, Claude Code ────────────────────────────────────────────

export interface UsageWindow {
  /** 0–100, when the CLI says. */
  percent: number | null
  /** ms since the epoch. */
  resetsAt: number | null
}

/** Your plan's limits, as the CLI reports them. */
export interface UsageInfo {
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
  /** From the last turn: whether the limit let it through. */
  status: 'allowed' | 'warning' | 'rejected' | null
  updated: number
}

export interface Settings {
  /** Your claude.exe, when it isn't where Gloom looks. */
  claudePath: string | null
  /** New sessions' model (null: Claude Code's default), mode and effort. */
  model: string | null
  mode: ModeId
  effort: Effort | null
  /** A session's process closes after this long idle; 0 keeps it. */
  idleMinutes: number
  /** A Windows notification when a session needs you or finishes while Gloom is in the background. */
  notifications: boolean
  theme: 'system' | 'light' | 'dark'
}

export const DEFAULT_SETTINGS: Settings = {
  claudePath: null,
  model: null,
  mode: 'default',
  effort: null,
  idleMinutes: 10,
  notifications: true,
  theme: 'system'
}

export interface ClaudeInfo {
  /** The claude.exe Gloom runs, or null when there's none. */
  path: string | null
  version: string | null
  /** The version this build of the Agent SDK was made with. */
  expected: string
  /** Older than `expected`: some newer features stay off until it's updated. */
  outdated: boolean
}

/** Compares dotted versions: negative when a is older. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

// ─── Requests from the window ────────────────────────────────────────────────

export interface NewSessionRequest {
  cwd: string
  model: string | null
  mode: ModeId
  effort: Effort | null
}

export interface ImageAttachment {
  mediaType: string
  /** Base64, no data: prefix. */
  data: string
}

export interface SendRequest {
  id: string
  text: string
  images: ImageAttachment[]
}

export type SetRequest = { model: string | null } | { mode: ModeId } | { effort: Effort | null }

/** Whether a session can take a message here, and if not, why. */
export type CanSend = { ok: true } | { ok: false; kind: 'remote' | 'missing-folder' | 'not-installed' | 'gone'; reason: string }

export interface CommandInfo {
  name: string
  description: string
  argumentHint: string
}

export interface LiveSnapshot {
  summary: LiveSummary
  provisional: Provisional
  stream: StreamState | null
}

/** main → window */
export type LiveEvent =
  | { type: 'summary'; summary: LiveSummary }
  /** Its process closed; `lastActive` keeps its own writes from reading as another app's. */
  | { type: 'closed'; id: string; lastActive: number }
  | { type: 'entries'; id: string; entries: TranscriptEntry[]; results: Record<string, ToolResult>; reset: boolean }
  | { type: 'stream'; id: string; stream: StreamState | null }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'models'; models: ModelChoice[] }
  /** A notification was clicked: show this session. */
  | { type: 'reveal'; id: string }
