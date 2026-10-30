#!/usr/bin/env node
// Fake `claude` for UI work and tests: replays a stream recorded by the Phase 0
// spike (tools/sdk-spike) so the Agent SDK sees the same bytes the real CLI
// sent, without spending usage.
//
//   FAKE_CLAUDE_FIXTURE  fixture name (tools/fake-claude/fixtures/<name>.jsonl) or a path
//   FAKE_CLAUDE_SPEED    1 = recorded timing (default), 0 = as fast as possible, 2 = twice as slow
//   FAKE_CLAUDE_SPAWN    which recorded process to replay when a fixture holds several (0-based);
//                        by default the first whose use of --resume matches this launch
//
// Point the SDK at it with `pathToClaudeCodeExecutable: '<repo>/tools/fake-claude/fake-claude.mjs'`;
// the SDK runs .mjs paths with node. Inputs are matched by kind (a user message, a
// control request of the same subtype), never by content, so any prompt replays
// the next recorded turn. Prompts past the end of the recording get a canned reply.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const speed = Number(process.env.FAKE_CLAUDE_SPEED ?? '1')

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write('0.0.0 (fake claude)\n')
  process.exit(0)
}

const fixtureArg = process.env.FAKE_CLAUDE_FIXTURE
if (!fixtureArg) fail('FAKE_CLAUDE_FIXTURE is not set')
const fixturePath =
  isAbsolute(fixtureArg) || existsSync(fixtureArg) ? fixtureArg : join(here, 'fixtures', `${fixtureArg.replace(/\.jsonl$/, '')}.jsonl`)
if (!existsSync(fixturePath)) fail(`fixture not found: ${fixturePath}`)

// A fixture may hold several processes (a check that resumes); pick one.
const segments = []
for (const line of readFileSync(fixturePath, 'utf8').split('\n')) {
  if (!line) continue
  const e = JSON.parse(line)
  if (e.dir === 'spawn') segments.push({ args: e.args, events: [] })
  else segments.at(-1)?.events.push(e)
}
if (segments.length === 0) fail(`no recorded process in ${fixturePath}`)
const flagValue = (list, flag) => {
  const i = list.findIndex((a) => a === flag || a.startsWith(flag + '='))
  if (i < 0) return undefined
  return list[i].includes('=') ? list[i].slice(flag.length + 1) : list[i + 1]
}
const resuming = flagValue(args, '--resume') !== undefined
let segmentIndex = Number(process.env.FAKE_CLAUDE_SPAWN ?? NaN)
if (Number.isNaN(segmentIndex)) segmentIndex = Math.max(0, segments.findIndex((s) => (flagValue(s.args, '--resume') !== undefined) === resuming))
const script = segments[segmentIndex]?.events ?? fail(`fixture has no process #${segmentIndex}`)
let cursor = 0

// ---------------------------------------------------------------------------
// Input: lines from the SDK, waiting to be matched against the recording.

const pending = []
let stdinEnded = false
let wake = null
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  // A control request the rest of the recording never answers would leave the SDK waiting.
  const answered = script
    .slice(cursor)
    .some((e) => e.dir === 'in' && e.msg?.type === 'control_request' && e.msg.request?.subtype === msg.request?.subtype)
  if (msg.type === 'control_request' && !answered) {
    send({ type: 'control_response', response: { subtype: 'error', request_id: msg.request_id, error: `fake claude: no recorded answer for ${msg.request?.subtype}` } })
    return
  }
  pending.push(msg)
  wake?.()
})
rl.on('close', () => {
  stdinEnded = true
  wake?.()
})

const sameKind = (recorded, actual) =>
  recorded?.type === actual?.type && (recorded.type !== 'control_request' || recorded.request?.subtype === actual.request?.subtype)

/** The SDK's stand-in for a recorded input, or null once stdin has closed. */
async function expect(recorded) {
  for (;;) {
    const i = pending.findIndex((m) => sameKind(recorded, m))
    if (i >= 0) return pending.splice(i, 1)[0]
    if (stdinEnded) return null
    await new Promise((resolve) => (wake = resolve))
    wake = null
  }
}

// ---------------------------------------------------------------------------
// Output: recorded lines, with the ids this SDK chose swapped in.

const ids = new Map() // recorded request_id / user uuid → this run's
function remap(value) {
  if (ids.size === 0) return value
  let text = JSON.stringify(value)
  for (const [from, to] of ids) text = text.split(from).join(to)
  return JSON.parse(text)
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

let lastT = 0
let lastInit = null
let exitCode = 0

replay: for (; cursor < script.length; cursor++) {
  const e = script[cursor]
  if (speed > 0 && e.t > lastT) await new Promise((r) => setTimeout(r, (e.t - lastT) * speed))
  lastT = e.t
  switch (e.dir) {
    case 'out': {
      const msg = remap(e.msg)
      if (msg?.type === 'system' && msg.subtype === 'init') lastInit = msg
      send(msg)
      break
    }
    case 'err':
      process.stderr.write(e.text)
      break
    case 'in': {
      const actual = await expect(e.msg)
      if (!actual) break replay
      if (e.msg.type === 'control_request' && e.msg.request_id && actual.request_id) ids.set(e.msg.request_id, actual.request_id)
      if (e.msg.type === 'user' && e.msg.uuid && actual.uuid) ids.set(e.msg.uuid, actual.uuid)
      break
    }
    case 'in-end':
      // The SDK closed stdin here; anything it still sends gets the canned turn.
      await answerLeftovers()
      break
    case 'exit':
      // Exit without 'in-end' first means the CLI quit on its own (a startup failure).
      exitCode = e.code ?? 0
      break replay
  }
}
if (cursor >= script.length || script[cursor]?.dir !== 'exit') await answerLeftovers()
await new Promise((resolve) => process.stdout.write('', resolve))
process.exit(exitCode)

/** Answers prompts sent past the end of the recording until stdin closes. */
async function answerLeftovers() {
  for (;;) {
    const next = await expect({ type: 'user' })
    if (!next) return
    const sessionId = lastInit?.session_id ?? '00000000-0000-4000-8000-000000000000'
    const text = 'The recorded conversation has ended (fake claude).'
    if (lastInit) send({ ...lastInit, uuid: crypto.randomUUID() })
    send({
      type: 'assistant',
      message: {
        id: `msg_fake_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: lastInit?.model ?? 'fake',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      },
      parent_tool_use_id: null,
      session_id: sessionId,
      uuid: crypto.randomUUID()
    })
    send({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1,
      duration_api_ms: 0,
      num_turns: 1,
      result: text,
      session_id: sessionId,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: crypto.randomUUID()
    })
  }
}

function fail(message) {
  process.stderr.write(`fake claude: ${message}\n`)
  process.exit(2)
}
