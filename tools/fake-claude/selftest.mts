// npm run fake-claude:test [-- <fixture> ...]
// Drives the real Agent SDK against fake-claude.mjs for each fixture, repeating
// the recorded inputs (prompts, control calls, permission answers), and checks
// the SDK yields the same messages the real CLI produced.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(here, 'fixtures')
const fake = join(here, 'fake-claude.mjs')
// Lines the SDK consumes itself instead of yielding.
const internal = new Set(['control_request', 'control_response', 'control_cancel_request', 'keep_alive'])

type Event = { t: number; dir: string; msg?: any; args?: string[] }

function segmentsOf(name: string): Event[][] {
  const segments: Event[][] = []
  for (const line of readFileSync(join(fixturesDir, `${name}.jsonl`), 'utf8').split('\n')) {
    if (!line) continue
    const e: Event = JSON.parse(line)
    if (e.dir === 'spawn') segments.push([e])
    else segments.at(-1)?.push(e)
  }
  return segments
}

const key = (m: any) => (m.type === 'stream_event' ? `stream_event/${m.event?.type}` : `${m.type}${m.subtype ? '/' + m.subtype : ''}`)

async function replay(name: string, index: number, segment: Event[]) {
  const spawnArgs = segment[0].args ?? []
  const events = segment.slice(1)
  // The SDK also keeps frames marked sdk_host_only (newer CLIs' session_state_changed) to itself.
  const expected = events
    .filter((e) => e.dir === 'out' && e.msg && !internal.has(e.msg.type) && e.msg.sdk_host_only !== true)
    .map((e) => key(e.msg))
  // A CLI that quit on its own with an error surfaces as a thrown error from the SDK.
  const exitAt = events.findIndex((e) => e.dir === 'exit')
  const endAt = events.findIndex((e) => e.dir === 'in-end')
  if (exitAt >= 0 && (events[exitAt] as any).code && (endAt < 0 || endAt > exitAt)) expected.push('error')
  // Permission answers the SDK host gave, by the CLI's request_id.
  const answers = new Map<string, any>()
  for (const e of events)
    if (e.dir === 'in' && e.msg?.type === 'control_response' && e.msg.response?.request_id) answers.set(e.msg.response.request_id, e.msg.response.response)

  const inputs: SDKUserMessage[] = []
  let waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  let closed = false
  const inbox: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        inputs.length
          ? Promise.resolve({ value: inputs.shift()!, done: false })
          : closed
            ? Promise.resolve({ value: undefined, done: true })
            : new Promise<IteratorResult<SDKUserMessage>>((resolve) => (waiting = resolve))
    })
  }
  const settle = (r: IteratorResult<SDKUserMessage>) => {
    const w = waiting
    waiting = null
    w?.(r)
  }
  const send = (m: SDKUserMessage) => (waiting ? settle({ value: m, done: false }) : inputs.push(m))
  const close = () => {
    closed = true
    settle({ value: undefined, done: true })
  }

  const flag = (f: string) => spawnArgs.find((a) => a.startsWith(`--${f}=`))?.split('=').slice(1).join('=')
  const options: Options = {
    pathToClaudeCodeExecutable: fake,
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: name, FAKE_CLAUDE_SPEED: '0', FAKE_CLAUDE_SPAWN: String(index) },
    includePartialMessages: spawnArgs.includes('--include-partial-messages'),
    canUseTool: spawnArgs.some((a) => a.includes('permission-prompt-tool'))
      ? async (_tool, input, opts) => answers.get(opts.requestId) ?? { behavior: 'allow', updatedInput: input }
      : undefined,
    model: flag('model')
  }
  const q = query({ prompt: inbox, options })
  const got: SDKMessage[] = []
  // Catch inside: a rejection left unawaited until the end would crash node.
  const done = (async () => {
    try {
      for await (const m of q) got.push(m)
    } catch {
      got.push({ type: 'error' } as any)
    }
  })()
  const quiet = async () => {
    let n = -1
    while (n !== got.length) {
      n = got.length
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  for (const e of events) {
    if (e.dir === 'in' && e.msg?.type === 'user') {
      await quiet()
      send({ ...e.msg })
    } else if (e.dir === 'in' && e.msg?.type === 'control_request') {
      const r = e.msg.request
      await quiet()
      if (r.subtype === 'interrupt') await q.interrupt()
      else if (r.subtype === 'set_permission_mode') await q.setPermissionMode(r.mode)
      else if (r.subtype === 'set_model') await q.setModel(r.model)
      else if (r.subtype === 'apply_flag_settings') await q.applyFlagSettings(r.settings)
      else if (r.subtype === 'rewind_files') await q.rewindFiles(r.user_message_id, { dryRun: r.dry_run }).catch(() => {})
      else if (r.subtype === 'get_context_usage') await q.getContextUsage({ detail: r.detail }).catch(() => {})
      else if (r.subtype === 'get_usage')
        await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: r.skip_behaviors }).catch(() => {})
      // initialize and anything else the SDK sends on its own
    } else if (e.dir === 'in-end') {
      await quiet()
      close()
    }
  }
  if (!closed) {
    await quiet()
    close()
  }
  await done
  const actual = got.map(key)
  const same = actual.length === expected.length && actual.every((k, i) => k === expected[i])
  return { name, index, same, expected: expected.length, actual: actual.length, firstDiff: same ? null : firstDiff(expected, actual) }
}

function firstDiff(a: string[], b: string[]) {
  const i = a.findIndex((k, j) => k !== b[j])
  const at = i < 0 ? Math.min(a.length, b.length) : i
  return { at, expected: a.slice(at, at + 3), actual: b.slice(at, at + 3) }
}

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(fixturesDir).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''))
let failed = 0
for (const name of names) {
  const segments = segmentsOf(name)
  for (let i = 0; i < segments.length; i++) {
    const r = await replay(name, i, segments[i])
    if (!r.same) failed++
    console.log(`${r.same ? 'ok  ' : 'FAIL'} ${name}#${i}  ${r.actual}/${r.expected} messages${r.firstDiff ? '  ' + JSON.stringify(r.firstDiff) : ''}`)
  }
}
process.exit(failed ? 1 : 0)
