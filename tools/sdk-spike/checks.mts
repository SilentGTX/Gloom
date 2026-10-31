// Phase 0 checks. Each one drives the real claude.exe through the Agent SDK,
// records the raw stream as a fixture, and returns what it learned.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  type Options,
  type PermissionResult,
  type SDKMessage
} from '@anthropic-ai/claude-agent-sdk'
import { baseOptions, fixtureFile, Inbox, projectDirFor, Pump, sandbox, sandboxRoot, textOf } from './lib.mts'

type Findings = Record<string, unknown>
type Check = () => Promise<Findings>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isInit = (m: SDKMessage) => m.type === 'system' && (m as any).subtype === 'init'
const isTextDelta = (m: SDKMessage) =>
  m.type === 'stream_event' && (m as any).event?.type === 'content_block_delta' && (m as any).event?.delta?.type === 'text_delta'

/** type/subtype histogram of everything a pump saw. */
function histogram(messages: SDKMessage[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of messages) {
    const key = m.type === 'stream_event' ? `stream_event/${(m as any).event?.type}` : `${m.type}${(m as any).subtype ? '/' + (m as any).subtype : ''}`
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

function lastAssistantText(messages: SDKMessage[]): string {
  const texts = messages.filter((m) => m.type === 'assistant').map(textOf).filter(Boolean)
  return texts.at(-1) ?? ''
}

function briefResult(r: any) {
  if (!r) return null
  return {
    subtype: r.subtype,
    is_error: r.is_error,
    result: typeof r.result === 'string' ? r.result.slice(0, 300) : r.result,
    errors: r.errors,
    terminal_reason: r.terminal_reason,
    num_turns: r.num_turns,
    duration_ms: r.duration_ms,
    duration_api_ms: r.duration_api_ms,
    total_cost_usd: r.total_cost_usd,
    usage: r.usage,
    modelUsage: r.modelUsage,
    permission_denials: r.permission_denials
  }
}

function initSummary(init: any) {
  if (!init) return null
  return {
    session_id: init.session_id,
    claude_code_version: init.claude_code_version,
    cwd: init.cwd,
    model: init.model,
    permissionMode: init.permissionMode,
    effort: init.effort,
    apiKeySource: init.apiKeySource,
    tools: init.tools,
    mcp_servers: init.mcp_servers,
    slash_commands_count: init.slash_commands?.length,
    slash_commands: init.slash_commands,
    skills: init.skills,
    plugins: init.plugins?.map((p: any) => p.name),
    output_style: init.output_style,
    capabilities: init.capabilities,
    view_mode: init.view_mode
  }
}

/** Reads a transcript file and lists its entries' types and tree links. */
export function readTranscript(cwd: string, sessionId: string) {
  const file = join(projectDirFor(cwd), `${sessionId}.jsonl`)
  if (!existsSync(file)) return { file, exists: false }
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const entries = lines.map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return { unparsable: l.slice(0, 100) }
    }
  })
  return {
    file,
    exists: true,
    types: entries.reduce<Record<string, number>>((acc, e) => {
      const k = e.type ?? 'unknown'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {}),
    entries: entries.map((e) => ({
      type: e.type,
      subtype: e.subtype,
      uuid: e.uuid,
      parentUuid: e.parentUuid,
      sessionId: e.sessionId,
      isSidechain: e.isSidechain,
      entrypoint: e.entrypoint,
      version: e.version,
      cwd: e.cwd,
      promptId: e.promptId,
      role: e.message?.role,
      text:
        typeof e.message?.content === 'string'
          ? e.message.content.slice(0, 80)
          : Array.isArray(e.message?.content)
            ? e.message.content.map((b: any) => b.type + (b.text ? ':' + b.text.slice(0, 60) : b.name ? ':' + b.name : '')).join(' | ')
            : undefined,
      title: e.title ?? e.customTitle ?? e.aiTitle ?? e.summary,
      lastPrompt: e.lastPrompt,
      keys: Object.keys(e).join(',')
    }))
  }
}

// ---------------------------------------------------------------------------

const smoke: Check = async () => {
  const dir = sandbox('smoke')
  const inbox = new Inbox()
  const t0 = performance.now()
  const ms = () => Math.round(performance.now() - t0)
  const q = query({ prompt: inbox, options: baseOptions('smoke', { cwd: dir }) })
  const pump = new Pump(q, true)
  const init = await q.initializationResult()
  const tReady = ms()
  const sent = ms()
  inbox.send('Reply with exactly the word: pong')
  const result = await pump.result()
  const initMsg = pump.messages.find(isInit)
  const tInit = pump.timeOf(isInit, t0)
  const tFirstToken = pump.timeOf(isTextDelta, t0)
  const tResult = ms()

  const models = await q.supportedModels()
  const commands = await q.supportedCommands()
  let context: unknown, usage: unknown
  try {
    context = await q.getContextUsage({ detail: 'summary' })
  } catch (e) {
    context = { error: String(e) }
  }
  try {
    usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
  } catch (e) {
    usage = { error: String(e) }
  }
  inbox.close()
  await pump.done

  const { account, ...initRest } = init as any
  return {
    timingsMs: { ready: tReady, sentAt: sent, initMessage: tInit, firstToken: tFirstToken, result: tResult },
    reply: lastAssistantText(pump.messages),
    init: initSummary(initMsg),
    initializationResult: { ...initRest, accountKeys: account ? Object.keys(account) : null },
    models,
    commands: commands.map((c: any) => ({ name: c.name, description: c.description?.slice(0, 80), argumentHint: c.argumentHint })),
    result: briefResult(result),
    contextUsage: context,
    usage,
    rateLimitEvents: pump.messages.filter((m) => m.type === 'rate_limit_event'),
    histogram: histogram(pump.messages),
    transcript: readTranscript(dir, (initMsg as any)?.session_id)
  }
}

const twoTurns: Check = async () => {
  const dir = sandbox('two-turns')
  const inbox = new Inbox()
  const spawns: number[] = []
  const q = query({ prompt: inbox, options: baseOptions('two-turns', { cwd: dir }) })
  const pump = new Pump(q, true)
  inbox.send("Remember the word 'kiwi'. Reply with just: OK")
  const r1 = await pump.result()
  pump.mark()
  inbox.send('What word did I ask you to remember? Reply with just the word.')
  const r2 = await pump.result()
  inbox.close()
  await pump.done
  const inits = pump.messages.filter(isInit) as any[]
  return {
    sameSession: r1.session_id === r2.session_id,
    sessionId: r1.session_id,
    initsSeen: inits.length,
    initSessionIds: inits.map((i) => i.session_id),
    answer: textOf(pump.messages.filter((m) => m.type === 'assistant').at(-1)!),
    spawnEvents: countSpawns('two-turns'),
    results: [briefResult(r1), briefResult(r2)],
    histogram: histogram(pump.messages)
  }
}

const interrupt: Check = async () => {
  const dir = sandbox('interrupt')
  const inbox = new Inbox()
  const q = query({ prompt: inbox, options: baseOptions('interrupt', { cwd: dir }) })
  const pump = new Pump(q, true)
  inbox.send('Count from 1 to 400, one number per line. No other text.')
  await pump.waitFor(isTextDelta)
  await sleep(800)
  pump.mark()
  const before = pump.messages.length
  const t = performance.now()
  const receipt = await q.interrupt()
  const r1 = await pump.result()
  const stopMs = Math.round(performance.now() - t)
  const afterInterrupt = pump.messages.slice(before).filter((m) => m.type !== 'stream_event')
  pump.mark()
  inbox.send('Reply with exactly: still here')
  const r2 = await pump.result()
  inbox.close()
  await pump.done
  return {
    receipt,
    stopMs,
    resultAfterInterrupt: briefResult(r1),
    messagesAfterInterrupt: afterInterrupt.map((m) => ({ type: m.type, subtype: (m as any).subtype, text: textOf(m).slice(0, 120), content: m.type === 'user' ? JSON.stringify((m as any).message?.content).slice(0, 200) : undefined })),
    secondTurn: { reply: lastAssistantText(pump.messages), result: briefResult(r2) },
    spawnEvents: countSpawns('interrupt'),
    histogram: histogram(pump.messages),
    transcript: readTranscript(dir, r1.session_id)
  }
}

const queue: Check = async () => {
  const dir = sandbox('queue')
  const inbox = new Inbox()
  const q = query({ prompt: inbox, options: baseOptions('queue', { cwd: dir }) })
  const pump = new Pump(q, true)
  inbox.send('Count from 1 to 120, one number per line. No other text.')
  await pump.waitFor(isTextDelta)
  await sleep(500)
  inbox.send('Reply with exactly: queued message seen')
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const results = pump.messages.filter((m) => m.type === 'result').length
    const idle = pump.messages.filter((m) => (m as any).subtype === 'session_state_changed' && (m as any).state === 'idle').length
    if (results >= 2 || (results >= 1 && idle >= 1 && Date.now() > deadline - 80_000)) break
    await sleep(250)
  }
  await sleep(1500)
  inbox.close()
  await pump.done
  const sequence = pump.messages
    .filter((m) => m.type !== 'stream_event')
    .map((m) => ({
      type: m.type,
      subtype: (m as any).subtype,
      state: (m as any).state,
      text: textOf(m).slice(0, 80),
      user: m.type === 'user' ? JSON.stringify((m as any).message?.content).slice(0, 120) : undefined
    }))
  const sid = (pump.messages.find(isInit) as any)?.session_id
  return { sequence, histogram: histogram(pump.messages), transcript: sid ? readTranscript(dir, sid) : null }
}

const resume: Check = async () => {
  const dir = sandbox('resume', { fresh: true })
  const inbox1 = new Inbox()
  const pump1 = new Pump(query({ prompt: inbox1, options: baseOptions('resume-1', { cwd: dir }) }), true)
  inbox1.send('Remember the number 4127. Reply with just: OK')
  const r1 = await pump1.result()
  inbox1.close()
  await pump1.done
  const sid = r1.session_id

  const inbox2 = new Inbox()
  const t = performance.now()
  const pump2 = new Pump(query({ prompt: inbox2, options: baseOptions('resume-2', { cwd: dir, resume: sid }) }), true)
  inbox2.send('What number did I ask you to remember? Reply with just the number.')
  const init2 = (await pump2.waitFor(isInit)) as any
  const r2 = await pump2.result()
  const resumeMs = Math.round(performance.now() - t)
  inbox2.close()
  await pump2.done

  const files = readdirSync(projectDirFor(dir)).filter((f) => f.endsWith('.jsonl'))
  return {
    firstSessionId: sid,
    resumedInitSessionId: init2.session_id,
    resultSessionId: r2.session_id,
    keepsId: init2.session_id === sid && r2.session_id === sid,
    answer: lastAssistantText(pump2.messages),
    resumeToResultMs: resumeMs,
    projectFiles: files,
    transcript: readTranscript(dir, sid)
  }
}

const permission: Check = async () => {
  const dir = sandbox('permission', { fresh: true })
  const calls: any[] = []
  const canUseTool: Options['canUseTool'] = async (toolName, input, opts) => {
    calls.push({
      toolName,
      input,
      suggestions: opts.suggestions,
      decisionReason: opts.decisionReason,
      title: opts.title,
      displayName: opts.displayName,
      description: opts.description,
      blockedPath: opts.blockedPath,
      defaultToNo: opts.defaultToNo,
      suppressAlwaysAllowRule: opts.suppressAlwaysAllowRule,
      toolUseID: opts.toolUseID,
      requestId: opts.requestId
    })
    const shellCalls = calls.filter((c) => c.toolName === 'Bash' || c.toolName === 'PowerShell').length
    let answer: PermissionResult
    if (toolName === 'Write' || toolName === 'Edit') answer = { behavior: 'allow', updatedInput: input }
    else if ((toolName === 'Bash' || toolName === 'PowerShell') && shellCalls === 1)
      answer = { behavior: 'allow', updatedInput: input, updatedPermissions: opts.suggestions ?? [] }
    else answer = { behavior: 'deny', message: 'Denied by the Gloom spike.' }
    calls.at(-1).answer = answer.behavior + (answer.behavior === 'allow' && answer.updatedPermissions ? ' (always)' : '')
    return answer
  }
  const inbox = new Inbox()
  const pump = new Pump(query({ prompt: inbox, options: baseOptions('permission', { cwd: dir, permissionMode: 'default', canUseTool }) }), true)
  inbox.send(
    'Do these steps in order, one tool call at a time: ' +
      '1) Create a file named hello.txt containing exactly: hi ' +
      '2) Run the shell command: mkdir made-by-claude ' +
      '3) Delete hello.txt with a shell command. ' +
      'If a step is denied, stop and tell me which step was denied.'
  )
  const r = await pump.result()
  inbox.close()
  await pump.done
  const localSettings = join(dir, '.claude', 'settings.local.json')
  return {
    calls,
    reply: lastAssistantText(pump.messages),
    result: briefResult(r),
    files: {
      'hello.txt': existsSync(join(dir, 'hello.txt')) ? readFileSync(join(dir, 'hello.txt'), 'utf8') : null,
      'made-by-claude/': existsSync(join(dir, 'made-by-claude')),
      '.claude/settings.local.json': existsSync(localSettings) ? JSON.parse(readFileSync(localSettings, 'utf8')) : null
    },
    histogram: histogram(pump.messages)
  }
}

const plan: Check = async () => {
  const dir = sandbox('plan', { fresh: true })
  const calls: any[] = []
  let exits = 0
  const canUseTool: Options['canUseTool'] = async (toolName, input, opts) => {
    calls.push({ toolName, input, suggestions: opts.suggestions, decisionReason: opts.decisionReason, title: opts.title })
    if (toolName === 'ExitPlanMode') {
      exits++
      if (exits === 1) return { behavior: 'deny', message: 'Keep planning: the file must also have a second line: there' }
      return {
        behavior: 'allow',
        updatedInput: input,
        updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
      }
    }
    if (toolName === 'Write' || toolName === 'Edit') return { behavior: 'allow', updatedInput: input }
    return { behavior: 'deny', message: 'Denied by the Gloom spike.' }
  }
  const inbox = new Inbox()
  const pump = new Pump(query({ prompt: inbox, options: baseOptions('plan', { cwd: dir, permissionMode: 'plan', canUseTool }) }), true)
  inbox.send('Plan how to create a file notes.txt in the current folder containing the line: hi. Keep the plan to two sentences and present it for approval.')
  const r = await pump.result()
  inbox.close()
  await pump.done
  const statusModes = pump.messages
    .filter((m) => (m as any).subtype === 'status' || isInit(m))
    .map((m) => ({ subtype: (m as any).subtype, permissionMode: (m as any).permissionMode, status: (m as any).status }))
  return {
    calls,
    statusModes,
    reply: lastAssistantText(pump.messages),
    notes: existsSync(join(dir, 'notes.txt')) ? readFileSync(join(dir, 'notes.txt'), 'utf8') : null,
    result: briefResult(r),
    histogram: histogram(pump.messages)
  }
}

const question: Check = async () => {
  const dir = sandbox('question')
  const calls: any[] = []
  const canUseTool: Options['canUseTool'] = async (toolName, input, opts) => {
    calls.push({ toolName, input, suggestions: opts.suggestions, title: opts.title })
    if (toolName === 'AskUserQuestion') {
      const questions = (input.questions as any[]) ?? []
      const answers = Object.fromEntries(questions.map((q) => [q.question, q.options?.find((o: any) => /banana/i.test(o.label))?.label ?? 'Banana']))
      return { behavior: 'allow', updatedInput: { ...input, answers } }
    }
    return { behavior: 'deny', message: 'Denied by the Gloom spike.' }
  }
  const inbox = new Inbox()
  const pump = new Pump(query({ prompt: inbox, options: baseOptions('question', { cwd: dir, permissionMode: 'default', canUseTool }) }), true)
  inbox.send('Use the AskUserQuestion tool to ask me which fruit I prefer, with exactly two options: Apple and Banana. After I answer, reply with just the fruit I picked.')
  const r = await pump.result()
  inbox.close()
  await pump.done
  const toolResults = pump.messages
    .filter((m) => m.type === 'user')
    .map((m: any) => ({ content: JSON.stringify(m.message?.content).slice(0, 400), tool_use_result: m.tool_use_result }))
  return {
    toolAvailable: (pump.messages.find(isInit) as any)?.tools?.includes('AskUserQuestion'),
    calls,
    toolResults,
    reply: lastAssistantText(pump.messages),
    result: briefResult(r)
  }
}

const switches: Check = async () => {
  const dir = sandbox('switches')
  const inbox = new Inbox()
  // The stream may not report effort, so keep the CLI's debug log to see what it sent.
  const debugFile = join(dir, 'debug.log')
  rmSync(debugFile, { force: true })
  const q = query({ prompt: inbox, options: baseOptions('switches', { cwd: dir, permissionMode: 'default', model: 'haiku', debugFile }) })
  const pump = new Pump(q, true)
  const turn = async (text: string) => {
    pump.mark()
    const start = pump.messages.length
    inbox.send(text)
    const r = await pump.result()
    const msgs = pump.messages.slice(start)
    const init = msgs.find(isInit) as any
    const assistantModels = [...new Set(msgs.filter((m) => m.type === 'assistant').map((m: any) => m.message?.model))]
    const status = msgs.filter((m) => (m as any).subtype === 'status').map((m: any) => ({ status: m.status, permissionMode: m.permissionMode }))
    return { init: init ? { model: init.model, permissionMode: init.permissionMode, effort: init.effort } : null, assistantModels, status, modelUsage: Object.keys((r as any).modelUsage ?? {}) }
  }
  const t1 = await turn('Reply with exactly: one')
  const errors: string[] = []
  await q.setModel('sonnet').catch((e) => errors.push('setModel: ' + e))
  await q.setPermissionMode('acceptEdits').catch((e) => errors.push('setPermissionMode: ' + e))
  await q.applyFlagSettings({ effortLevel: 'low' }).catch((e) => errors.push('applyFlagSettings low: ' + e))
  const t2 = await turn('Reply with exactly: two')
  await q.applyFlagSettings({ effortLevel: 'high' }).catch((e) => errors.push('applyFlagSettings high: ' + e))
  await q.setModel('haiku').catch((e) => errors.push('setModel back: ' + e))
  await q.setPermissionMode('bypassPermissions').catch((e) => errors.push('setPermissionMode bypass: ' + e))
  const t3 = await turn('Reply with exactly: three')
  inbox.close()
  await pump.done
  const debug = existsSync(debugFile) ? readFileSync(debugFile, 'utf8').split('\n') : []
  return {
    turns: [t1, t2, t3],
    errors,
    debugEffortLines: debug.filter((l) => /effort/i.test(l)).map((l) => l.slice(0, 300)).slice(0, 40),
    debugModeLines: debug.filter((l) => /permission.?mode|setMode|bypass/i.test(l)).map((l) => l.slice(0, 200)).slice(0, 20),
    histogram: histogram(pump.messages)
  }
}

const rewind: Check = async () => {
  const dir = sandbox('rewind', { fresh: true })
  const file = join(dir, 'a.txt')
  writeFileSync(file, 'original\n')
  const inbox = new Inbox()
  const q = query({
    prompt: inbox,
    options: baseOptions('rewind', { cwd: dir, permissionMode: 'acceptEdits', enableFileCheckpointing: true })
  })
  const pump = new Pump(q, true)
  // Checkpoints cover Write/Edit only (as /rewind does), so name the tools: newer models reach for Bash.
  const u1 = inbox.send('Use the Write tool to replace the entire contents of a.txt with the single line: changed once')
  const r1 = await pump.result()
  const turn1Assistant = pump.messages.filter((m) => m.type === 'assistant').at(-1) as any
  const turn1LastEntry = pump.messages.filter((m) => (m.type === 'assistant' || m.type === 'user') && (m as any).uuid).at(-1) as any
  pump.mark()
  const u2 = inbox.send('Use the Edit tool to append a second line to a.txt: changed twice')
  await pump.result()
  const afterTwo = readFileSync(file, 'utf8')
  const dry = await q.rewindFiles(u2.uuid!, { dryRun: true }).catch((e) => ({ error: String(e) }))
  const afterDry = readFileSync(file, 'utf8')
  const real2 = await q.rewindFiles(u2.uuid!).catch((e) => ({ error: String(e) }))
  const afterRewind2 = readFileSync(file, 'utf8')
  const real1 = await q.rewindFiles(u1.uuid!).catch((e) => ({ error: String(e) }))
  const afterRewind1 = readFileSync(file, 'utf8')
  inbox.close()
  await pump.done
  const sid = r1.session_id
  const beforeEdit = readTranscript(dir, sid)

  // "Edit": continue from the end of turn 1, dropping turn 2. --resume-drops-turn
  // validates the cut but older CLIs reject the flag outright, so fall back.
  const runEdit = async (fixture: string, dropsTurn: boolean) => {
    const inbox2 = new Inbox()
    const pump2 = new Pump(
      query({
        prompt: inbox2,
        options: baseOptions(fixture, {
          cwd: dir,
          permissionMode: 'acceptEdits',
          enableFileCheckpointing: true,
          resume: sid,
          resumeSessionAt: turn1LastEntry?.uuid ?? turn1Assistant.uuid,
          ...(dropsTurn ? { resumeDropsTurn: u2.uuid } : {})
        })
      }),
      true
    )
    inbox2.send('List every message I have sent you in this conversation so far, quoted, one per line. Nothing else.')
    const init2 = (await pump2.waitFor(isInit).catch(() => null)) as any
    const rEdit = await pump2.result().catch(() => null)
    inbox2.close()
    await pump2.done
    const stderr = readFileSync(fixtureFile(fixture), 'utf8')
      .split('\n')
      .filter((l) => l.includes('"dir":"err"'))
      .map((l) => JSON.parse(l).text.trim())
    return {
      dropsTurn,
      error: pump2.error ? String(pump2.error) : null,
      stderr,
      initSessionId: init2?.session_id,
      sameSession: init2?.session_id === sid,
      reply: lastAssistantText(pump2.messages),
      result: briefResult(rEdit)
    }
  }
  const editWithGuard = await runEdit('rewind-edit-guarded', true)
  const edit = editWithGuard.error ? await runEdit('rewind-edit', false) : editWithGuard
  return {
    userUuids: { u1: u1.uuid, u2: u2.uuid },
    turn1AssistantUuid: turn1Assistant?.uuid,
    turn1LastEntry: { type: turn1LastEntry?.type, uuid: turn1LastEntry?.uuid },
    file: { afterTwo, afterDry, afterRewind2, afterRewind1 },
    rewindResults: { dry, real2, real1 },
    editWithGuard: editWithGuard === edit ? 'same as edit' : editWithGuard,
    edit,
    transcriptBeforeEdit: beforeEdit,
    transcriptAfterEdit: readTranscript(dir, sid),
    sdkMessagesAfterEdit: await getSessionMessages(sid, { dir }).then((ms) => ms.map((m: any) => ({ type: m.type, uuid: m.uuid, parent: m.parent_tool_use_id, text: JSON.stringify(m.message?.content ?? '').slice(0, 80) })))
  }
}

/** Settles with the promise, or rejects after `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref())])
}

// Phase 6: rewinding code from a process that didn't make the edits (Gloom's
// rewind starts one just for that), and continuing from an earlier message.
const rewindResume: Check = async () => {
  const dir = sandbox('rewind-resume', { fresh: true })
  const file = join(dir, 'a.txt')
  writeFileSync(file, 'original\n')
  const inbox = new Inbox()
  const q = query({ prompt: inbox, options: baseOptions('rewind-resume-a', { cwd: dir, permissionMode: 'acceptEdits', enableFileCheckpointing: true }) })
  const pump = new Pump(q, true)
  const u1 = inbox.send('Use the Write tool to replace the entire contents of a.txt with the single line: changed once')
  const r1 = await pump.result()
  pump.mark()
  const u2 = inbox.send('Use the Edit tool to append a second line to a.txt: changed twice')
  await pump.result()
  const afterTwo = readFileSync(file, 'utf8')
  inbox.close()
  await pump.done
  const sid = r1.session_id

  // A second process, resumed, with no prompt sent: only control requests.
  const inboxB = new Inbox()
  const qB = query({ prompt: inboxB, options: baseOptions('rewind-resume-b', { cwd: dir, permissionMode: 'acceptEdits', enableFileCheckpointing: true, resume: sid }) })
  const pumpB = new Pump(qB, true)
  const started = Date.now()
  const dry = await withTimeout(qB.rewindFiles(u2.uuid!, { dryRun: true }), 60_000).catch((e) => ({ error: String(e) }))
  const dryMs = Date.now() - started
  const real = await withTimeout(qB.rewindFiles(u2.uuid!), 60_000).catch((e) => ({ error: String(e) }))
  const afterRewind = readFileSync(file, 'utf8')
  inboxB.close()
  await pumpB.done

  // A third: continue from the end of turn 1 (u2's parent on the chain), as Gloom's edit does.
  const lines = readTranscript(dir, sid)
  const transcriptFile = (lines as { file: string }).file
  const raw = readFileSync(transcriptFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const u2Line = raw.find((e) => e.uuid === u2.uuid)
  const inboxC = new Inbox()
  const pumpC = new Pump(query({ prompt: inboxC, options: baseOptions('rewind-resume-c', { cwd: dir, permissionMode: 'acceptEdits', enableFileCheckpointing: true, resume: sid, resumeSessionAt: u2Line?.parentUuid }) }), true)
  inboxC.send('List every message I have sent you in this conversation so far, quoted, one per line. Nothing else.')
  const rC = await pumpC.result().catch(() => null)
  inboxC.close()
  await pumpC.done
  return {
    userUuids: { u1: u1.uuid, u2: u2.uuid },
    u2Parent: u2Line ? { uuid: u2Line.parentUuid, type: raw.find((e) => e.uuid === u2Line.parentUuid)?.type } : null,
    file: { afterTwo, afterRewind },
    dry,
    dryMs,
    real,
    messagesB: pumpB.messages.map((m) => m.type),
    errorB: pumpB.error ? String(pumpB.error) : null,
    continued: { error: pumpC.error ? String(pumpC.error) : null, reply: lastAssistantText(pumpC.messages), subtype: rC?.subtype }
  }
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

const worktree: Check = async () => {
  const repo = sandbox('worktree-repo', { fresh: true })
  git(repo, 'init', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), '# spike\n')
  git(repo, 'add', '.')
  git(repo, '-c', 'user.name=Gloom Spike', '-c', 'user.email=spike@example.com', 'commit', '-m', 'init')
  const runs: any[] = []
  for (const name of ['gloom-named', null]) {
    const inbox = new Inbox()
    const fixture = name ? 'worktree-named' : 'worktree-auto'
    const pump = new Pump(
      query({ prompt: inbox, options: baseOptions(fixture, { cwd: repo, permissionMode: 'default', extraArgs: { worktree: name } }) }),
      true
    )
    inbox.send('Reply with exactly: ready')
    let init: any = null
    let r: any = null
    let error: string | null = null
    try {
      init = await pump.waitFor(isInit, 120_000)
      r = await pump.result()
    } catch (e) {
      error = String(e)
    }
    inbox.close()
    await pump.done.catch((e) => (error = (error ?? '') + ' / ' + String(e)))
    runs.push({
      requestedName: name,
      initCwd: init?.cwd,
      sessionId: init?.session_id,
      result: briefResult(r),
      error,
      worktreesAfterExit: git(repo, 'worktree', 'list', '--porcelain'),
      branches: git(repo, 'branch', '-a', '--format=%(refname:short)')
    })
  }
  return { repo, runs, gitignore: existsSync(join(repo, '.gitignore')) ? readFileSync(join(repo, '.gitignore'), 'utf8') : null }
}

const missingCwd: Check = async () => {
  const dir = sandbox('missing-cwd', { fresh: true })
  const inbox = new Inbox()
  const pump = new Pump(query({ prompt: inbox, options: baseOptions('missing-cwd-1', { cwd: dir }) }), true)
  inbox.send('Reply with exactly: ok')
  const r1 = await pump.result()
  inbox.close()
  await pump.done
  const sid = r1.session_id
  rmSync(dir, { recursive: true, force: true })

  const attempt = async (label: string, cwd: string) => {
    const inbox = new Inbox()
    let error: string | null = null
    const messages: any[] = []
    try {
      // The SDK's own launcher, as Gloom will use it, so its cwd handling shows.
      const pump = new Pump(query({ prompt: inbox, options: baseOptions(`missing-cwd-${label}`, { cwd, resume: sid, spawnClaudeCodeProcess: undefined }) }), true)
      inbox.send('What did I ask you to reply with before? Answer in five words or fewer.')
      const r = await Promise.race([pump.result(), pump.done.then(() => null)])
      messages.push(...pump.messages.filter((m) => m.type !== 'stream_event').map((m: any) => ({ type: m.type, subtype: m.subtype, text: textOf(m).slice(0, 120), result: m.type === 'result' ? briefResult(m) : undefined })))
      inbox.close()
      await pump.done
      return { label, cwd, ok: !!r && !(r as any).is_error, messages, error }
    } catch (e) {
      error = String(e)
      inbox.close()
      return { label, cwd, ok: false, messages, error }
    }
  }
  const sameMissing = await attempt('2-missing', dir)
  const elsewhere = await attempt('3-other-dir', sandboxRoot)
  return { sessionId: sid, sameMissing, elsewhere }
}

const transcripts: Check = async () => {
  // Titles and entry types across every session the spike created.
  const all = await listSessions({ includeProgrammatic: true })
  const spike = all.filter((s) => s.cwd?.toLowerCase().startsWith(sandboxRoot.toLowerCase()))
  const visibleToResume = await listSessions({ includeProgrammatic: false })
  const out: any[] = []
  for (const s of spike) {
    const t = readTranscript(s.cwd!, s.sessionId)
    const titleEntries = (t as any).entries?.filter((e: any) => /title|summary|last-prompt/.test(e.type ?? '')) ?? []
    out.push({
      sessionId: s.sessionId,
      cwd: s.cwd,
      summary: s.summary,
      customTitle: s.customTitle,
      firstPrompt: s.firstPrompt,
      createdAt: s.createdAt,
      shownInResumePicker: visibleToResume.some((v) => v.sessionId === s.sessionId),
      types: (t as any).types,
      titleEntries,
      entrypoints: [...new Set(((t as any).entries ?? []).map((e: any) => e.entrypoint).filter(Boolean))]
    })
  }
  const info = spike[0] ? await getSessionInfo(spike[0].sessionId) : null
  return { totalSessionsListed: all.length, totalVisibleToResume: visibleToResume.length, spikeSessions: out, sampleInfo: info }
}

const prewarm: Check = async () => {
  // Cold start versus a pre-warmed process, both measured to the first token.
  const { startup } = await import('@anthropic-ai/claude-agent-sdk')
  const dir = sandbox('prewarm')
  const measure = async (label: string, make: (inbox: Inbox) => ReturnType<typeof query>) => {
    const inbox = new Inbox()
    const t0 = performance.now()
    const pump = new Pump(make(inbox))
    inbox.send('Reply with exactly: warm')
    await pump.waitFor(isTextDelta)
    const firstToken = Math.round(performance.now() - t0)
    await pump.result()
    inbox.close()
    await pump.done
    return { label, firstTokenMs: firstToken }
  }
  const cold = await measure('cold', (inbox) => query({ prompt: inbox, options: baseOptions('prewarm-cold', { cwd: dir }) }))
  const tw = performance.now()
  const warm = await startup({ options: baseOptions('prewarm-warm', { cwd: dir }) })
  const warmupMs = Math.round(performance.now() - tw)
  await sleep(500)
  const hot = await measure('prewarmed', (inbox) => warm.query(inbox))
  return { cold, prewarmed: { ...hot, warmupMs } }
}

const survey: Check = async () => {
  // No CLI needed: what the transcripts already on disk look like, per entrypoint.
  const { homedir } = await import('node:os')
  const { createReadStream, statSync } = await import('node:fs')
  const { createInterface } = await import('node:readline')
  const root = join(homedir(), '.claude', 'projects')
  const typeTotals: Record<string, number> = {}
  const byEntrypoint: Record<string, { files: number; withAiTitle: number; withCustomTitle: number; withLastPrompt: number }> = {}
  const files: any[] = []
  let agentFiles = 0
  let nestedFiles = 0
  const t0 = performance.now()
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const dir = join(root, project.name)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        nestedFiles += readdirSync(join(dir, entry.name), { recursive: true }).filter((f) => String(f).endsWith('.jsonl')).length
        continue
      }
      if (!entry.name.endsWith('.jsonl')) continue
      if (entry.name.startsWith('agent-')) {
        agentFiles++
        continue
      }
      const path = join(dir, entry.name)
      const size = statSync(path).size
      const types: Record<string, number> = {}
      const entrypoints = new Set<string>()
      const versions = new Set<string>()
      const sessionIds = new Set<string>()
      const titles: { type: string; value: string }[] = []
      let cwd: string | undefined
      let sidechain = 0
      const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
      for await (const line of rl) {
        if (!line) continue
        let e: any
        if (line.length < 2_000_000) {
          try {
            e = JSON.parse(line)
          } catch {
            types['<unparsable>'] = (types['<unparsable>'] ?? 0) + 1
            continue
          }
        } else {
          // Huge lines are tool results with images; the header fields come first.
          const head = line.slice(0, 4000)
          e = {
            type: /"type":"([\w-]+)"/.exec(head)?.[1],
            entrypoint: /"entrypoint":"([\w-]+)"/.exec(head)?.[1],
            sessionId: /"sessionId":"([\w-]+)"/.exec(head)?.[1]
          }
        }
        const type = e.type ?? '<none>'
        types[type] = (types[type] ?? 0) + 1
        if (e.entrypoint) entrypoints.add(e.entrypoint)
        if (e.version) versions.add(e.version)
        if (e.sessionId) sessionIds.add(e.sessionId)
        if (e.isSidechain) sidechain++
        if (!cwd && e.cwd) cwd = e.cwd
        if (/title|summary/.test(type)) titles.push({ type, value: String(e.customTitle ?? e.aiTitle ?? e.title ?? e.summary ?? '').slice(0, 80) })
      }
      for (const [k, v] of Object.entries(types)) typeTotals[k] = (typeTotals[k] ?? 0) + v
      const ep = [...entrypoints].join('+') || '<none>'
      const bucket = (byEntrypoint[ep] ??= { files: 0, withAiTitle: 0, withCustomTitle: 0, withLastPrompt: 0 })
      bucket.files++
      if (types['ai-title']) bucket.withAiTitle++
      if (types['custom-title']) bucket.withCustomTitle++
      if (types['last-prompt']) bucket.withLastPrompt++
      files.push({
        project: project.name,
        file: entry.name,
        sizeMB: +(size / 1e6).toFixed(2),
        entrypoints: [...entrypoints],
        versions: [...versions].slice(-3),
        sessionIdsInFile: sessionIds.size,
        sidechainEntries: sidechain,
        cwd,
        titles: titles.slice(-4),
        types
      })
    }
  }
  files.sort((a, b) => b.sizeMB - a.sizeMB)
  return {
    scanMs: Math.round(performance.now() - t0),
    sessionFiles: files.length,
    agentFiles,
    nestedSubagentFiles: nestedFiles,
    totalMB: +files.reduce((s, f) => s + f.sizeMB, 0).toFixed(1),
    typeTotals,
    byEntrypoint,
    files
  }
}

function countSpawns(fixture: string): number {
  const file = fixtureFile(fixture)
  if (!existsSync(file)) return -1
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('"dir":"spawn"')).length
}

export const checks: Record<string, Check> = {
  smoke,
  'two-turns': twoTurns,
  interrupt,
  queue,
  resume,
  permission,
  plan,
  question,
  switches,
  rewind,
  "rewind-resume": rewindResume,
  worktree,
  'missing-cwd': missingCwd,
  prewarm,
  transcripts,
  survey
}
