// Builds a transcript the way Claude Code writes one, entry by entry, for the
// viewer's tests and screenshots: prompts, replies one line per block, tool
// calls with their results (parallel ones on side branches, as the CLI links
// them), compactions, rewinds, and the bookkeeping lines around them.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { projectDirName } from './transcripts'

type Entry = Record<string, unknown>

export interface ToolCall {
  name: string
  input: Record<string, unknown>
  /** What the model saw: a string, or blocks (text, image). */
  content: string | Entry[]
  isError?: boolean
  /** The tool's own report (structuredPatch, stdout…). */
  report?: Entry
}

export class ChatBuilder {
  readonly lines: Entry[] = []
  /** The newest entry on the chain: what the next one hangs off. */
  parent: string | null = null
  private n = 0
  private t: number
  private message = 0

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
    start = '2026-10-30T09:00:00.000Z'
  ) {
    this.t = Date.parse(start)
  }

  private uuid(): string {
    return `${this.sessionId.slice(0, 8)}-0000-4000-8000-${String(++this.n).padStart(12, '0')}`
  }

  /** A chain entry, hung off the current parent unless told otherwise. */
  private add(type: string, extra: Entry, parent: string | null = this.parent, chain = true): string {
    const uuid = this.uuid()
    this.lines.push({
      parentUuid: parent,
      isSidechain: false,
      type,
      ...extra,
      uuid,
      timestamp: new Date(this.t).toISOString(),
      userType: 'external',
      entrypoint: 'claude-desktop',
      cwd: this.cwd,
      sessionId: this.sessionId,
      version: '2.1.314',
      gitBranch: 'main'
    })
    if (chain) this.parent = uuid
    return uuid
  }

  /** Lets time pass. */
  wait(seconds: number): this {
    this.t += seconds * 1000
    return this
  }

  /** A line that isn't part of the conversation (titles, snapshots…); like the CLI's, it leads with its type. */
  meta(entry: Entry): this {
    this.lines.push({ ...entry, sessionId: this.sessionId })
    return this
  }

  prompt(content: string | Entry[], extra: Entry = {}): string {
    this.lines.push({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(this.t).toISOString(), sessionId: this.sessionId, content: typeof content === 'string' ? content : '' })
    const uuid = this.add('user', { promptId: `p${this.n}`, message: { role: 'user', content }, origin: { kind: 'human' }, ...extra })
    this.meta({ type: 'last-prompt', lastPrompt: typeof content === 'string' ? content : 'Images', leafUuid: uuid })
    return uuid
  }

  private assistant(block: Entry, extra: Entry = {}, model = 'claude-opus-5-5'): string {
    return this.add('assistant', {
      requestId: `req_${this.message}`,
      message: { id: `msg_${this.message}`, type: 'message', role: 'assistant', model, content: [block], stop_reason: null, usage: { input_tokens: 10, output_tokens: 10 } },
      ...extra
    })
  }

  /** Starts a new API response: the blocks that follow share its message ID. */
  respond(): this {
    this.message++
    return this
  }

  thinking(text: string, ms?: number): this {
    this.assistant({ type: 'thinking', thinking: text, signature: 'sig' }, ms ? { thinkingDurationMs: ms } : {})
    return this
  }

  text(markdown: string, model?: string): this {
    this.assistant({ type: 'text', text: markdown }, {}, model)
    return this
  }

  /** One tool call and its result, the result on the chain. */
  tool(call: ToolCall): string {
    const id = `toolu_${this.sessionId.slice(0, 4)}${String(this.n + 1).padStart(6, '0')}`
    const use = this.assistant({ type: 'tool_use', id, name: call.name, input: call.input })
    this.wait(1)
    this.result(id, call, use)
    return id
  }

  private result(id: string, call: ToolCall, use: string, parent: string | null = this.parent, chain = true): void {
    this.add(
      'user',
      {
        message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: call.content, ...(call.isError ? { is_error: true } : {}) }] },
        toolUseResult: call.report ?? (typeof call.content === 'string' ? call.content : {}),
        sourceToolAssistantUUID: use
      },
      parent,
      chain
    )
  }

  /**
   * Calls made together: the CLI chains their tool_use blocks, then hangs each
   * result off its own call, so only the last result is on the main chain.
   */
  parallel(calls: ToolCall[]): this {
    const made = calls.map((call) => {
      const id = `toolu_${this.sessionId.slice(0, 4)}${String(this.n + 1).padStart(6, '0')}`
      const use = this.assistant({ type: 'tool_use', id, name: call.name, input: call.input })
      return { id, use, call }
    })
    this.wait(2)
    made.forEach(({ id, use, call }, i) => this.result(id, call, use, use, i === made.length - 1))
    return this
  }

  /** A turn's end, as the CLI marks it. */
  stop(): this {
    this.add('system', { subtype: 'stop_hook_summary', hookCount: 0, hookInfos: [], hookErrors: [], preventedContinuation: false, stopReason: '', hasOutput: false, level: 'suggestion' })
    return this
  }

  /** Context the model gets that the chat doesn't show. */
  attachment(attachment: Entry): this {
    this.add('attachment', { attachment })
    return this
  }

  interrupted(forTool = false): this {
    this.add('user', { message: { role: 'user', content: [{ type: 'text', text: forTool ? '[Request interrupted by user for tool use]' : '[Request interrupted by user]' }] } })
    return this
  }

  apiError(status: number, attempt: number, max: number): this {
    this.add('system', { subtype: 'api_error', level: 'error', error: JSON.stringify({ message: `${status} {"type":"error"}` }), retryInMs: 1000, retryAttempt: attempt, maxRetries: max })
    return this
  }

  command(name: string, args: string, stdout: string): this {
    this.add('user', { isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat: run directly in Claude Code.</local-command-caveat>' } })
    this.add('user', { message: { role: 'user', content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>` } })
    this.add('user', { message: { role: 'user', content: `<local-command-stdout>${stdout}</local-command-stdout>` } })
    return this
  }

  taskNotification(summary: string, status = 'completed'): this {
    this.add('user', {
      message: { role: 'user', content: `<task-notification>\n<task-id>b1</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>` },
      origin: { kind: 'task-notification' }
    })
    return this
  }

  /** Compacts: a boundary that starts the chain afresh, then the summary Claude carries on from. */
  compact(summary: string, preTokens = 180_000): this {
    const before = this.parent
    this.add('system', { subtype: 'compact_boundary', content: 'Conversation compacted', level: 'info', logicalParentUuid: before, compactMetadata: { trigger: 'auto', preTokens } }, null)
    this.add('user', { message: { role: 'user', content: `This session is being continued from a previous conversation.\n\nSummary:\n${summary}` }, isCompactSummary: true, isVisibleInTranscriptOnly: true })
    return this
  }

  /** Goes back to an earlier entry, as a rewind or an edited message does: what follows branches from there. */
  rewindTo(uuid: string): this {
    this.parent = uuid
    return this
  }

  title(customTitle: string): this {
    return this.meta({ type: 'custom-title', customTitle })
  }

  toString(): string {
    return this.lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  }

  /** Writes it where Claude Code would; returns the path. */
  write(projectsDir: string): string {
    const dir = join(projectsDir, projectDirName(this.cwd))
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${this.sessionId}.jsonl`)
    writeFileSync(file, this.toString())
    return file
  }
}

/** A PNG of the given size, coloured by `paint(x, y)` → [r, g, b], base64-encoded. */
export function pngBase64(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): string {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 3 + 1) + 1 + x * 3)
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'ascii')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0)
    return Buffer.concat([head, data, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  return png.toString('base64')
}

/** An image block, as Claude Code stores a screenshot or a pasted picture. */
export function imageBlock(data: string): Entry {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
}
