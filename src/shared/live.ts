// Sessions Gloom runs. While a session's `claude` process lives, main tells
// the window what it's doing: its state, the reply as it streams, the prompt
// cards waiting for you, what's queued. The transcript file stays the record:
// what the stream says is shown at once, and gives way to the file's own lines
// as Claude Code writes them (same UUIDs). Pure, shared by main and the window.
import type { ShellId } from './terminal'
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
  /** It can run in fast mode (faster output, billed at fast-mode rates). */
  fast?: boolean
}

/** Claude Code's aliases, until a session reports the models your plan has. */
export const DEFAULT_MODELS: ModelChoice[] = [
  { value: 'default', label: 'Default', description: 'The model Claude Code recommends', efforts: [...EFFORTS] },
  { value: 'opus', label: 'Opus', description: 'For complex work', efforts: [...EFFORTS] },
  { value: 'sonnet', label: 'Sonnet', description: 'For everyday work', efforts: [...EFFORTS] },
  { value: 'haiku', label: 'Haiku', description: 'Fastest, for quick answers', efforts: [] }
]

/** The models the picker lists, by their names: the 5.5 family and Fable 5.1, as Claude Code's desktop app offers them. */
const SHOWN_MODEL = /^(Opus|Sonnet|Haiku) 5\.5$|^Fable 5\.1$/

/**
 * Keeps the picker to the models Gloom offers. Of what the CLI reports, Default
 * and those models stay; older versions are dropped. If nothing current is
 * left, Claude Code's own aliases stand in.
 */
export function shownModels(models: readonly ModelChoice[]): ModelChoice[] {
  const kept = models.filter((m) => m.value === 'default' || SHOWN_MODEL.test(m.label))
  return kept.some((m) => m.value !== 'default') ? kept : DEFAULT_MODELS
}

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
  /** `preview`: what the option would look like (markdown), shown beside the options as one is focused. */
  options: { label: string; description: string; preview?: string }[]
  multiSelect: boolean
}

export interface QuestionCard {
  kind: 'question'
  requestId: string
  questions: Question[]
}

/** Claude offers a separate session for a task you named: start it, or keep the work here. */
export interface OfferCard {
  kind: 'offer'
  requestId: string
  title: string
}

export type PromptCard = PermissionCard | PlanCard | QuestionCard | OfferCard

/** Your answer to a prompt card. */
export type CardAnswer =
  | { kind: 'permission'; requestId: string; decision: 'once' | 'always' | 'deny'; always?: number; note?: string }
  | { kind: 'plan'; requestId: string; approve: true; mode: ModeId }
  | { kind: 'plan'; requestId: string; approve: false; note: string }
  | { kind: 'question'; requestId: string; answers: Record<string, string> }
  | { kind: 'question'; requestId: string; declined: true }
  | { kind: 'offer'; requestId: string; choice: 'new' | 'here' }

/** A message sent while Claude works: it goes once the turn ends. */
export interface Queued {
  id: string
  text: string
  images: number
  /** With Claude Code already: Claude reads it after the step under way. Otherwise Gloom holds it for the turn's end. */
  sent: boolean
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
  /**
   * The message you rewound the conversation to before: it and everything after
   * it don't show, and the next message carries on from before it.
   */
  rewoundTo: string | null
  /** Its MCP servers and how each started, once its process has said (the inspector's Connectors). */
  mcp?: McpServer[] | null
  /** Fast mode as you set it for this session; it holds for its process and the next. */
  fast?: boolean
  /** What its process says of fast mode: on, cooling down after a limit, or off. */
  fastState?: 'off' | 'cooldown' | 'on' | null
  /** Why fast mode can't serve, when its process says so. */
  fastUnavailable?: string | null
  /** The output style in force, and the ones its Claude Code offers. */
  outputStyle?: string | null
  outputStyles?: string[]
  /** A suggested next prompt, after a reply (prompt suggestions on). Gone once you send. */
  suggestion?: string | null
  /** It connected to Remote Control as it started. */
  remoteControl?: boolean
  /** Folders besides its working folder that it may use. */
  folders?: string[]
  /** Its process is running now (connectors can be switched only then). */
  alive?: boolean
  /** Background work its process reported: shells, subagents, monitors, workflows (the Tasks pane). */
  tasks?: BackgroundTask[]
}

/** A background task a session's process runs (or ran): a shell, a subagent, a monitor. */
export interface BackgroundTask {
  id: string
  /** "local_bash", "local_agent", "monitor", "workflow"… as the CLI names it. */
  type: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'paused'
  started: number
  ended: number | null
  /** A subagent's latest summary of what it's doing, or its final one. */
  summary: string | null
  lastTool: string | null
  tokens: number | null
  toolUses: number | null
  /** Where its output was written, once it ended. */
  outputFile: string | null
  error: string | null
}

/** An MCP server a session's process loaded: "connected", "failed", "needs-auth", "pending", "disabled"… */
export interface McpServer {
  name: string
  status: string
  /** What went wrong, when it failed. */
  error?: string
  /** Where it's configured: user, project, local, a plugin, claude.ai… */
  scope?: string
}

/** What restoring code to before a message would do, or did. */
export interface CodeRewind {
  /** Claude Code kept a checkpoint there. */
  can: boolean
  /** Why it can't, when it can't. */
  reason?: string
  files: string[]
  insertions: number
  deletions: number
}

/** What a rewind to before a message can restore. */
export interface RewindPreview {
  /** The conversation can go back (not before the first message). */
  conversation: boolean
  code: CodeRewind
}

export interface RewindRequest {
  messageId: string
  conversation: boolean
  code: boolean
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

/** Who Claude Code is signed in as, and on what plan, for the foot of the concept's sidebar. */
export interface AccountSummary {
  /** Your organisation's name, or yours when the organisation is only you. */
  name: string | null
  /** "Max", "Team", "Pro"… */
  plan: string | null
}

/** The organisation's name, unless it's only "<you>'s Organization"; then your name, or your email's. */
export function accountName(organization: string | null | undefined, displayName: string | null | undefined, email: string | null | undefined): string | null {
  const org = organization?.trim()
  if (org && !/'s organi[sz]ation$/i.test(org)) return org
  return displayName?.trim() || email?.split('@')[0] || org || null
}

/** "claude_team", "Claude Team", "max" → "Team", "Team", "Max". */
export function planName(raw: string | null | undefined): string | null {
  const plan = raw
    ?.trim()
    .replace(/^claude[\s_-]*/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return plan ? plan.replace(/\b\w/g, (c) => c.toUpperCase()) : null
}

/** One of your plan's limits, as Claude Code's usage panel lists them: "5-hour limit", "Weekly · all models", "Weekly · Fable". */
export interface UsageLimit {
  label: string
  /** 0–100. */
  percent: number | null
  resetsAt: number | null
  /** "normal", "warning", "critical", as the service rates it. */
  severity: string
}

/** Your plan's limits, as the CLI reports them. */
export interface UsageInfo {
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
  /** Every limit, in the service's order, when it says them (newer CLIs). */
  limits?: UsageLimit[]
  /** From the last turn: whether the limit let it through. */
  status: 'allowed' | 'warning' | 'rejected' | null
  updated: number
}

/** How a kind of notification reaches you while Gloom is in the background: a banner (and the badge), the badge only, or nothing. */
export type NoticeLevel = 'banner' | 'badge' | 'off'

/** How a conversation shows: tool calls folded (normal), with Claude's thinking too, or everything open. */
export type TranscriptView = 'normal' | 'thinking' | 'verbose'

export const TRANSCRIPT_VIEWS: { id: TranscriptView; label: string; detail: string }[] = [
  { id: 'normal', label: 'Normal', detail: 'Tool calls folded' },
  { id: 'thinking', label: 'Thinking', detail: 'Claude’s thinking shown too' },
  { id: 'verbose', label: 'Verbose', detail: 'Every tool call and its output open' }
]

export function isTranscriptView(v: unknown): v is TranscriptView {
  return v === 'normal' || v === 'thinking' || v === 'verbose'
}

/** Branch names the Claude app refuses as a prefix, so a session's branch can't be mistaken for one of these. */
const PROTECTED_PREFIX = /^(main|master|staging|warm|prod-.*|release.*)$/i

/** Why a branch prefix can't be used, or null when it can: 1–40 letters, digits, ".", "_" or "-", as the Claude app takes it. */
export function branchPrefixProblem(prefix: string): string | null {
  if (!prefix) return 'Type a prefix.'
  if (prefix.length > 40) return 'Use 40 characters or fewer.'
  if (!/^[A-Za-z0-9]/.test(prefix)) return 'Start with a letter or a digit.'
  if (!/^[A-Za-z0-9._-]+$/.test(prefix)) return 'Use only letters, digits, “.”, “_” and “-”.'
  if (/\.\.|\.$|\.lock$/i.test(prefix)) return 'Git can’t take that as a branch name.'
  if (PROTECTED_PREFIX.test(prefix)) return 'That name is kept for main branches.'
  return null
}

/** Another machine a session can run on, over your own ssh (its config and keys). */
export interface SshHost {
  id: string
  /** What Gloom calls it. */
  name: string
  /** What ssh connects to: a Host from ~/.ssh/config, or user@host. */
  host: string
  /** Claude Code there, when it isn't `claude` on its PATH. */
  claude: string | null
}

export interface Settings {
  /** Your claude.exe, when it isn't where Gloom looks. */
  claudePath: string | null
  /** Machines sessions can run on over ssh. */
  sshHosts: SshHost[]
  /** New sessions' model (null: Claude Code's default), mode and effort. */
  model: string | null
  mode: ModeId
  effort: Effort | null
  /** New sessions' output style; null leaves it to your Claude Code settings. */
  outputStyle: string | null
  /** A suggested next prompt in the message box after each reply (one more request each). */
  promptSuggestions: boolean
  /** New sessions connect to Remote Control, so you can carry on from claude.ai or your phone. */
  remoteControl: boolean
  /** How a conversation shows when you open it. */
  transcriptView: TranscriptView
  /** A session's process closes after this long idle; 0 keeps it. */
  idleMinutes: number
  /** Sessions with no activity for this many days are archived; 0 never. */
  archiveAfterDays: number
  /** A session is archived once its pull request merges or closes. */
  archiveOnPrClose: boolean
  /** The computer doesn't idle-sleep while a session works. */
  keepAwake: boolean
  /** …on battery power too. */
  keepAwakeOnBattery: boolean
  /** New worktrees' branches are `<prefix>/<name>`. */
  branchPrefix: string
  /** Where new worktrees go: null is inside the project (`<repo>/.claude/worktrees`), else this folder. */
  worktreeFolder: string | null
  /** Claude asking to use a tool, or presenting a plan, while Gloom is in the background. */
  notifyPermission: NoticeLevel
  /** Claude asking you to choose between options. */
  notifyQuestion: NoticeLevel
  /** A turn finishing (or failing): a banner or nothing. */
  notifyFinished: 'banner' | 'off'
  /** Banners play the system's sound. */
  notifySound: boolean
  /** The taskbar button flashes when a session needs you. */
  flashTaskbar: boolean
  theme: 'system' | 'light' | 'dark'
  /** The terminal pane's shell. */
  shell: ShellId
  /** A small companion that floats over the window and says what the sessions are doing (/pet). */
  pet: boolean
  petKind: PetKind
  /** How big the pet is drawn: each of its pixels is this many screen pixels (PET_SIZE). */
  petSize: number
}

/** The built-in pets: pixel characters drawn with pxl (art/pets.px.js), each with a resting and a working loop. */
export const PET_KINDS = ['blob', 'sprout', 'ghost', 'ember', 'cat', 'frog', 'bot', 'owl'] as const
export type BuiltInPet = (typeof PET_KINDS)[number]
/** A built-in pet, or one you created (custom:<folder>, in Gloom's pets folder). */
export type PetKind = BuiltInPet | `custom:${string}`
export const isBuiltInPet = (v: unknown): v is BuiltInPet => (PET_KINDS as readonly unknown[]).includes(v)
/** A pet's folder name: lowercase letters, digits and dashes. */
export const PET_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const isPetKind = (v: unknown): v is PetKind => isBuiltInPet(v) || (typeof v === 'string' && v.startsWith('custom:') && PET_ID.test(v.slice(7)))
/** The pet size slider: screen pixels per pet pixel. */
export const PET_SIZE = { min: 2, max: 7, initial: 4 }

export const DEFAULT_SETTINGS: Settings = {
  claudePath: null,
  sshHosts: [],
  model: null,
  mode: 'default',
  effort: null,
  outputStyle: null,
  promptSuggestions: true,
  remoteControl: false,
  transcriptView: 'normal',
  idleMinutes: 10,
  archiveAfterDays: 0,
  archiveOnPrClose: false,
  keepAwake: true,
  keepAwakeOnBattery: true,
  branchPrefix: 'claude',
  worktreeFolder: null,
  notifyPermission: 'banner',
  notifyQuestion: 'banner',
  notifyFinished: 'banner',
  notifySound: true,
  flashTaskbar: true,
  theme: 'system',
  shell: 'powershell',
  pet: false,
  petKind: 'blob',
  petSize: PET_SIZE.initial
}

/** The level a card or a turn's end notifies at. */
export function noticeLevel(settings: Settings, kind: 'waiting' | 'finished' | 'failed', card?: { kind: string }): NoticeLevel {
  if (kind !== 'waiting') return settings.notifyFinished
  return card?.kind === 'question' || card?.kind === 'offer' ? settings.notifyQuestion : settings.notifyPermission
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
  /** In a git repository: work in a worktree of its own, on a claude/<name> branch. */
  worktree?: boolean
  /** A side session forked from this one (main only; the window never sends it). */
  forkFrom?: string
  /** Runs on another machine: one of Settings' SSH connections, by id (`cwd` is a folder there). */
  ssh?: string
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

export type SetRequest =
  | { model: string | null }
  | { mode: ModeId }
  | { effort: Effort | null }
  | { fast: boolean }
  | { outputStyle: string | null }
  /** Folders besides its working folder that it may use (all of them). */
  | { folders: string[] }

/** Whether a session can take a message here, and if not, why. */
/** `path`: the folder the reason is about, shown on a line of its own (paths run long). */
export type CanSend = { ok: true } | { ok: false; kind: 'remote' | 'missing-folder' | 'not-installed' | 'gone'; reason: string; path?: string }

export interface CommandInfo {
  name: string
  description: string
  argumentHint: string
}

/**
 * What `@` offers in the composer: a session's files and folders, relative to
 * its working folder, with forward slashes; a folder's path ends in one.
 */
export interface FileListing {
  /** The folder's own top level, A–Z: what `@` alone offers. */
  top: string[]
  /** Everything typing after the `@` searches. */
  all: string[]
  /** The folder held more than Gloom lists. */
  truncated: boolean
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
  | { type: 'account'; account: AccountSummary }
  | { type: 'models'; models: ModelChoice[] }
  /** A notification was clicked: show this session. */
  | { type: 'reveal'; id: string }
  /** Claude offered (waits for your answer) or proposed a session from session `id`. */
  | { type: 'proposal'; id: string; proposal: { taskId: string; title: string; kind: 'offer' | 'proposal' } }
  | { type: 'proposal-gone'; id: string; taskId: string }
  /** Session `id` was started by `parent` (a side session), under `name`. */
  | { type: 'linked'; id: string; parent: string; name: string }
  /** Claude saw to these sessions' finished marks (mark_completed). */
  | { type: 'completed'; ids: string[] }
  /** Claude switched how a conversation shows (set_transcript_view). */
  | { type: 'view'; id: string; view: TranscriptView }
  /** A session's pull request, as Gloom last read it (null: it has none). */
  | { type: 'pr'; id: string; status: import('./pr').PrStatus | null }
