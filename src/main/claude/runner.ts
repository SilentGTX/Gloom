// One session's `claude` process, driven through the Agent SDK in streaming-input
// mode: your messages go in as they're sent, the CLI's messages come out as it
// works. The runner keeps what the window needs to know (its state, the reply
// as it streams, the prompt cards waiting, what's queued) and reports changes.
// Finished lines are shown at once as provisional entries; the transcript file
// gets the same lines (same UUIDs) and takes over from them.
//
// A process lives while a turn runs or a card waits, closes after its idle
// time, and resumes on the next send. Windows doesn't end a process's children
// with it, so the whole tree (MCP servers included) is killed.
import { execFile, execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  query,
  type CanUseTool,
  type ModelInfo,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
  type SpawnedProcess,
  type SpawnOptions
} from '@anthropic-ai/claude-agent-sdk'
import {
  accountName,
  applyStreamEvent,
  EFFORTS,
  finishStreamBlock,
  isEffort,
  isMode,
  planName,
  type AccountSummary,
  type Activity,
  type BackgroundTask,
  type CardAnswer,
  type CommandInfo,
  type ContextInfo,
  type Effort,
  type ImageAttachment,
  type LiveError,
  type LiveSummary,
  type McpServer,
  type ModeId,
  type ModelChoice,
  type PromptCard,
  type Queued,
  type RunState,
  type StreamState,
  compareVersions
} from '@shared/live'
import { lineEntries, resolveRef, type LineAt, type ToolResult, type TranscriptEntry } from '@shared/transcript'
import type { CodeRewind } from '@shared/live'
import { forwardedEnv, remoteCommand } from '@shared/ssh'
import { systemExe } from '../exec'
import { cliAtLeast, EXPECTED_VERSION, findClaude } from './binary'
import { GLOOM_PROMPT, QUIET_TOOLS } from './gloom-tools'
import { settings } from './settings'

/** Streamed text reaches the window at most this often. */
const STREAM_MS = 40
/** Finished lines kept in memory, for the window to read parts of before the file has them. */
const BLOB_LINES = 200
/** Provisional entries kept: the turns the file may not have caught up with. */
const KEEP_TURNS = 2
/** What's kept of the CLI's stderr, for an error's details. */
const STDERR_TAIL = 4000
/** How long a process asked only a question (its models, the usage) may take to answer. */
const ASK_IDLE_MS = 60_000
/** A card shows strings up to this long; the answer goes back with the whole input. */
const CARD_STRING = 6000
/** A code rewind waits this long for the CLI (one started for it takes a second or two). */
const REWIND_MS = 60_000
/** How the CLI refuses a fork that would drop more than the turn named (newer CLIs). */
/** The first CLI seen to say where a message sent mid-turn is (command_lifecycle); older ones get Gloom's own queue. */
const LIFECYCLE_VERSION = '2.1.314'
const DROPS_REFUSED = 'Resume rejected by --resume-drops-turn:'

export interface RunnerOptions {
  id: string
  cwd: string
  model: string | null
  mode: ModeId
  effort: Effort | null
  /** The transcript exists, so the CLI resumes it; otherwise it starts one with this ID. */
  resume: boolean
  /** Folders besides its working folder it may use. */
  folders?: string[]
  /** Connect to Remote Control as each process starts (Settings, for sessions made in Gloom). */
  remoteControl?: boolean
  /** A side session forked from this one: its first process starts from that conversation, under this session's ID. */
  forkFrom?: string
  /** It runs on another machine, over ssh (`cwd` is a folder there). */
  ssh?: { exe: string; host: string; claude: string }
}

export interface RunnerEvents {
  /** Gloom's tools for this session's processes (gloom-tools.ts), made fresh for each one. */
  tools?(): Options['mcpServers']
  summary(summary: LiveSummary): void
  entries(entries: TranscriptEntry[], results: Record<string, ToolResult>, reset: boolean): void
  stream(stream: StreamState | null): void
  /** Its process ended. */
  closed(): void
  /** A turn ended, or the process did: the manager may close idle ones, or install an update. */
  settled(): void
  attention(kind: 'waiting' | 'finished' | 'failed', card?: PromptCard): void
  rateLimit(info: Record<string, unknown>): void
  /** The first process to start says which models your plan has. */
  models(models: ModelChoice[]): void
  /** Who Claude Code is signed in as, and on what plan. */
  account(account: AccountSummary): void
}

/** A push-driven prompt stream: messages go to the CLI as they're sent. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(msg: SDKUserMessage): void {
    if (this.closed) return
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w({ value: msg, done: false })
    } else this.queue.push(msg)
  }

  close(): void {
    this.closed = true
    this.waiting?.({ value: undefined as never, done: true })
    this.waiting = null
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const next = this.queue.shift()
        if (next) return Promise.resolve({ value: next, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      }
    }
  }
}

/**
 * Gloom is started from Explorer, but a development run inherits the Claude
 * app's variables (CLAUDECODE, CLAUDE_CODE_*, MCP_*): drop them, keeping the
 * config folder, which Gloom and the CLI must agree on.
 */
function cleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC_BASE_URL$|MCP_)/i.test(key) && key !== 'CLAUDE_CONFIG_DIR') continue
    env[key] = value
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'gloom'
  // The Claude app sets this for its sessions; newer CLIs leave AskUserQuestion out without it.
  env.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL = 'true'
  return env
}

/** Ends a process and everything it started. */
export function killTree(pid: number | undefined, sync = false): void {
  if (!pid) return
  const args = ['/pid', String(pid), '/T', '/F']
  try {
    if (sync) execFileSync(systemExe('taskkill.exe'), args, { windowsHide: true, stdio: 'ignore', timeout: 3000 })
    else execFile(systemExe('taskkill.exe'), args, { windowsHide: true }, () => {})
  } catch {
    // Already gone.
  }
}

/** A model as the CLI offers it, as Gloom's pickers list it. */
function modelChoice(m: ModelInfo): ModelChoice {
  return {
    value: m.value,
    label: m.displayName || m.value,
    description: m.description ?? '',
    efforts: m.supportsEffort === false ? [] : (m.supportedEffortLevels ?? [...EFFORTS]).filter(isEffort),
    ...(m.supportsFastMode ? { fast: true } : {})
  }
}

/** Why fast mode can't serve, in words, from the CLI's reason. */
const FAST_BLOCKED: Record<string, string> = {
  free: 'Fast mode needs a paid plan.',
  preference: 'Fast mode is turned off in your Claude Code settings.',
  extra_usage_disabled: 'Fast mode needs extra usage turned on for your account.',
  network_error: 'Claude Code couldn’t reach Anthropic to check fast mode.',
  not_first_party: 'Fast mode isn’t offered through this provider.',
  disabled_by_env: 'An environment variable turned fast mode off.',
  model_not_allowed: 'This model doesn’t run in fast mode.',
  sdk_opt_in_required: 'This Claude Code turns fast mode on per session: switch it on again.',
  unknown: 'Fast mode isn’t available right now.'
}

const fastState = (v: unknown): 'off' | 'cooldown' | 'on' | null => (v === 'off' || v === 'cooldown' || v === 'on' ? v : null)

/**
 * The models the installed Claude Code offers. Gloom asks when the CLI has
 * changed since its list was made, so a new model doesn't wait for a session
 * to start.
 */
export async function askModels(): Promise<ModelChoice[]> {
  return (await askIdle((q) => q.supportedModels()))?.map(modelChoice) ?? []
}

/** Your plan's usage, as Claude Code answers it (`rate_limits`), for the usage panel before any session runs. */
export function askUsage(): Promise<unknown> {
  return askIdle((q) => q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }))
}

/**
 * Asks a Claude Code process of its own, sent no message (so no turn, no
 * transcript, no usage spent), in an empty folder, then lets it go: what a
 * session would otherwise have to start for. Never a script (the tests' fake
 * claude), and never while the tests say so (GLOOM_NO_CLAUDE_ASKS).
 */
async function askIdle<T>(ask: (q: Query) => Promise<T>): Promise<T | null> {
  const claude = findClaude()
  if (!claude || /\.(mjs|js)$/i.test(claude) || process.env.GLOOM_NO_CLAUDE_ASKS) return null
  const cwd = mkdtempSync(join(tmpdir(), 'gloom-ask-'))
  let release = () => {}
  const idle = (async function* (): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>((resolve) => (release = resolve))
  })()
  const q = query({
    prompt: idle,
    options: {
      pathToClaudeCodeExecutable: claude,
      cwd,
      env: cleanEnv(),
      // Your settings narrow the list (availableModels), as they do a session's.
      settingSources: ['user', 'project', 'local'],
      spawnClaudeCodeProcess: (o) => {
        const child = spawn(o.command, o.args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        child.stderr.on('data', () => {})
        o.signal.addEventListener('abort', () => child.exitCode === null && killTree(child.pid))
        return child as unknown as SpawnedProcess
      }
    }
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('Claude Code didn’t answer')), ASK_IDLE_MS)))
    return await Promise.race([ask(q), late])
  } finally {
    clearTimeout(timer)
    release()
    q.close()
    // Once the process has let go of it.
    setTimeout(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 3 }), 5000)
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A tool's input for its card: long strings cut, the rest as is. */
function cardInput(input: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return v.length > CARD_STRING ? v.slice(0, CARD_STRING) + '\n…' : v
    if (depth > 5) return Array.isArray(v) ? [] : isObj(v) ? {} : v
    if (Array.isArray(v)) return v.slice(0, 100).map((x) => walk(x, depth + 1))
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]))
    return v
  }
  return walk(input, 0) as Record<string, unknown>
}

const DESTINATIONS: Record<string, string> = {
  session: 'For this session only',
  localSettings: 'Saved for you in this project, in .claude/settings.local.json',
  projectSettings: 'Saved for everyone in this project, in .claude/settings.json',
  userSettings: 'Saved in your own settings, for every project',
  cliArg: 'For this session only'
}

/** What an "Always Allow" choice does, in words: what it allows, and where it's kept. */
export function describeUpdate(update: PermissionUpdate): { label: string; detail: string } {
  const where = DESTINATIONS[update.destination] ?? 'Saved in your settings'
  switch (update.type) {
    case 'addRules': {
      const rule = update.rules[0]
      const content = rule?.ruleContent?.replace(/:\*$/, '').trim()
      const what = !rule ? 'these requests' : content ? `${rule.toolName} ${content}${rule.ruleContent?.endsWith(':*') ? '…' : ''}` : `every ${rule.toolName} request`
      const more = update.rules.length > 1 ? ` and ${update.rules.length - 1} more` : ''
      return { label: `Always Allow ${what}${more}`, detail: where }
    }
    case 'setMode':
      return update.mode === 'acceptEdits'
        ? { label: 'Allow All Edits', detail: 'Switches this session to Accept Edits: it edits files without asking' }
        : { label: `Switch to ${update.mode}`, detail: where }
    case 'addDirectories': {
      const dir = update.directories[0] ?? 'this folder'
      return { label: `Allow Access to ${dir.split(/[\\/]/).filter(Boolean).pop() ?? dir}`, detail: `${dir}. ${where}` }
    }
    default:
      return { label: 'Always Allow', detail: where }
  }
}

/** The questions an AskUserQuestion call asks, whatever shape they came in. */
function questionsOf(input: Record<string, unknown>) {
  const list = Array.isArray(input.questions) ? input.questions : []
  return list.filter(isObj).map((q) => ({
    question: typeof q.question === 'string' ? q.question : '',
    header: typeof q.header === 'string' ? q.header : '',
    options: (Array.isArray(q.options) ? q.options : []).filter(isObj).map((o) => ({
      label: typeof o.label === 'string' ? o.label : String(o.label ?? ''),
      description: typeof o.description === 'string' ? o.description : '',
      ...(typeof o.preview === 'string' && o.preview.trim() ? { preview: o.preview.slice(0, CARD_STRING) } : {})
    })),
    multiSelect: q.multiSelect === true
  }))
}

/** The context-usage answer, in either spelling the CLI has used. */
function parseContext(raw: unknown): ContextInfo | null {
  if (!isObj(raw)) return null
  const used = num(raw.totalTokens) ?? num(raw.total_tokens)
  const max = num(raw.maxTokens) ?? num(raw.max_tokens) ?? num(raw.rawMaxTokens) ?? num(raw.raw_max_tokens)
  if (used === null || !max) return null
  const percent = num(raw.percentage) ?? Math.round((used / max) * 100)
  return { used, max, percent: Math.max(0, Math.min(100, percent)) }
}

interface PendingCard {
  card: PromptCard
  input: Record<string, unknown>
  updates: PermissionUpdate[]
  resolve(result: PermissionResult): void
}

export class Runner {
  readonly id: string
  cwd: string
  private model: string | null
  private mode: ModeId
  private effort: Effort | null
  private resume: boolean

  private q: Query | null = null
  private inbox: Inbox | null = null
  private pid: number | undefined
  private state: RunState
  private activity: Activity | null = null
  private activeModel: string | null = null
  private turnStarted: number | null = null
  private queued: (Queued & { message: SDKUserMessage })[] = []
  private cards = new Map<string, PendingCard>()
  private context: ContextInfo | null = null
  private error: LiveError | null = null
  /** This turn's error, already in the transcript as the CLI's own row: the banner would say it twice. */
  private shownError: string | null = null
  private version: string | null = null
  lastActive = Date.now()
  /** Interrupted by you: the turn's end isn't news, and nothing queued follows it. */
  private stopping = false
  /** close() was asked for: its end isn't a failure. */
  private closing = false
  /** Processes put away for a rewind: their end isn't news either. */
  private retired = new WeakSet<Query>()
  private stderr = ''
  /**
   * A conversation rewind not yet sent after: the next process starts from
   * `at` (the entry before the message rewound to, `drops`). It stays shown as
   * rewound, so the old turns don't flash back while the file catches up.
   */
  /** A conversation rewind the next process starts from; `check` asks Claude Code to make sure only that turn goes. */
  private forkAt: { at: string; drops: string; check: boolean } | null = null
  /** The rewind the running process started from, and the message it was started for: for a refused rewind's retry. */
  private started: { fork: { at: string; drops: string; check: boolean } | null; message: SDKUserMessage | null } = { fork: null, message: null }
  private rewound: string | null = null

  private stream: StreamState | null = null
  private streamTimer: ReturnType<typeof setTimeout> | null = null
  /** Entries the stream has shown, by turn, oldest first. */
  private turns: { entries: TranscriptEntry[]; results: Record<string, ToolResult> }[] = []
  private blobs = new Map<number, Record<string, unknown>>()
  private blobSeq = 1
  commands: CommandInfo[] | null = null
  private askedForModels = false
  private askedForAccount = false
  private mcp: McpServer[] | null = null
  /** Fast mode as you set it; its process says whether it's serving (fastState). */
  private fast = false
  private fastState: 'off' | 'cooldown' | 'on' | null = null
  private fastUnavailable: string | null = null
  /** The output style you picked for this session (null: Settings', else your Claude Code settings'). */
  private outputStyle: string | null = null
  private styleInForce: string | null = null
  private outputStyles: string[] = []
  private suggestion: string | null = null
  private remoteControl: boolean
  private folders: string[]
  private forkFrom: string | null
  private readonly ssh: RunnerOptions['ssh'] | null
  /** Background tasks, newest last; the oldest ended ones go past 40. */
  private tasks: BackgroundTask[] = []

  constructor(
    options: RunnerOptions,
    private readonly events: RunnerEvents,
    /** Whether to ask this process for the models, given its CLI's version. */
    private readonly wantModels: (version: string | null) => boolean
  ) {
    this.id = options.id
    this.cwd = options.cwd
    this.model = options.model
    this.mode = options.mode
    this.effort = options.effort
    this.resume = options.resume
    this.state = options.resume ? 'idle' : 'new'
    this.folders = options.folders ?? []
    this.remoteControl = options.remoteControl === true
    this.forkFrom = options.forkFrom ?? null
    this.ssh = options.ssh ?? null
  }

  /** Where it runs: over ssh, the connection (for the transcript's copy). */
  get remote(): RunnerOptions['ssh'] | null {
    return this.ssh
  }

  /** Whether its process is running. */
  get alive(): boolean {
    return this.q !== null
  }

  get runState(): RunState {
    return this.state
  }

  /** A turn is under way or a card waits: closing it would lose work. */
  get busy(): boolean {
    return this.state === 'starting' || this.state === 'working' || this.state === 'waiting'
  }

  summary(): LiveSummary {
    return {
      id: this.id,
      state: this.state,
      cwd: this.cwd,
      model: this.model,
      activeModel: this.activeModel,
      mode: this.mode,
      effort: this.effort,
      turnStarted: this.turnStarted,
      activity: this.activity,
      queued: this.queued.map(({ id, text, images, sent }) => ({ id, text, images, sent })),
      cards: [...this.cards.values()].map((c) => c.card),
      context: this.context,
      error: this.error,
      lastActive: this.lastActive,
      version: this.version,
      rewoundTo: this.rewound,
      mcp: this.mcp,
      fast: this.fast,
      fastState: this.fastState,
      fastUnavailable: this.fastUnavailable,
      outputStyle: this.styleInForce ?? this.outputStyle ?? settings().outputStyle,
      outputStyles: this.outputStyles,
      suggestion: this.suggestion,
      remoteControl: this.remoteControl,
      folders: this.folders,
      alive: this.q !== null,
      tasks: this.tasks
    }
  }

  provisional(): { entries: TranscriptEntry[]; results: Record<string, ToolResult> } {
    return {
      entries: this.turns.flatMap((t) => t.entries),
      results: Object.assign({}, ...this.turns.map((t) => t.results))
    }
  }

  streaming(): StreamState | null {
    return this.stream
  }

  private emit(): void {
    this.events.summary(this.summary())
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  /** Sends a message, or queues it while Claude works. */
  send(text: string, images: ImageAttachment[]): void {
    const content: Exclude<SDKUserMessage['message']['content'], string> = [
      ...images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType as 'image/png', data: img.data } })),
      ...(text ? [{ type: 'text' as const, text }] : [])
    ]
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: images.length ? content : text },
      parent_tool_use_id: null,
      // The checkpoint ID for rewinds, and the key its transcript line will have.
      uuid: randomUUID() as SDKUserMessage['uuid']
    }
    this.error = null
    if (this.busy && this.inbox && this.version && compareVersions(this.version, LIFECYCLE_VERSION) >= 0) {
      // Claude Code folds it into the turn after the step under way (observed on CLI 2.1.316,
      // `npm run spike -- steer-next`), or runs it next if the turn ends first.
      message.priority = 'next'
      this.queued.push({ id: message.uuid!, text, images: images.length, sent: true, message })
      this.inbox.push(message)
      this.emit()
      return
    }
    if (this.busy) {
      this.queued.push({ id: message.uuid!, text, images: images.length, sent: false, message })
      this.emit()
      return
    }
    this.deliver(message)
  }

  private deliver(message: SDKUserMessage): void {
    this.suggestion = null
    if (!this.q) this.start()
    this.state = this.state === 'starting' ? 'starting' : 'working'
    this.turnStarted = Date.now()
    this.activity = 'requesting'
    this.lastActive = Date.now()
    this.newTurn()
    this.show(message as unknown as Record<string, unknown>)
    this.started.message ??= message
    this.inbox!.push(message)
    this.emit()
  }

  /** Takes a queued message back before Claude reads it. One Claude already took stays. */
  unqueue(queuedId: string): void {
    const item = this.queued.find((q) => q.id === queuedId)
    if (!item) return
    const drop = () => {
      const before = this.queued.length
      this.queued = this.queued.filter((q) => q.id !== queuedId)
      if (this.queued.length !== before) this.emit()
    }
    if (!item.sent || !this.q) return drop()
    // In the SDK (cancel_async_message), not yet in its published types.
    const q = this.q as unknown as { cancelAsyncMessage(uuid: string): Promise<boolean> }
    q.cancelAsyncMessage(queuedId)
      .then((cancelled) => cancelled && drop())
      .catch((error: unknown) => console.warn('Gloom: cancel queued message:', error))
  }

  /** Stops the turn under way. What was queued comes back, for the composer. */
  interrupt(): Queued[] {
    const taken = this.queued.map(({ id, text, images }) => ({ id, text, images, sent: false }))
    this.queued = []
    if (this.q && this.busy) {
      this.stopping = true
      // Stop means everything: what Claude Code holds for later goes too (older CLIs ignore the flag).
      const q = this.q as unknown as { interrupt(options: { cancelQueued: boolean }): Promise<unknown> }
      q.interrupt({ cancelQueued: true }).catch((error: unknown) => console.warn('Gloom: interrupt:', error))
    }
    this.emit()
    return taken
  }

  // ─── The process ───────────────────────────────────────────────────────────

  /**
   * What every process of this session starts with: Claude Code as it runs in
   * a terminal, checkpoints on, and the switches Gloom keeps for it (fast mode,
   * output style, Remote Control, extra folders) as flag settings.
   */
  private options(claude: string): Options {
    const s = settings()
    const style = this.outputStyle ?? s.outputStyle
    const flags = {
      ...(this.fast ? { fastMode: true } : {}),
      ...(style ? { outputStyle: style } : {}),
      ...(this.remoteControl ? { remoteControlAtStartup: true } : {})
    }
    return {
      pathToClaudeCodeExecutable: claude,
      // Over ssh the folder is the other machine's (spawnOverSsh goes there); the SDK keeps one of this computer's.
      cwd: this.ssh ? homedir() : this.cwd,
      env: cleanEnv(),
      // Without these the SDK skips your settings and CLAUDE.md, and isn't Claude Code.
      settingSources: ['user', 'project', 'local'],
      // Claude Code's own prompt, then what Gloom's tools are for.
      systemPrompt: { type: 'preset', preset: 'claude_code', append: GLOOM_PROMPT },
      // AskUserQuestion's options may carry a preview, which the question card shows.
      toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
      includePartialMessages: true,
      // So the mode picker can switch a running session into Bypass.
      allowDangerouslySkipPermissions: true,
      // Claude's Write and Edit changes can be rewound to any message you send (the message's UUID is its checkpoint).
      enableFileCheckpointing: true,
      permissionMode: this.mode,
      promptSuggestions: s.promptSuggestions,
      ...(this.folders.length ? { additionalDirectories: this.folders } : {}),
      ...(Object.keys(flags).length ? { settings: flags } : {}),
      ...(this.model ? { model: this.model } : {}),
      ...(this.effort ? { effort: this.effort } : {})
    }
  }

  private start(): void {
    // Over ssh, Claude Code is the other machine's; the SDK starts it through ssh (spawnOverSsh).
    const claude = this.ssh ? 'claude' : findClaude()
    if (!claude) throw new Error('Claude Code isn’t installed.')
    const inbox = new Inbox()
    this.inbox = inbox
    this.closing = false
    this.stderr = ''
    this.state = 'starting'
    // Gloom's tools that only show or read go through without a card.
    const canUseTool: CanUseTool = (toolName, input, options) => (QUIET_TOOLS.has(toolName) ? Promise.resolve({ behavior: 'allow', updatedInput: input }) : this.ask(toolName, input, options))
    const fork = this.forkAt
    this.started = { fork, message: null }
    const forkFrom = this.forkFrom
    this.forkFrom = null
    const tools = this.events.tools?.()
    const q = query({
      prompt: inbox,
      options: {
        ...this.options(claude),
        ...(tools ? { mcpServers: tools } : {}),
        // A side session forked from another starts from its conversation, under its own ID.
        ...(forkFrom ? { resume: forkFrom, forkSession: true, sessionId: this.id } : this.resume ? { resume: this.id } : { sessionId: this.id }),
        // After a conversation rewind: carry on from the entry before the message rewound to. Newer
        // CLIs also check that only that turn goes (older ones reject the flag outright).
        ...(fork && this.resume ? { resumeSessionAt: fork.at, ...(fork.check && cliAtLeast(EXPECTED_VERSION) ? { resumeDropsTurn: fork.drops } : {}) } : {}),
        canUseTool,
        spawnClaudeCodeProcess: (options) => (this.ssh ? this.spawnOverSsh(options) : this.spawn(options, (pid) => (this.pid = pid), true))
      }
    })
    this.q = q
    this.resume = true
    void this.pump(q)
  }

  /** Starts the CLI ourselves: hidden, its stderr kept (for the session's own process), its PID known for the tree kill. */
  private spawn(options: SpawnOptions, onPid: (pid: number | undefined) => void, keepStderr: boolean): SpawnedProcess {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    onPid(child.pid)
    // Read it, or a chatty CLI fills the pipe and stalls.
    child.stderr.on('data', (chunk: Buffer) => {
      if (keepStderr) this.stderr = (this.stderr + chunk.toString('utf8')).slice(-STDERR_TAIL)
    })
    options.signal.addEventListener('abort', () => {
      if (child.exitCode === null) killTree(child.pid)
    })
    return child as unknown as SpawnedProcess
  }

  /** Starts Claude Code on the other machine: ssh runs it in the session's folder there, with the SDK's arguments. */
  private spawnOverSsh(options: SpawnOptions): SpawnedProcess {
    const ssh = this.ssh!
    // The SDK may start the CLI through a runtime (node script.js …): the CLI's own arguments follow the script.
    const args = options.command === 'claude' || /claude(\.exe)?$/i.test(options.command) ? options.args : options.args.slice(options.args.findIndex((a) => /\.(m?js|cjs)$/i.test(a)) + 1)
    const command = remoteCommand(this.cwd, ssh.claude, args, forwardedEnv(options.env as Record<string, string | undefined>))
    const child = spawn(ssh.exe, ['-T', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', ssh.host, command], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.pid = child.pid
    child.stderr.on('data', (chunk: Buffer) => (this.stderr = (this.stderr + chunk.toString('utf8')).slice(-STDERR_TAIL)))
    options.signal.addEventListener('abort', () => {
      if (child.exitCode === null) killTree(child.pid)
    })
    return child as unknown as SpawnedProcess
  }

  /**
   * Claude Code refused a rewind: past the point rewound to there's more than that turn, as when a
   * message you sent mid-turn was folded into it (CLI 2.1.316). You saw that message and chose to go
   * back before it, so the rewind is tried once more without the check, with the message you sent.
   * False when that retry was the one refused, or nothing was sent.
   */
  private refused(why: string): boolean {
    const { fork, message } = this.started
    if (!fork?.check || !message) return false
    console.warn('Gloom: rewind refused, retrying without the check:', why.slice(0, 300))
    this.forkAt = { ...fork, check: false }
    this.retire()
    this.turns = []
    this.events.entries([], {}, true)
    this.error = null
    this.deliver(message)
    return true
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const m of q) this.handle(m)
    } catch (error) {
      // A dead CLI rejects the iterator; nothing else is left waiting on it.
      if (!this.closing && !this.retired.has(q)) this.fail(error)
    } finally {
      this.ended(q)
    }
  }

  // ─── Rewinds ───────────────────────────────────────────────────────────────

  /**
   * The conversation goes back to before a message: what's shown stops before
   * it, and the next message starts a process from `at`, the entry before it
   * on the chain. The old turns stay in the file, as a branch.
   */
  rewindConversation(at: string, drops: string): void {
    if (this.busy) throw new Error('Claude is working. Stop it first.')
    this.forkAt = { at, drops, check: true }
    this.rewound = drops
    this.error = null
    this.queued = []
    // What the stream showed belongs to the turns going away.
    this.turns = []
    this.events.entries([], {}, true)
    this.retire()
    this.emit()
  }

  /** Takes back a conversation rewind, if nothing was sent after it; false when it's too late. */
  undoRewind(): boolean {
    if (!this.forkAt) return false
    this.forkAt = null
    this.rewound = null
    this.emit()
    return true
  }

  /** Puts the process away at once (a rewind needs a new one); the next send starts it. */
  private retire(): void {
    const q = this.q
    if (!q) return
    this.retired.add(q)
    const pid = this.pid
    this.q = null
    this.inbox?.close()
    this.inbox = null
    this.pid = undefined
    this.state = 'idle'
    this.activity = null
    this.turnStarted = null
    q.close()
    setTimeout(() => killTree(pid), 3000).unref()
  }

  /**
   * Files back to how they were before a message, from Claude Code's
   * checkpoints (Write and Edit only, as /rewind). With `dryRun`, only what it
   * would change. Uses the running process, or starts one just for this.
   */
  async rewindCode(messageId: string, dryRun: boolean): Promise<CodeRewind> {
    if (this.busy) throw new Error('Claude is working. Stop it first.')
    let q = this.q
    let temp: { q: Query; inbox: Inbox; pid?: number } | null = null
    if (!q) {
      const claude = findClaude()
      if (!claude) throw new Error('Claude Code isn’t installed.')
      const inbox = new Inbox()
      const t: { q: Query; inbox: Inbox; pid?: number } = { q: null as unknown as Query, inbox }
      t.q = query({ prompt: inbox, options: { ...this.options(claude), resume: this.id, spawnClaudeCodeProcess: (o) => this.spawn(o, (pid) => (t.pid = pid), false) } })
      temp = t
      q = t.q
      // Nothing is sent to it; what it says is drained so its pipe never fills.
      void (async () => {
        try {
          for await (const _ of t.q);
        } catch {
          // Closed under it.
        }
      })()
    }
    try {
      const result = await Promise.race([
        q.rewindFiles(messageId, { dryRun }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Claude Code didn’t answer.')), REWIND_MS).unref())
      ])
      return {
        can: result.canRewind,
        ...(result.error ? { reason: result.error } : {}),
        files: result.filesChanged ?? [],
        insertions: result.insertions ?? 0,
        deletions: result.deletions ?? 0
      }
    } catch (error) {
      return { can: false, reason: error instanceof Error ? error.message : String(error), files: [], insertions: 0, deletions: 0 }
    } finally {
      if (temp) {
        temp.inbox.close()
        temp.q.close()
        const pid = temp.pid
        setTimeout(() => killTree(pid), 3000).unref()
      }
    }
  }

  private fail(error: unknown): void {
    const text = error instanceof Error ? error.message : String(error)
    if (text.includes(DROPS_REFUSED) && this.refused(text)) return
    const detail = this.stderr.trim() || undefined
    this.error = /exited with code|terminated|killed/i.test(text)
      ? { kind: 'exited', message: 'Claude Code stopped unexpectedly.', detail: detail ?? text }
      : { kind: 'failed', message: text.split('\n')[0] || 'Claude Code couldn’t start.', detail }
    if (this.state !== 'idle') this.events.attention('failed')
  }

  /**
   * The process is gone, and the next send resumes it. Provisional entries stay
   * (the window drops the ones the file holds), and so does anything queued:
   * it goes after your next message.
   */
  private ended(q: Query): void {
    if (this.q !== q) return
    // What the process held never reached Claude: Gloom holds it now.
    for (const item of this.queued) {
      item.sent = false
      delete item.message.priority
    }
    this.q = null
    this.inbox = null
    this.pid = undefined
    for (const pending of [...this.cards.values()]) pending.resolve({ behavior: 'deny', message: 'The session closed.' })
    this.cards.clear()
    this.state = 'idle'
    this.activity = null
    this.turnStarted = null
    this.stopping = false
    this.setStream(null)
    this.emit()
    this.events.closed()
    this.events.settled()
  }

  /** Closes the process (idle, or quitting); the next send starts it again. */
  close({ sync = false } = {}): void {
    const q = this.q
    if (!q) return
    this.closing = true
    this.inbox?.close()
    const pid = this.pid
    if (sync) {
      killTree(pid, true)
      q.close()
      return
    }
    q.close()
    // The SDK ends the CLI; its children (MCP servers) need the tree kill.
    setTimeout(() => killTree(pid), 3000).unref()
  }

  // ─── What the CLI says ─────────────────────────────────────────────────────

  private handle(m: SDKMessage): void {
    this.lastActive = Date.now()
    switch (m.type) {
      case 'system':
        this.onSystem(m as unknown as Record<string, unknown>)
        return
      case 'stream_event':
        if (m.parent_tool_use_id) return
        this.setStream(applyStreamEvent(this.stream, m.event), true)
        this.trackActivity()
        return
      case 'assistant': {
        if (m.parent_tool_use_id) return
        const model = m.message.model
        if (model && model !== '<synthetic>' && model !== this.activeModel) {
          this.activeModel = model
          this.emit()
        }
        // The streamed copy goes before its finished line arrives, so the two never show together.
        this.setStream(finishStreamBlock(this.stream, m.message.id))
        const line = m as unknown as Record<string, unknown>
        const failed = model === '<synthetic>' || !!line.error
        if (failed) this.shownError = m.message.content.flatMap((b) => (b.type === 'text' ? [b.text.trim()] : [])).join('\n')
        this.show({ ...line, isApiErrorMessage: failed })
        return
      }
      case 'user': {
        if (m.parent_tool_use_id || 'isReplay' in m) return
        const line = m as unknown as Record<string, unknown>
        this.show({ ...line, toolUseResult: line.tool_use_result })
        return
      }
      case 'result':
        this.turnEnded(m as unknown as Record<string, unknown>)
        return
      case 'rate_limit_event':
        if (isObj(m.rate_limit_info)) this.events.rateLimit(m.rate_limit_info as unknown as Record<string, unknown>)
        return
      case 'prompt_suggestion':
        // Only once the turn is over; your next message clears it.
        if (!this.busy && typeof m.suggestion === 'string' && m.suggestion.trim()) {
          this.suggestion = m.suggestion.trim().slice(0, 2000)
          this.emit()
        }
        return
      default:
        if ((m as { type: string }).type === 'command_lifecycle') this.onLifecycle(m as unknown as Record<string, unknown>)
        return
    }
  }

  /** Where a message sent mid-turn is: Claude took it (in this turn, or as the next), or it was cancelled. */
  private onLifecycle(m: Record<string, unknown>): void {
    const i = this.queued.findIndex((q) => q.sent && q.id === m.command_uuid)
    if (i < 0) return
    if (m.state === 'started') {
      const [item] = this.queued.splice(i, 1)
      if (this.turnStarted === null) {
        // The turn had ended first: it runs as one of its own.
        this.state = 'working'
        this.turnStarted = Date.now()
        this.activity = 'requesting'
        this.newTurn()
        this.show(item.message as unknown as Record<string, unknown>)
      } else {
        // Folded into the turn under way, written as Claude Code writes it.
        const { message } = item
        this.show({ type: 'attachment', uuid: message.uuid, attachment: { type: 'queued_command', prompt: message.message.content, source_uuid: message.uuid, commandMode: 'prompt' } })
      }
      this.emit()
    } else if (m.state === 'cancelled' || m.state === 'completed') {
      this.queued.splice(i, 1)
      this.emit()
    }
  }

  private onSystem(m: Record<string, unknown>): void {
    if (m.subtype === 'init') {
      // A rewind's fork took: this process carries on from there (what's shown stays rewound until the file catches up).
      this.forkAt = null
      if (typeof m.claude_code_version === 'string') this.version = m.claude_code_version
      if (isMode(m.permissionMode)) this.mode = m.permissionMode
      // Its MCP servers and how each one started, for the inspector's Connectors.
      if (Array.isArray(m.mcp_servers))
        this.mcp = m.mcp_servers.flatMap((s: unknown) =>
          isObj(s) && typeof s.name === 'string' ? [{ name: s.name, status: typeof s.status === 'string' ? s.status : 'unknown', ...(typeof s.source === 'string' ? { scope: s.source } : {}) }] : []
        )
      if (typeof m.output_style === 'string') this.styleInForce = m.output_style
      this.readFast(m)
      if (this.state === 'starting') this.state = 'working'
      this.emit()
      this.learn()
      return
    }
    if (typeof m.subtype === 'string' && m.subtype.startsWith('task_')) return this.onTask(m)
    if (m.subtype === 'background_tasks_changed' && Array.isArray(m.tasks)) {
      // The running background tasks, as the CLI lists them: any it no longer lists has ended.
      const running = new Set(m.tasks.flatMap((t: unknown) => (isObj(t) && typeof t.task_id === 'string' ? [t.task_id] : [])))
      let changed = false
      for (const t of m.tasks) if (isObj(t) && typeof t.task_id === 'string' && !this.tasks.some((x) => x.id === t.task_id)) changed = this.addTask(t) || changed
      this.tasks = this.tasks.map((t) => (t.status === 'running' && !running.has(t.id) && t.type !== 'local_agent' ? ((changed = true), { ...t, status: 'completed' as const, ended: t.ended ?? Date.now() }) : t))
      if (changed) this.emit()
      return
    }
    if (m.subtype === 'status') {
      const before = `${this.activity}/${this.mode}`
      if (m.status === 'compacting') this.activity = 'compacting'
      else if (m.status === 'requesting') this.activity = 'requesting'
      if (isMode(m.permissionMode)) this.mode = m.permissionMode
      if (`${this.activity}/${this.mode}` !== before) this.emit()
    }
  }

  /** Fast mode as its process reports it (init, each turn's result): serving or not, and why not. */
  private readFast(m: Record<string, unknown>): void {
    const state = fastState(m.fast_mode_state)
    if (state) this.fastState = state
    if ('fast_mode_disabled_reason' in m || state) {
      const reason = typeof m.fast_mode_disabled_reason === 'string' && m.fast_mode_disabled_reason !== 'pending' ? m.fast_mode_disabled_reason : null
      this.fastUnavailable = reason ? (FAST_BLOCKED[reason] ?? FAST_BLOCKED.unknown) : null
    }
  }

  /** A task the CLI started, as the Tasks pane lists it; false when it's already listed. */
  private addTask(m: Record<string, unknown>): boolean {
    const id = typeof m.task_id === 'string' ? m.task_id : null
    if (!id || this.tasks.some((t) => t.id === id)) return false
    this.tasks = [
      ...this.tasks,
      {
        id,
        type: typeof m.task_type === 'string' ? m.task_type : typeof m.subagent_type === 'string' ? 'local_agent' : 'task',
        description: typeof m.description === 'string' ? m.description.slice(0, 300) : 'Background task',
        status: 'running',
        started: Date.now(),
        ended: null,
        summary: null,
        lastTool: null,
        tokens: null,
        toolUses: null,
        outputFile: null,
        error: null
      }
    ]
    const ended = this.tasks.filter((t) => t.status !== 'running')
    if (this.tasks.length > 40 && ended.length) this.tasks = this.tasks.filter((t) => t !== ended[0])
    return true
  }

  /** task_started, task_progress, task_updated, task_notification: the Tasks pane follows them. */
  private onTask(m: Record<string, unknown>): void {
    const id = typeof m.task_id === 'string' ? m.task_id : null
    if (!id) return
    if (m.subtype === 'task_started') {
      if (this.addTask(m)) this.emit()
      return
    }
    if (!this.tasks.some((t) => t.id === id)) this.addTask(m)
    const usage = isObj(m.usage) ? m.usage : null
    this.tasks = this.tasks.map((t) => {
      if (t.id !== id) return t
      const next = { ...t }
      if (usage) {
        next.tokens = num(usage.total_tokens) ?? next.tokens
        next.toolUses = num(usage.tool_uses) ?? next.toolUses
      }
      if (typeof m.summary === 'string' && m.summary.trim()) next.summary = m.summary.slice(0, 500)
      if (typeof m.last_tool_name === 'string') next.lastTool = m.last_tool_name
      if (typeof m.description === 'string' && m.description.trim()) next.description = m.description.slice(0, 300)
      if (m.subtype === 'task_updated' && isObj(m.patch)) {
        const p = m.patch
        if (p.status === 'killed') next.status = 'stopped'
        else if (p.status === 'pending' || p.status === 'running' || p.status === 'completed' || p.status === 'failed' || p.status === 'paused') next.status = p.status
        if (typeof p.end_time === 'number') next.ended = p.end_time
        if (typeof p.error === 'string') next.error = p.error.slice(0, 500)
        if (typeof p.description === 'string') next.description = p.description.slice(0, 300)
      }
      if (m.subtype === 'task_notification') {
        next.status = m.status === 'failed' ? 'failed' : m.status === 'stopped' ? 'stopped' : 'completed'
        next.ended = next.ended ?? Date.now()
        if (typeof m.output_file === 'string') next.outputFile = m.output_file
      }
      return next
    })
    this.emit()
  }

  /** Stops a background task (the Tasks pane's Stop). */
  async stopTask(taskId: string): Promise<void> {
    if (!this.q) throw new Error('The session isn’t running.')
    await this.q.stopTask(taskId)
  }

  /** What its first process can tell us: slash commands, the models on your plan, and the account. */
  private learn(): void {
    const q = this.q
    if (!q) return
    // The output styles its Claude Code offers (your own ones included), for the picker.
    q.initializationResult().then(
      (init) => {
        const styles = Array.isArray(init.available_output_styles) ? init.available_output_styles.filter((x): x is string => typeof x === 'string') : []
        this.outputStyles = styles
        if (typeof init.output_style === 'string') this.styleInForce = init.output_style
        this.readFast(init as unknown as Record<string, unknown>)
        this.emit()
      },
      () => {}
    )
    if (!this.askedForAccount) {
      this.askedForAccount = true
      q.accountInfo().then(
        (info) => this.events.account({ name: accountName(info.organization, null, info.email), plan: planName(info.subscriptionType) }),
        () => {}
      )
    }
    if (!this.commands) {
      q.supportedCommands().then(
        (list: SlashCommand[]) => (this.commands = list.map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' }))),
        () => (this.commands = [])
      )
    }
    if (!this.askedForModels && this.wantModels(this.version)) {
      this.askedForModels = true
      q.supportedModels().then(
        (list: ModelInfo[]) => this.events.models(list.map(modelChoice)),
        () => {}
      )
    }
  }

  /** The working line follows the block streaming now. */
  private trackActivity(): void {
    const block = this.stream?.blocks.findLast((b) => !!b)
    const next: Activity | null = !block ? this.activity : block.kind === 'thinking' ? 'thinking' : block.kind === 'tool' ? 'tool' : 'writing'
    if (next !== this.activity) {
      this.activity = next
      this.emit()
    }
  }

  /** Streamed text goes out throttled; anything else (the turn ending) goes at once, with whatever was pending. */
  private setStream(next: StreamState | null, throttle = false): void {
    const changed = next !== this.stream
    this.stream = next
    if (throttle) {
      if (changed)
        this.streamTimer ??= setTimeout(() => {
          this.streamTimer = null
          this.events.stream(this.stream)
        }, STREAM_MS)
      return
    }
    if (!changed && !this.streamTimer) return
    if (this.streamTimer) clearTimeout(this.streamTimer)
    this.streamTimer = null
    this.events.stream(next)
  }

  private newTurn(): void {
    this.turns.push({ entries: [], results: {} })
    if (this.turns.length > KEEP_TURNS) this.turns = this.turns.slice(-KEEP_TURNS)
  }

  /** A finished line from the stream, shown until the file has it. Its parts are read from memory. */
  private show(line: Record<string, unknown>): void {
    const seq = this.blobSeq++
    const at: LineAt = { offset: seq, length: 0 }
    const stamped = { ...line, timestamp: new Date().toISOString() }
    this.blobs.set(seq, stamped)
    if (this.blobs.size > BLOB_LINES) this.blobs.delete(this.blobs.keys().next().value!)
    const { entries, results } = lineEntries(stamped, at)
    if (!entries.length && !results.length) return
    if (!this.turns.length) this.newTurn()
    const turn = this.turns[this.turns.length - 1]
    turn.entries.push(...entries)
    const byId: Record<string, ToolResult> = {}
    for (const r of results) byId[r.toolUseId] = turn.results[r.toolUseId] = r
    this.events.entries(entries, byId, false)
  }

  /** Something a provisional entry left out: read from the line in memory. */
  blob(offset: number, path: (string | number)[]): unknown {
    const line = this.blobs.get(offset)
    if (!line) throw new Error('That part of the reply is in the transcript now. Reopen the session to see it.')
    return resolveRef(line, path)
  }

  private turnEnded(m: Record<string, unknown>): void {
    const interrupted = this.stopping
    this.stopping = false
    this.activity = null
    this.turnStarted = null
    this.setStream(null)
    this.readFast(m)
    const ok = m.subtype === 'success' && m.is_error !== true
    if (!ok && !interrupted) {
      const status = num(m.api_error_status)
      const errors = Array.isArray(m.errors) ? m.errors.filter((e): e is string => typeof e === 'string') : []
      const said = (typeof m.result === 'string' ? m.result : '') || errors[0] || ''
      const refusal = [said, ...errors].find((e) => e.includes(DROPS_REFUSED))
      if (refusal && this.refused(refusal)) return
      if (refusal) {
        // Refused again without the check (it can't be, but never loop): give up the fork, carry on from the end.
        this.forkAt = null
        this.rewound = null
        this.error = { kind: 'failed', message: 'Something arrived in that turn after you rewound, so Claude can’t carry on from there. Send your message again to continue from the end.', detail: refusal }
      } else if (said.trim() && said.trim() === this.shownError && status !== 401 && !/log ?in|authenticat/i.test(said)) {
        // Shown already; the banner is for what the transcript doesn't say (or what needs a Log In button).
      } else {
        this.error =
          status === 401 || /log ?in|authenticat/i.test(said)
            ? { kind: 'login', message: 'Claude Code needs you to log in again.', detail: said || undefined }
            : { kind: 'failed', message: said.split('\n')[0] || 'The turn ended with an error.', detail: said.includes('\n') ? said : undefined }
      }
    }
    this.shownError = null
    // Stop hands the queue back to the composer first. What Claude Code holds runs next, on its own;
    // what Gloom held goes now.
    const held = this.queued.findIndex((q) => !q.sent)
    if (this.queued.some((q) => q.sent)) {
      this.state = 'working'
      this.activity = 'requesting'
      this.emit()
    } else if (held >= 0) {
      const [next] = this.queued.splice(held, 1)
      this.deliver(next.message)
    } else {
      this.state = this.cards.size ? 'waiting' : 'idle'
      this.emit()
      if (!interrupted) this.events.attention(ok ? 'finished' : 'failed')
    }
    void this.readContext()
    this.events.settled()
  }

  private async readContext(): Promise<void> {
    const q = this.q
    if (!q) return
    try {
      const context = parseContext(await q.getContextUsage({ detail: 'summary' }))
      if (context && this.q === q) {
        this.context = context
        this.emit()
      }
    } catch {
      // An older CLI without it: no meter.
    }
  }

  /** Your plan's usage, from the CLI's experimental call. */
  async usage(): Promise<unknown> {
    const q = this.q
    if (!q) return null
    try {
      return await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    } catch {
      return null
    }
  }

  // ─── Prompt cards ──────────────────────────────────────────────────────────

  private ask(toolName: string, input: Record<string, unknown>, options: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
    const requestId = options.toolUseID || randomUUID()
    const updates = options.suppressAlwaysAllowRule ? [] : (options.suggestions ?? [])
    const card: PromptCard =
      toolName === 'ExitPlanMode'
        ? { kind: 'plan', requestId, plan: typeof input.plan === 'string' ? input.plan : '' }
        : toolName === 'AskUserQuestion'
          ? { kind: 'question', requestId, questions: questionsOf(input) }
          : {
              kind: 'permission',
              requestId,
              toolName,
              input: cardInput(input),
              title: options.title ?? null,
              description: options.description ?? null,
              displayName: options.displayName ?? null,
              blockedPath: options.blockedPath ?? null,
              reason: options.decisionReason ?? null,
              always: updates.map(describeUpdate),
              defaultToNo: options.defaultToNo === true
            }
    return new Promise<PermissionResult>((resolve) => {
      const settle = (result: PermissionResult) => {
        if (!this.cards.delete(requestId)) return
        resolve(result)
        if (this.state === 'waiting' && this.cards.size === 0) this.state = 'working'
        this.emit()
      }
      this.cards.set(requestId, { card, input, updates, resolve: settle })
      // An interrupt withdraws the question.
      options.signal.addEventListener('abort', () => settle({ behavior: 'deny', message: 'Interrupted.' }))
      this.state = 'waiting'
      this.activity = null
      this.emit()
      this.events.attention('waiting', card)
    })
  }

  /**
   * start_session's offer: a card asking whether the task Claude named gets a
   * session of its own or stays here. Resolves to your choice; a turn that
   * stops withdraws it ("here").
   */
  offer(title: string): Promise<'new' | 'here'> {
    const requestId = randomUUID()
    const card: PromptCard = { kind: 'offer', requestId, title: title.slice(0, 120) }
    return new Promise((resolve) => {
      const settle = (result: PermissionResult) => {
        if (!this.cards.delete(requestId)) return
        resolve(result.behavior === 'allow' ? 'new' : 'here')
        if (this.state === 'waiting' && this.cards.size === 0) this.state = 'working'
        this.emit()
      }
      this.cards.set(requestId, { card, input: {}, updates: [], resolve: settle })
      this.state = 'waiting'
      this.activity = null
      this.emit()
      this.events.attention('waiting', card)
    })
  }

  /** The latest reply text the stream showed (a side session's report). */
  lastReply(): string | null {
    const entries = this.turns.flatMap((t) => t.entries)
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.kind === 'text' && e.text.trim()) return e.text
    }
    return null
  }

  /** Your answer to a card goes back to the CLI as the tool's permission. */
  answer(answer: CardAnswer): void {
    const pending = this.cards.get(answer.requestId)
    if (!pending) return
    const { input, updates } = pending
    switch (answer.kind) {
      case 'permission': {
        if (answer.decision === 'deny') {
          const note = answer.note?.trim()
          // A plain No stops the turn, as in Claude Code; a No with a note lets Claude carry on with it.
          pending.resolve(
            note
              ? { behavior: 'deny', message: `The user denied this, and said: ${note}` }
              : { behavior: 'deny', message: 'The user denied this. Stop and wait for them to say how to go on.', interrupt: true }
          )
          if (!note) this.stopping = true
          return
        }
        const update = answer.decision === 'always' ? updates[answer.always ?? 0] : undefined
        pending.resolve({ behavior: 'allow', updatedInput: input, ...(update ? { updatedPermissions: [update] } : {}) })
        if (update?.type === 'setMode' && isMode(update.mode)) this.mode = update.mode
        return
      }
      case 'plan':
        if (answer.approve) {
          pending.resolve({ behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: answer.mode, destination: 'session' }] })
          this.mode = answer.mode
        } else {
          const note = answer.note.trim()
          pending.resolve({ behavior: 'deny', message: note ? `Keep planning. The user said: ${note}` : 'Keep planning: the user isn’t ready to approve this plan yet.' })
        }
        return
      case 'question':
        if ('declined' in answer) pending.resolve({ behavior: 'deny', message: 'The user declined to answer.' })
        else pending.resolve({ behavior: 'allow', updatedInput: { ...input, answers: answer.answers } })
        return
      case 'offer':
        pending.resolve(answer.choice === 'new' ? { behavior: 'allow', updatedInput: {} } : { behavior: 'deny', message: 'here' })
        return
    }
  }

  // ─── Switches ──────────────────────────────────────────────────────────────

  async setModel(model: string | null): Promise<void> {
    this.model = model
    this.emit()
    await this.q?.setModel(model ?? undefined)
  }

  async setMode(mode: ModeId): Promise<void> {
    this.mode = mode
    this.emit()
    await this.q?.setPermissionMode(mode)
  }

  /** Live through the flag settings; the stream never reports it, so Gloom shows what it set. */
  async setEffort(effort: Effort | null): Promise<void> {
    this.effort = effort
    this.emit()
    await this.q?.applyFlagSettings({ effortLevel: effort })
  }

  /** Fast mode from the next request on; it holds for this process and the next. */
  async setFast(on: boolean): Promise<void> {
    this.fast = on
    if (!on) this.fastUnavailable = null
    this.emit()
    await this.q?.applyFlagSettings({ fastMode: on })
  }

  /** The session's own output style (null: back to the default). Claude Code takes it from the next turn. */
  async setOutputStyle(style: string | null): Promise<void> {
    this.outputStyle = style
    this.styleInForce = style ?? settings().outputStyle
    this.emit()
    await this.q?.applyFlagSettings({ outputStyle: style ?? settings().outputStyle ?? null })
  }

  /** Folders besides its working folder it may use: at once in a running process, and in every later one. */
  async setFolders(folders: string[]): Promise<void> {
    this.folders = folders
    this.emit()
    await this.q?.applyFlagSettings({ permissions: { additionalDirectories: folders } })
  }

  /** Turns one of its MCP servers off or on (Claude Code keeps the choice for the project), then reads them again. */
  async toggleMcp(name: string, enabled: boolean): Promise<void> {
    const q = this.q
    if (!q) throw new Error('Start the session to change its connectors.')
    await q.toggleMcpServer(name, enabled)
    await this.readMcp(q)
  }

  /** Connects one of its MCP servers again (a failed one, say), then reads them again. */
  async reconnectMcp(name: string): Promise<void> {
    const q = this.q
    if (!q) throw new Error('Start the session to reconnect its connectors.')
    try {
      await q.reconnectMcpServer(name)
    } finally {
      await this.readMcp(q)
    }
  }

  private async readMcp(q: Query): Promise<void> {
    const list = await q.mcpServerStatus().catch(() => null)
    if (!list || this.q !== q) return
    this.mcp = list.map((m) => ({ name: m.name, status: m.status, ...(m.error ? { error: m.error.slice(0, 500) } : {}), ...(m.scope ? { scope: m.scope } : {}) }))
    this.emit()
  }
}
