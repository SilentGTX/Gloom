// Every session Gloom runs. Each is a Runner; this keeps them, starts and
// closes their processes, and passes what they report to the window. At most
// six processes run at once: starting another closes the longest-idle one,
// and never one mid-turn (if all six are working, a seventh starts anyway and
// the count settles as turns end). Idle processes close after Settings' idle
// time; the next send resumes them.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { SessionEntry, SessionMeta } from '@shared/library'
import {
  isEffort,
  isMode,
  type CanSend,
  type CardAnswer,
  type CodeRewind,
  type CommandInfo,
  type ImageAttachment,
  type LiveEvent,
  type LiveSnapshot,
  type LiveSummary,
  type NewSessionRequest,
  type PromptCard,
  type Queued,
  type RewindPreview,
  type RewindRequest,
  type SetRequest,
  type UsageInfo,
  type AccountSummary
} from '@shared/live'
import { parseRef } from '@shared/transcript'
import { readAccount, usageFromRateLimits } from './account'
import { claudeInfo, findClaude } from './binary'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { askModels, askUsage, Runner, type RunnerEvents } from './runner'
import { knownModels, learnedModels, modelsFrom, rememberModels, settings } from './settings'

const MAX_PROCESSES = 6
/** The plan's usage is asked for at most this often. */
const USAGE_EVERY_MS = 5 * 60 * 1000
/** Whether the CLI has changed (and has new models) is checked at most this often. */
const MODELS_CHECK_MS = 5 * 60 * 1000

export type AttentionKind = 'waiting' | 'finished' | 'failed'

export interface SessionsEvents {
  event(event: LiveEvent): void
  attention(id: string, kind: AttentionKind, card?: PromptCard): void
  /** No session is mid-turn or waiting. */
  quiet(): void
  /** A session's turn ended (not one you stopped): side sessions report to the session that started them. */
  turnEnded?(id: string, ok: boolean): void
  /** Gloom's tools for a session's next process (gloom-tools.ts). */
  tools?(id: string): Options['mcpServers']
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)


export class Sessions {
  private readonly runners = new Map<string, Runner>()
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** The last session's commands, for the `/` list before a process has started. */
  private commandsKnown: CommandInfo[] = []
  private modelsAsked = false
  /** The CLI version the models were last asked of. */
  private modelsFrom: string | null = null
  private modelsCheckedAt = 0
  private usageInfo: UsageInfo | null = null
  private accountInfo: AccountSummary | null = null
  private usageAt = 0

  constructor(
    private readonly events: SessionsEvents,
    /** The index's entry for a session. */
    private readonly lookup: (id: string) => SessionMeta | undefined,
    /** The entry before a line on a session's chain (null for its first line). */
    private readonly chainParent: (id: string, uuid: string) => Promise<string | null>,
    /** The library's entry for a session: its extra folders. */
    private readonly entryOf: (id: string) => SessionEntry | undefined = () => undefined
  ) {
    this.readConfig()
  }

  /**
   * The account and the plan's use as Claude Code's config has them (account.ts):
   * at launch, as each turn ends, and when you come back to Gloom. The usage
   * replaces Gloom's own only when Claude Code fetched it later.
   */
  readConfig(): void {
    const { account, usage } = readAccount()
    if (account && JSON.stringify(account) !== JSON.stringify(this.accountInfo)) {
      this.accountInfo = account
      this.events.event({ type: 'account', account })
    }
    if (usage && usage.updated > (this.usageInfo?.updated ?? 0)) {
      this.usageInfo = { ...usage, status: this.usageInfo?.status ?? null }
      this.events.event({ type: 'usage', usage: this.usageInfo })
    }
  }

  account(): AccountSummary | null {
    return this.accountInfo
  }

  /**
   * At launch, and when you come back to Gloom (every few minutes at most): a
   * CLI that isn't the one the kept model list came from (you updated it) is
   * asked for its models (runner.ts › askModels), rather than waiting for a
   * session to start. A list never learned from a CLI waits for the first
   * session, as it always has.
   */
  async checkModels(): Promise<void> {
    if (!learnedModels() || Date.now() - this.modelsCheckedAt < MODELS_CHECK_MS) return
    this.modelsCheckedAt = Date.now()
    const { path, version } = await claudeInfo({ fresh: true })
    if (!path || !version || version === modelsFrom()) return
    const models = await askModels().catch((error: unknown) => {
      console.warn('Gloom: asking Claude Code for its models:', error)
      return []
    })
    if (!models.length) return
    rememberModels(models, version)
    this.modelsAsked = true
    this.modelsFrom = version
    this.events.event({ type: 'models', models: knownModels() })
  }

  list(): LiveSummary[] {
    return [...this.runners.values()].map((r) => r.summary())
  }

  snapshot(id: string): LiveSnapshot | null {
    const r = this.runners.get(id)
    return r ? { summary: r.summary(), provisional: r.provisional(), stream: r.streaming() } : null
  }

  usage(): UsageInfo | null {
    return this.usageInfo
  }

  /** A session made in Gloom: nothing runs until its first message. */
  create(request: NewSessionRequest): string {
    const id = randomUUID()
    this.runners.set(
      id,
      this.makeRunner({
        id,
        cwd: request.cwd,
        model: request.model,
        mode: request.mode,
        effort: request.effort,
        resume: false,
        remoteControl: settings().remoteControl,
        ...(request.forkFrom ? { forkFrom: request.forkFrom } : {})
      })
    )
    this.emitSummary(id)
    return id
  }

  /** A new session you left without sending anything goes. */
  discard(id: string): void {
    const r = this.runners.get(id)
    if (r?.runState !== 'new') return
    this.runners.delete(id)
    this.events.event({ type: 'closed', id, lastActive: 0 })
  }

  /** Whether the session can take a message here, and if not, why. */
  check(id: string): CanSend {
    const runner = this.runners.get(id)
    const meta = this.lookup(id)
    if (!runner && !meta) return { ok: false, kind: 'gone', reason: 'That session’s transcript is gone.' }
    if (meta?.remote) return { ok: false, kind: 'remote', reason: 'It ran on another machine, so it can only be read here.' }
    if (!findClaude()) return { ok: false, kind: 'not-installed', reason: 'Claude Code isn’t installed.' }
    const cwd = runner?.cwd ?? meta?.cwd
    if (!cwd) return { ok: false, kind: 'missing-folder', reason: 'Gloom doesn’t know where this session ran.' }
    if (!existsSync(cwd)) return { ok: false, kind: 'missing-folder', reason: 'Its working folder no longer exists.', path: cwd }
    return { ok: true }
  }

  send(id: string, text: string, images: ImageAttachment[]): void {
    const can = this.check(id)
    if (!can.ok) throw new Error(can.reason)
    const runner = this.runnerFor(id)
    this.clearIdle(id)
    if (!runner.alive) this.makeRoom(id)
    runner.send(text, images)
  }

  interrupt(id: string): Queued[] {
    return this.runners.get(id)?.interrupt() ?? []
  }

  unqueue(id: string, queuedId: string): void {
    this.runners.get(id)?.unqueue(queuedId)
  }

  answer(id: string, answer: CardAnswer): void {
    this.runners.get(id)?.answer(answer)
  }

  /** Model, mode, effort, fast mode, output style or folders: live on a running process, else for its next start. */
  async set(id: string, request: SetRequest): Promise<void> {
    const runner = this.runnerFor(id)
    if ('model' in request) await runner.setModel(request.model)
    else if ('mode' in request) await runner.setMode(request.mode)
    else if ('effort' in request) await runner.setEffort(request.effort)
    else if ('fast' in request) await runner.setFast(request.fast)
    else if ('outputStyle' in request) await runner.setOutputStyle(request.outputStyle)
    else await runner.setFolders(request.folders)
  }

  /** start_session's offer, asked in the session's chat. */
  offer(id: string, title: string): Promise<'new' | 'here'> {
    const runner = this.runners.get(id)
    if (!runner?.alive) return Promise.resolve('here')
    return runner.offer(title)
  }

  /** The latest reply text a session's process showed. */
  lastReply(id: string): string | null {
    return this.runners.get(id)?.lastReply() ?? null
  }

  /** Turns one of a running session's MCP servers off or on. */
  toggleMcp(id: string, name: string, enabled: boolean): Promise<void> {
    const runner = this.runners.get(id)
    if (!runner?.alive) throw new Error('Start the session to change its connectors.')
    return runner.toggleMcp(name, enabled)
  }

  /** Connects one of a running session's MCP servers again. */
  reconnectMcp(id: string, name: string): Promise<void> {
    const runner = this.runners.get(id)
    if (!runner?.alive) throw new Error('Start the session to reconnect its connectors.')
    return runner.reconnectMcp(name)
  }

  /** Whether Gloom runs the session now: a process alive, or a turn or card under way. */
  running(id: string): boolean {
    const runner = this.runners.get(id)
    return !!runner && (runner.alive || runner.busy)
  }

  commands(id: string): CommandInfo[] {
    return this.runners.get(id)?.commands ?? this.commandsKnown
  }

  /** Part of a provisional entry (a ref with no line length), read from memory. */
  blob(id: string, ref: string): unknown {
    const at = parseRef(ref)
    const runner = this.runners.get(id)
    if (!at || !runner) throw new Error('That part of the reply is in the transcript now. Reopen the session to see it.')
    return runner.blob(at.offset, at.path)
  }

  /** What rewinding to before a message can restore: the conversation (unless it's the first), and code from its checkpoint. */
  async rewindPreview(id: string, messageId: string): Promise<RewindPreview> {
    const runner = this.runnerFor(id)
    const at = await this.chainParent(id, messageId)
    return { conversation: at !== null, code: await runner.rewindCode(messageId, true) }
  }

  /**
   * Rewinds to before a message: its code from Claude Code's checkpoint, the
   * conversation by starting the next process from the entry before it. The
   * fork point is found first, so a rewind that can't happen leaves files alone.
   */
  async rewind(id: string, request: RewindRequest): Promise<CodeRewind | null> {
    const runner = this.runnerFor(id)
    const at = request.conversation ? await this.chainParent(id, request.messageId) : null
    if (request.conversation && at === null) throw new Error('That’s where the conversation starts: there’s nothing before it to go back to.')
    let code: CodeRewind | null = null
    if (request.code) {
      code = await runner.rewindCode(request.messageId, false)
      if (!code.can) throw new Error(code.reason ?? 'Claude Code kept no checkpoint for that message.')
    }
    if (request.conversation && at) runner.rewindConversation(at, request.messageId)
    return code
  }

  undoRewind(id: string): boolean {
    return this.runners.get(id)?.undoRewind() ?? false
  }

  /** Whether its process is running (an idle one closes before its worktree goes). */
  alive(id: string): boolean {
    return !!this.runners.get(id)?.alive
  }

  /** Closes an idle session's process now; false if it's working. */
  closeIdle(id: string): boolean {
    const runner = this.runners.get(id)
    if (!runner?.alive) return true
    if (runner.busy) return false
    runner.close()
    return true
  }

  /** Where a session works: its running process's folder, else the transcript's. */
  cwdOf(id: string): string | null {
    return this.runners.get(id)?.cwd ?? this.lookup(id)?.cwd ?? null
  }

  busy(): boolean {
    return [...this.runners.values()].some((r) => r.busy)
  }

  /** Quitting: every process tree, now. */
  closeAll(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
    for (const r of this.runners.values()) r.close({ sync: true })
  }

  // ─── Inside ────────────────────────────────────────────────────────────────

  /** The runner for a session, made from the index the first time it's used here. */
  private runnerFor(id: string): Runner {
    const existing = this.runners.get(id)
    if (existing) return existing
    const meta = this.lookup(id)
    if (!meta?.cwd) throw new Error('That session’s transcript is gone.')
    const s = settings()
    const runner = this.makeRunner({
      id,
      cwd: meta.cwd,
      model: s.model,
      mode: isMode(s.mode) ? s.mode : 'default',
      effort: isEffort(s.effort) ? s.effort : null,
      resume: true,
      folders: this.entryOf(id)?.folders ?? []
    })
    this.runners.set(id, runner)
    return runner
  }

  private makeRunner(options: ConstructorParameters<typeof Runner>[0]): Runner {
    const id = options.id
    const events: RunnerEvents = {
      summary: (summary) => this.events.event({ type: 'summary', summary }),
      entries: (entries, results, reset) => this.events.event({ type: 'entries', id, entries, results, reset }),
      stream: (stream) => this.events.event({ type: 'stream', id, stream }),
      closed: () => this.events.event({ type: 'closed', id, lastActive: this.runners.get(id)?.lastActive ?? Date.now() }),
      settled: () => this.settled(id),
      attention: (kind, card) => {
        this.events.attention(id, kind, card)
        if (kind !== 'waiting') this.events.turnEnded?.(id, kind === 'finished')
      },
      tools: () => this.events.tools?.(id),
      rateLimit: (info) => this.rateLimit(info),
      models: (models) => {
        rememberModels(models, this.modelsFrom)
        this.events.event({ type: 'models', models: knownModels() })
      },
      // Claude Code's config says more (your name, the plan as the organisation has it); the SDK fills in without it.
      account: (account) => {
        if (this.accountInfo) return
        this.accountInfo = account
        this.events.event({ type: 'account', account })
      }
    }
    // Once a launch, and again whenever the CLI is another version (Update Claude Code…
    // brings new models: an updated CLI's list would otherwise wait for Gloom's next launch).
    return new Runner(options, events, (version) => {
      if (this.modelsAsked && this.modelsFrom === version) return false
      this.modelsAsked = true
      this.modelsFrom = version
      return true
    })
  }

  private emitSummary(id: string): void {
    const r = this.runners.get(id)
    if (r) this.events.event({ type: 'summary', summary: r.summary() })
  }

  /** Before a process starts: the longest-idle one closes when six are running. */
  private makeRoom(starting: string): void {
    const alive = [...this.runners.values()].filter((r) => r.alive && r.id !== starting)
    if (alive.length < MAX_PROCESSES) return
    const idle = alive.filter((r) => !r.busy).sort((a, b) => a.lastActive - b.lastActive)
    idle[0]?.close()
  }

  private clearIdle(id: string): void {
    const timer = this.idleTimers.get(id)
    if (timer) clearTimeout(timer)
    this.idleTimers.delete(id)
  }

  /** A turn ended, or a process did. */
  private settled(id: string): void {
    const runner = this.runners.get(id)
    if (runner) {
      if (runner.commands?.length) this.commandsKnown = runner.commands
      this.clearIdle(id)
      const minutes = settings().idleMinutes
      if (runner.alive && !runner.busy && minutes > 0) {
        this.idleTimers.set(
          id,
          setTimeout(() => {
            this.idleTimers.delete(id)
            if (!runner.busy) runner.close()
          }, minutes * 60_000)
        )
      }
      if (runner.alive && Date.now() - this.usageAt > USAGE_EVERY_MS) {
        this.usageAt = Date.now()
        void runner.usage().then((raw) => this.readUsage(raw))
      }
    }
    this.readConfig()
    if (!this.busy()) this.events.quiet()
  }

  private readUsage(raw: unknown): void {
    if (!isObj(raw) || raw.rate_limits_available === false) return
    const usage = usageFromRateLimits(raw.rate_limits, Date.now())
    if (!usage) return
    this.usageInfo = { ...usage, status: this.usageInfo?.status ?? null }
    this.events.event({ type: 'usage', usage: this.usageInfo })
  }

  /**
   * Your plan's usage, fresh: from a running session's process when there is
   * one, else from one asked just that (runner.ts › askUsage). At launch, when
   * you come back to Gloom, and as the usage panel opens: at most every
   * `maxAge` (five minutes unless the panel asks for fresher). Only once
   * you're known to be signed in.
   */
  async refreshUsage(maxAge = USAGE_EVERY_MS): Promise<void> {
    if (!this.accountInfo || Date.now() - this.usageAt < maxAge) return
    this.usageAt = Date.now()
    const alive = [...this.runners.values()].find((r) => r.alive)
    const raw = await (alive ? alive.usage() : askUsage()).catch(() => null)
    this.readUsage(raw)
  }

  /** Every turn says whether your plan's limit let it through, and when the window resets. */
  private rateLimit(info: Record<string, unknown>): void {
    const status = info.status === 'rejected' ? 'rejected' : info.status === 'allowed_warning' ? 'warning' : 'allowed'
    const resetsAt = num(info.resetsAt)
    const base: UsageInfo = this.usageInfo ?? { fiveHour: null, weekly: null, status: null, updated: Date.now() }
    const window = info.rateLimitType === 'five_hour' ? 'fiveHour' : info.rateLimitType === 'seven_day' ? 'weekly' : null
    const next: UsageInfo = { ...base, status, updated: Date.now() }
    if (window && resetsAt) next[window] = { percent: base[window]?.percent ?? null, resetsAt: resetsAt * 1000 }
    if (JSON.stringify(next) === JSON.stringify(this.usageInfo)) return
    this.usageInfo = next
    this.events.event({ type: 'usage', usage: next })
  }
}
