// A made-up session for the viewer's end-to-end test and screenshots: never
// yours. It has what a real one has: a compaction with history before it,
// parallel reads, an edit and a new file, a failing then passing test run, a
// pasted block, an image, a question, a to-do list, an interruption.
import { ChatBuilder, imageBlock, pngBase64 } from './chat'

export const DEMO_ID = 'eeeeeeee-0000-4000-8000-000000000001'
export const DEMO_TITLE = 'API rate limits'

/** A soft dusk gradient with a chart line across it, standing in for a screenshot. */
function chartPng(): string {
  const w = 360
  const h = 200
  return pngBase64(w, h, (x, y) => {
    const curve = h * 0.62 - Math.sin(x / 34) * 26 - (x > 210 && x < 250 ? 60 : 0)
    if (Math.abs(y - curve) < 2.2) return [91, 91, 214]
    if (y % 40 === 0) return [222, 221, 232]
    const t = y / h
    return [Math.round(246 - 10 * t), Math.round(245 - 14 * t), Math.round(252 - 4 * t)]
  })
}

const SERVER_PATCH = [
  {
    oldStart: 4,
    oldLines: 6,
    newStart: 4,
    newLines: 8,
    lines: [
      " import { routes } from './routes'",
      "+import { rateLimit } from './limits'",
      ' ',
      ' const app = Fastify({ logger: true })',
      "-app.register(routes, { prefix: '/v1' })",
      "+app.register(rateLimit, { perMinute: 100 })",
      "+app.register(routes, { prefix: '/v1' })",
      ' ',
      ' export default app'
    ]
  }
]

const LIMITS = `import type { FastifyPluginAsync } from 'fastify'

/** A sliding window per API key: at most \`perMinute\` requests in any 60 seconds. */
export const rateLimit: FastifyPluginAsync<{ perMinute: number }> = async (app, { perMinute }) => {
  const seen = new Map<string, number[]>()
  app.addHook('onRequest', async (request, reply) => {
    const key = request.headers['x-api-key']
    if (typeof key !== 'string') return
    const now = Date.now()
    const recent = (seen.get(key) ?? []).filter((t) => now - t < 60_000)
    if (recent.length >= perMinute) {
      const retry = Math.ceil((60_000 - (now - recent[0])) / 1000)
      return reply.code(429).header('Retry-After', retry).send({ error: 'Too many requests' })
    }
    recent.push(now)
    seen.set(key, recent)
  })
}
`

export function demoSession(cwd: string, start = new Date(Date.now() - 3 * 3600_000).toISOString()): ChatBuilder {
  const c = new ChatBuilder(DEMO_ID, cwd, start)
  c.title(DEMO_TITLE)

  // Before the compaction: shown by Show Earlier.
  c.prompt('Set up the API project: Fastify, TypeScript, and a health route.')
  c.respond().text('Set up: `GET /health` answers `{ "ok": true }`, and `npm test` runs the route tests.')
  c.wait(40 * 60).compact('Set up a Fastify + TypeScript API with a health route and tests.')

  c.wait(30).prompt('Add rate limiting to the public API: 100 requests a minute per key, and tell clients when they hit the limit.')
  c.respond().thinking('Requests reach the routes through Fastify plugins, so a plugin with an onRequest hook can count per key before any route runs.', 4200)
  c.text('I’ll look at how requests reach the routes first.')
  c.wait(3).parallel([
    { name: 'Read', input: { file_path: `${cwd}\\src\\server.ts` }, content: "     1\timport Fastify from 'fastify'\n     2\timport { routes } from './routes'\n", report: { type: 'text', file: { filePath: `${cwd}\\src\\server.ts`, numLines: 9, startLine: 1, totalLines: 9 } } },
    { name: 'Grep', input: { pattern: 'app.register', path: 'src' }, content: 'src/server.ts\nsrc/routes.ts', report: { mode: 'files_with_matches', numFiles: 2, filenames: ['src/server.ts', 'src/routes.ts'] } }
  ])
  c.wait(8)
    .respond()
    .text(
      [
        'Fastify’s plugins fit this well. The plan:',
        '',
        '1. A **sliding window** per API key, kept in memory.',
        '2. Over the limit, answer `429 Too Many Requests` with a `Retry-After` header.',
        '3. Register it before the routes, so every route is covered.',
        '',
        '```ts',
        "app.register(rateLimit, { perMinute: 100 })",
        '```'
      ].join('\n')
    )
  c.wait(20).tool({ name: 'Write', input: { file_path: `${cwd}\\src\\limits.ts`, content: LIMITS }, content: 'File created successfully.', report: { type: 'create', filePath: `${cwd}\\src\\limits.ts`, content: LIMITS, structuredPatch: [] } })
  c.wait(6).tool({
    name: 'Edit',
    input: { file_path: `${cwd}\\src\\server.ts`, old_string: "app.register(routes, { prefix: '/v1' })", new_string: "app.register(rateLimit, { perMinute: 100 })\napp.register(routes, { prefix: '/v1' })" },
    content: 'The file has been updated.',
    report: { filePath: `${cwd}\\src\\server.ts`, structuredPatch: SERVER_PATCH }
  })
  c.wait(9).tool({
    name: 'Bash',
    input: { command: 'npm test', description: 'Run the route tests' },
    content: 'Exit code 1\n✗ limits › answers 429 after 100 requests\n  expected 429, received 200',
    isError: true,
    report: { stdout: '✗ limits › answers 429 after 100 requests\n  expected 429, received 200', stderr: '', interrupted: false }
  })
  c.wait(12).respond().text('The test sends no `x-api-key` header, so the limiter lets it through. Keys should be required on `/v1`.')
  c.wait(15).tool({
    name: 'Edit',
    input: { file_path: `${cwd}\\src\\limits.ts` },
    content: 'The file has been updated.',
    report: {
      filePath: `${cwd}\\src\\limits.ts`,
      structuredPatch: [{ oldStart: 7, oldLines: 2, newStart: 7, newLines: 2, lines: ["     const key = request.headers['x-api-key']", "-    if (typeof key !== 'string') return", "+    if (typeof key !== 'string') return reply.code(401).send({ error: 'Missing API key' })"] }]
    }
  })
  c.wait(11).tool({ name: 'Bash', input: { command: 'npm test', description: 'Run the route tests' }, content: '✓ 14 passed (1.2s)', report: { stdout: '✓ health › answers ok\n✓ limits › answers 429 after 100 requests\n✓ limits › sends Retry-After\n✓ 14 passed (1.2s)', stderr: '', interrupted: false } })
  c.wait(9)
    .respond()
    .text('Done. Requests past **100 a minute** per key now get `429 Too Many Requests` with a `Retry-After` header, and requests without a key get `401`. All 14 tests pass.')
  c.stop()

  c.wait(25 * 60).prompt([
    imageBlock(chartPng()),
    { type: 'text', text: 'The dashboard shows a spike in 429s right after the deploy. Here are the logs:\n<pasted_content id="a1">\n09:41:02 429 key=team-a\n09:41:02 429 key=team-a\n09:41:03 429 key=team-a\n</pasted_content>\nIs one key being shared by a whole team?' }
  ])
  c.respond().text('Let me check which keys hit the limit.')
  c.wait(4).tool({
    name: 'AskUserQuestion',
    input: { questions: [{ question: 'Should a team get its own, higher limit?', header: 'Limit', multiSelect: false, options: [{ label: '500 a minute for teams', description: 'Teams share one key' }, { label: 'Keep 100 for everyone', description: 'Teams get a key each' }] }] },
    content: 'User answered.',
    report: { questions: [], answers: { 'Should a team get its own, higher limit?': '500 a minute for teams' } }
  })
  c.wait(30).tool({
    name: 'TodoWrite',
    input: { todos: [{ content: 'Read the limit from the key’s plan', status: 'completed' }, { content: 'Give teams 500 a minute', status: 'in_progress' }, { content: 'Document the limits', status: 'pending' }] },
    content: 'Todos updated.'
  })
  c.wait(20).interrupted(true)
  c.wait(10).prompt('Go on, but keep the docs short.')
  c.apiError(529, 1, 10).wait(2).apiError(529, 2, 10)
  c.wait(6).respond().text('Teams now get **500 requests a minute**; everyone else keeps 100. The limits are in `docs/limits.md`.')
  c.stop()
  return c
}
