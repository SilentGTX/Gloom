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
  applyStreamEvent,
  EFFORTS,
  finishStreamBlock,
  isEffort,
  isMode,
  type Activity,
  type CardAnswer,
  type CommandInfo,
  type ContextInfo,
  type Effort,
  type ImageAttachment,
  type LiveError,
  type LiveSummary,
  type ModeId,
  type ModelChoice,
  type PromptCard,
  type Queued,
  type RunState,
  type StreamState
} from '@shared/live'
import { lineEntries, resolveRef, type LineAt, type ToolResult, type TranscriptEntry } from '@shared/transcript'
import type { CodeRewind } from '@shared/live'
import { systemExe } from '../exec'
import { cliAtLeast, EXPECTED_VERSION, findClaude } from './binary'

/** Streamed text reaches the window at most this often. */
const STREAM_MS = 40
/** Finished lines kept in memory, for the window to read parts of before the file has them. */
const BLOB_LINES = 200
/** Provisional entries kept: the turns the file may not have caught up with. */
const KEEP_TURNS = 2
/** What's kept of the CLI's stderr, for an error's details. */
const STDERR_TAIL = 4000
/** A card shows strings up to this long; the answer goes back with the whole input. */
const CARD_STRING = 6000
/** A code rewind waits this long for the CLI (one started for it takes a second or two). */
const REWIND_MS = 60_000
/** How the CLI refuses a fork that would drop more than the turn named (newer CLIs). */
const DROPS_REFUSED = 'Resume rejected by --resume-drops-turn:'

export interface RunnerOptions {
  id: string
  cwd: string
  model: string | null
  mode: ModeId
  effort: Effort | null
  /** The transcript exists, so the CLI resumes it; otherwise it starts one with this ID. */
  resume: boolean
}

export interface RunnerEvents {
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
      description: typeof o.description === 'string' ? o.description : ''
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
  private forkAt: { at: string; drops: string } | null = null
  private rewound: string | null = null

  private stream: StreamState | null = null
  private streamTimer: ReturnType<typeof setTimeout> | null = null
  /** Entries the stream has shown, by turn, oldest first. */
  private turns: { entries: TranscriptEntry[]; results: Record<string, ToolResult> }[] = []
  private blobs = new Map<number, Record<string, unknown>>()
  private blobSeq = 1
  commands: CommandInfo[] | null = null
  private askedForModels = false

  constructor(
    options: RunnerOptions,
    private readonly events: RunnerEvents,
    private readonly wantModels: () => boolean
  ) {
    this.id = options.id
    this.cwd = options.cwd
    this.model = options.model
    this.mode = options.mode
    this.effort = options.effort
    this.resume = options.resume
    this.state = options.resume ? 'idle' : 'new'
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
      queued: this.queued.map(({ id, text, images }) => ({ id, text, images })),
      cards: [...this.cards.values()].map((c) => c.card),
      context: this.context,
      error: this.error,
      lastActive: this.lastActive,
      version: this.version,
      rewoundTo: this.rewound
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
    if (this.busy) {
      this.queued.push({ id: message.uuid!, text, images: images.length, message })
      this.emit()
      return
    }
    this.deliver(message)
  }

  private deliver(message: SDKUserMessage): void {
    if (!this.q) this.start()
    this.state = this.state === 'starting' ? 'starting' : 'working'
    this.turnStarted = Date.now()
    this.activity = 'requesting'
    this.lastActive = Date.now()
    this.newTurn()
    this.show(message as unknown as Record<string, unknown>)
    this.inbox!.push(message)
    this.emit()
  }

  /** Drops a queued message before it goes. */
  unqueue(queuedId: string): void {
    const before = this.queued.length
    this.queued = this.queued.filter((q) => q.id !== queuedId)
    if (this.queued.length !== before) this.emit()
  }

  /** Stops the turn under way. What was queued comes back, for the composer. */
  interrupt(): Queued[] {
    const taken = this.queued.map(({ id, text, images }) => ({ id, text, images }))
    this.queued = []
    if (this.q && this.busy) {
      this.stopping = true
      this.q.interrupt().catch((error: unknown) => console.warn('Gloom: interrupt:', error))
    }
    this.emit()
    return taken
  }

  // ─── The process ───────────────────────────────────────────────────────────

  /** What every process of this session starts with: Claude Code as it runs in a terminal, checkpoints on. */
  private options(claude: string): Options {
    return {
      pathToClaudeCodeExecutable: claude,
      cwd: this.cwd,
      env: cleanEnv(),
      // Without these the SDK skips your settings and CLAUDE.md, and isn't Claude Code.
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      includePartialMessages: true,
      // So the mode picker can switch a running session into Bypass.
      allowDangerouslySkipPermissions: true,
      // Claude's Write and Edit changes can be rewound to any message you send (the message's UUID is its checkpoint).
      enableFileCheckpointing: true,
      permissionMode: this.mode,
      ...(this.model ? { model: this.model } : {}),
      ...(this.effort ? { effort: this.effort } : {})
    }
  }

  private start(): void {
    const claude = findClaude()
    if (!claude) throw new Error('Claude Code isn’t installed.')
    const inbox = new Inbox()
    this.inbox = inbox
    this.closing = false
    this.stderr = ''
    this.state = 'starting'
    const canUseTool: CanUseTool = (toolName, input, options) => this.ask(toolName, input, options)
    const fork = this.forkAt
    const q = query({
      prompt: inbox,
      options: {
        ...this.options(claude),
        ...(this.resume ? { resume: this.id } : { sessionId: this.id }),
        // After a conversation rewind: carry on from the entry before the message rewound to. Newer
        // CLIs also check that only that turn goes (older ones reject the flag outright).
        ...(fork && this.resume ? { resumeSessionAt: fork.at, ...(cliAtLeast(EXPECTED_VERSION) ? { resumeDropsTurn: fork.drops } : {}) } : {}),
        canUseTool,
        spawnClaudeCodeProcess: (options) => this.spawn(options, (pid) => (this.pid = pid), true)
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
    this.forkAt = { at, drops }
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
        this.show({ ...line, isApiErrorMessage: model === '<synthetic>' || !!line.error })
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
      default:
        return
    }
  }

  private onSystem(m: Record<string, unknown>): void {
    if (m.subtype === 'init') {
      // A rewind's fork took: this process carries on from there (what's shown stays rewound until the file catches up).
      this.forkAt = null
      if (typeof m.claude_code_version === 'string') this.version = m.claude_code_version
      if (isMode(m.permissionMode)) this.mode = m.permissionMode
      if (this.state === 'starting') this.state = 'working'
      this.emit()
      this.learn()
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

  /** What its first process can tell us: slash commands, and the models on your plan. */
  private learn(): void {
    const q = this.q
    if (!q) return
    if (!this.commands) {
      q.supportedCommands().then(
        (list: SlashCommand[]) => (this.commands = list.map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' }))),
        () => (this.commands = [])
      )
    }
    if (!this.askedForModels && this.wantModels()) {
      this.askedForModels = true
      q.supportedModels().then(
        (list: ModelInfo[]) =>
          this.events.models(
            list.map((m) => ({
              value: m.value,
              label: m.displayName || m.value,
              description: m.description ?? '',
              efforts: m.supportsEffort === false ? [] : (m.supportedEffortLevels ?? [...EFFORTS]).filter(isEffort)
            }))
          ),
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
    const ok = m.subtype === 'success' && m.is_error !== true
    if (!ok && !interrupted) {
      const status = num(m.api_error_status)
      const errors = Array.isArray(m.errors) ? m.errors.filter((e): e is string => typeof e === 'string') : []
      const said = (typeof m.result === 'string' ? m.result : '') || errors[0] || ''
      if (said.startsWith(DROPS_REFUSED) || errors.some((e) => e.startsWith(DROPS_REFUSED))) {
        // The CLI won't drop more than the rewound turn (something arrived in it meanwhile). As the SDK
        // asks: give up the fork and carry on plainly, never retry it.
        this.forkAt = null
        this.rewound = null
        this.error = { kind: 'failed', message: 'Something arrived in that turn after you rewound, so Claude can’t carry on from there. Send your message again to continue from the end.', detail: said }
      } else {
        this.error =
          status === 401 || /log ?in|authenticat/i.test(said)
            ? { kind: 'login', message: 'Claude Code needs you to log in again.', detail: said || undefined }
            : { kind: 'failed', message: said.split('\n')[0] || 'The turn ended with an error.', detail: said.includes('\n') ? said : undefined }
      }
    }
    // Stop hands the queue back to the composer first; anything still queued goes now.
    const next = this.queued.shift()
    if (next) {
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
}
