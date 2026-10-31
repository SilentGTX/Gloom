// The worst realistic library and chat, for Phase 7's break-the-UI pass and its
// regression test: 500 sessions, folders eight levels deep, titles at the
// lengths Claude Code and Gloom allow, names in other scripts, unbreakable
// paths and URLs, identical titles, a future timestamp, empty folders, and a
// transcript full of the longest things a session holds. Made up, never yours.
import { ChatBuilder, imageBlock, pngBase64 } from './chat'
import type { FakeSession } from './transcripts'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

let n = 0
const id = () => `cccccccc-0000-4000-8000-${String(++n).padStart(12, '0')}`
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

/** Working folders as people have them: deep, unbroken, on a share. */
export const CWDS = {
  deep: 'C:\\Users\\aleksandra.wisniewska-kowalczyk\\source\\repos\\northwind-industries-holdings\\platform-infrastructure\\services\\customer-notification-preferences-api',
  share: '\\\\fileserver.corp.northwind.example\\engineering\\projects\\q3-launch\\dashboards',
  mono: 'D:\\JS\\monorepo',
  gloom: 'D:\\JS\\Gloom',
  web: 'D:\\JS\\website',
  api: 'D:\\Work\\api',
  photos: 'D:\\Home\\photos',
  jp: 'D:\\プロジェクト\\家計簿アプリ'
}

/** The rows people see first carry the failures, spread one per row. */
const FIRST: Omit<FakeSession, 'id'>[] = [
  {
    cwd: CWDS.deep,
    // 200 characters: the CLI's titles have no limit, and the Claude app's renames go longer.
    title:
      'Investigate why the nightly export to the analytics warehouse silently drops rows whose customer names contain combining diacritics, and add a regression test for every locale we ship in production',
    prompt: 'The nightly export lost 1,284 rows again. Find out why.',
    lastPrompt:
      'Here is the failing row from the warehouse log, can you check whether the normaliser or the CSV writer drops it? {"level":"error","ts":"2026-10-31T02:14:09.118Z","job":"nightly-export","table":"customers","row":118204,"name":"Đặng Thị Ngọc Hân","reason":"NFC/NFD mismatch after trim"}',
    created: ago(1 * MINUTE),
    updated: ago(5_000)
  },
  {
    cwd: CWDS.api,
    title: 'fix-bartholomew.fitzgerald@northwind-industries-holdings.example.com-bounce-handling',
    prompt: 'Bounces from bartholomew.fitzgerald@northwind-industries-holdings.example.com keep retrying forever',
    created: ago(2 * MINUTE),
    updated: ago(3 * MINUTE)
  },
  {
    cwd: CWDS.mono,
    customTitle: 'D:\\JS\\monorepo\\packages\\design-system\\src\\components\\navigation\\sidebar\\SidebarSectionHeader.stories.tsx',
    prompt: 'Stories for the sidebar section header',
    created: ago(3 * MINUTE),
    updated: ago(40 * MINUTE),
    entrypoint: 'claude-desktop'
  },
  { cwd: CWDS.gloom, title: 'J', prompt: 'j', created: ago(4 * MINUTE), updated: ago(4 * MINUTE) },
  { cwd: CWDS.jp, title: '修复登录页面在重置密码后无限重定向的问题', prompt: '重置密码后登录页面一直重定向', created: ago(5 * MINUTE), updated: ago(70 * MINUTE) },
  {
    cwd: CWDS.web,
    title: 'إصلاح حلقة إعادة التوجيه في صفحة تسجيل الدخول بعد إعادة تعيين كلمة المرور',
    prompt: 'صفحة تسجيل الدخول تعيد التوجيه بلا توقف',
    created: ago(6 * MINUTE),
    updated: ago(2 * 60 * MINUTE)
  },
  { cwd: CWDS.web, title: 'Sửa lỗi hiển thị tên Đặng Thị Ngọc Hân trong hồ sơ', prompt: 'Tên có dấu bị cắt mất', created: ago(7 * MINUTE), updated: ago(3 * 60 * MINUTE) },
  { cwd: CWDS.gloom, title: '🦊 Fox: ship the 👩🏽‍💻 developer portal', prompt: 'Ship the developer portal 🚀', created: ago(8 * MINUTE), updated: ago(4 * 60 * MINUTE) },
  { cwd: CWDS.web, title: '<script>alert(1)</script> & **bold** &amp; in titles', prompt: 'Escape titles <b>properly</b>', created: ago(9 * MINUTE), updated: ago(5 * 60 * MINUTE) },
  // No title yet: the first prompt stands in, newlines and all.
  { cwd: CWDS.api, prompt: 'Line one of a pasted note\nLine two\nLine three', created: ago(10 * MINUTE), updated: ago(6 * 60 * MINUTE) },
  // No title and no prompt: a session that only ran a command.
  { cwd: CWDS.api, prompt: '', created: ago(11 * MINUTE), updated: ago(7 * 60 * MINUTE) },
  { cwd: CWDS.gloom, title: 'phase 2', prompt: 'Commit and push', created: ago(12 * MINUTE), updated: ago(8 * 60 * MINUTE) },
  { cwd: CWDS.gloom, title: 'phase 2', prompt: 'Yes, commit and push', created: ago(13 * MINUTE), updated: ago(9 * 60 * MINUTE) },
  { cwd: CWDS.gloom, title: 'phase 2', prompt: 'Ship it', created: ago(14 * MINUTE), updated: ago(10 * 60 * MINUTE) },
  { cwd: CWDS.share, title: 'Benachrichtigungseinstellungen-Synchronisierungsfehlerbehebung', prompt: 'Die Einstellungen werden nicht synchronisiert', created: ago(15 * MINUTE), updated: ago(11 * 60 * MINUTE) },
  // A clock that ran ahead: its last activity is two days from now.
  { cwd: CWDS.photos, title: 'Photo library cleanup', prompt: 'Sort the 2025 photos by trip', created: ago(16 * MINUTE), updated: new Date(Date.now() + 2 * DAY).toISOString() },
  {
    cwd: CWDS.mono,
    title: 'Pasted logs',
    prompt: 'Why does this fail?',
    lastPrompt: Array.from({ length: 40 }, (_, i) => `2026-10-31T09:41:${String(i).padStart(2, '0')}.000Z ERROR [worker-${i % 7}] job=nightly-export retry=${i} cause=ECONNRESET upstream=warehouse.internal.northwind.example:5432`).join('\n'),
    created: ago(17 * MINUTE),
    updated: ago(12 * 60 * MINUTE)
  }
]

const TOPICS = [
  'Rate limits for the public API',
  'Login redirect loop',
  'Monthly budget summary',
  'Deploy previews',
  'Pricing page copy',
  'Subtitle timing',
  'Player controls',
  'Episode guide sync',
  'Flaky checkout test',
  'Dark mode contrast',
  'Migrate to the new router',
  'Upgrade TypeScript',
  'Cache invalidation on publish',
  'Search ranking tweaks',
  'Onboarding emails',
  'CSV import validation'
]
const PROJECTS = [CWDS.gloom, CWDS.web, CWDS.api, CWDS.mono, CWDS.photos, CWDS.deep, CWDS.share, CWDS.jp]

/** 500 sessions: the worst rows first, then ordinary ones spread over the last year. */
export function worstSessions(total = 500): FakeSession[] {
  n = 0
  const first = FIRST.map((s) => ({ id: id(), ...s }))
  const rest: FakeSession[] = []
  for (let i = first.length; i < total; i++) {
    const topic = TOPICS[i % TOPICS.length]
    const created = 20 * MINUTE + i * 17 * 60 * MINUTE
    rest.push({
      id: id(),
      cwd: PROJECTS[i % PROJECTS.length],
      title: `${topic} ${Math.floor(i / TOPICS.length) + 1}`,
      prompt: `${topic}: pick up where we left off`,
      created: ago(created),
      updated: ago(created - 5 * MINUTE)
    })
  }
  return [...first, ...rest]
}

/** The longest names the library takes: folders 120 characters, renames 300. */
export const LONGEST_FOLDER = 'Customer feedback from enterprise onboarding calls, sorted by account tier and region, for the Q3 board deck and roadmap'
export const LONGEST_RENAME =
  'Renamed by hand: the nightly export drops rows with combining diacritics in customer names (NFC versus NFD after trimming), the CSV writer double-escapes quotes inside quoted fields, and the warehouse loader skips a whole batch when one row fails, so one bad name loses 1,284 rows'

/** Eight levels of folders, outermost first. */
export const DEEP_CHAIN = [
  'Clients',
  'Northwind Industries Holdings',
  'Platform Infrastructure',
  'Notification Preferences API',
  'v2 Migration',
  'Regional Rollouts',
  'EU (Frankfurt)',
  'Week 42 hotfixes'
]

export const WORST_CHAT_ID = 'cccccccc-0000-4000-8000-999999999999'
export const WORST_CHAT_TITLE = 'Everything at its longest'

/** A path as long as Windows allows without long-path support (260). */
const LONG_PATH = `${CWDS.deep}\\src\\handlers\\notification-preferences\\regional\\eu-frankfurt\\NotificationPreferencesRegionalHandler.test.ts`
const LONG_URL = 'https://docs.northwind-industries-holdings.example/workspaces/platform-infrastructure/projects/notification-preferences/runbooks/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f?tab=comments&filter=unresolved&sort=newest'

/** A transcript holding the longest of everything a session shows. */
export function worstChat(cwd = CWDS.deep, start = new Date(Date.now() - 2 * 3600_000).toISOString()): ChatBuilder {
  const c = new ChatBuilder(WORST_CHAT_ID, cwd, start)
  c.title(WORST_CHAT_TITLE)

  c.prompt(
    [
      'The export job fails on these rows. Logs below, and the runbook is at ' + LONG_URL,
      '<pasted_content id="p1">',
      ...Array.from({ length: 60 }, (_, i) => `2026-10-31T02:14:${String(i % 60).padStart(2, '0')}.118Z ERROR nightly-export table=customers row=${118204 + i} name="Đặng Thị Ngọc Hân" reason="NFC/NFD mismatch after trim"`),
      '</pasted_content>',
      'Is it the normaliser or the CSV writer?'
    ].join('\n')
  )
  c.respond().thinking('The rows that fail all have names with combining marks. '.repeat(30), 48_000)
  c.text(
    [
      `I'll start with the handler in \`${LONG_PATH}\`, then the writer.`,
      '',
      `The runbook (${LONG_URL}) says the export retries **1,284** times before giving up.`,
      '',
      '| Stage | Input encoding | Output encoding | Rows in | Rows out | Dropped | Retries | Duration |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| Normaliser (NFC) | UTF-8 with combining marks | UTF-8 precomposed | 1,204,118 | 1,204,118 | 0 | 0 | 00:01:12 |',
      '| CSV writer | UTF-8 precomposed | UTF-8 with BOM, CRLF | 1,204,118 | 1,202,834 | 1,284 | 1,284 | 00:14:51 |',
      '| Warehouse loader | UTF-8 with BOM | Parquet (snappy) | 1,202,834 | 1,202,834 | 0 | 0 | 00:03:07 |',
      '',
      'A minified payload, as the log has it:',
      '',
      '`{"level":"error","job":"nightly-export","table":"customers","row":118204,"name":"Đặng Thị Ngọc Hân","bytes":"44e1baa76e672054686e1ba7","reason":"NFC/NFD mismatch after trim"}`',
      '',
      '```ts',
      `export const normalise = (name: string): string => name.normalize('NFC').replace(/\\s+/g, ' ').trim() // keep this in step with ${LONG_PATH} and the warehouse's collation, or rows with combining marks drop out of the export again`,
      ...Array.from({ length: 40 }, (_, i) => `const row${i} = normalise(rows[${i}].name)`),
      '```',
      '',
      '> نص عربي في اقتباس: يجب أن يظهر من اليمين إلى اليسار',
      '',
      '1. First',
      '   1. Nested',
      '      1. Deeper',
      '         - Deepest, with a long line that has to wrap inside its indentation without running off the edge of the transcript',
      '',
      '🦊👩🏽‍💻 done.'
    ].join('\n')
  )
  c.wait(3).tool({ name: 'Read', input: { file_path: LONG_PATH }, content: '     1\timport { normalise } from "./normalise"\n', report: { type: 'text', file: { filePath: LONG_PATH, numLines: 1, startLine: 1, totalLines: 1 } } })
  const command = [
    'cd "C:\\Users\\aleksandra.wisniewska-kowalczyk\\source\\repos\\northwind-industries-holdings\\platform-infrastructure"',
    'npx vitest run --reporter=verbose --coverage --coverage.reporter=text-summary services/customer-notification-preferences-api/src/handlers/notification-preferences/regional/eu-frankfurt',
    'npm run lint -- --max-warnings=0'
  ].join(' && ')
  c.wait(5).tool({
    name: 'Bash',
    input: { command, description: 'Run the regional handler tests with coverage, then lint' },
    content: Array.from({ length: 3000 }, (_, i) => `✓ NotificationPreferencesRegionalHandler › row ${i} keeps its name when it has combining marks (${i % 9}ms)`).join('\n'),
    report: { stdout: Array.from({ length: 3000 }, (_, i) => `✓ NotificationPreferencesRegionalHandler › row ${i} keeps its name when it has combining marks (${i % 9}ms)`).join('\n'), stderr: '', interrupted: false }
  })
  // A big edit: hundreds of lines out and in.
  const lines = [...Array.from({ length: 300 }, (_, i) => `-  legacyRow${i}: normaliseLegacy(rows[${i}].name),`), ...Array.from({ length: 400 }, (_, i) => `+  row${i}: normalise(rows[${i}].name), // ${'NFC '.repeat(i % 30)}`)]
  c.wait(4).tool({
    name: 'Edit',
    input: { file_path: LONG_PATH },
    content: 'The file has been updated.',
    report: { filePath: LONG_PATH, structuredPatch: [{ oldStart: 10, oldLines: 300, newStart: 10, newLines: 400, lines }] }
  })
  // Edits across sixty files, so the diff pane has a long list.
  for (let i = 0; i < 60; i++) {
    const file = `${cwd}\\src\\${i % 3 === 0 ? 'handlers\\notification-preferences\\regional' : i % 3 === 1 ? 'writers\\csv' : 'shared'}\\${['normalise', 'collation', 'export-job', 'warehouse-loader', 'retry-policy'][i % 5]}-${i}.ts`
    c.wait(1).tool({
      name: 'Edit',
      input: { file_path: file },
      content: 'The file has been updated.',
      report: { filePath: file, structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: ["-const name = row.name.trim()", "+const name = row.name.normalize('NFC').trim()", `+// ${'see the runbook '.repeat(i % 12)}`] }] }
    })
  }
  const created = Array.from({ length: 2000 }, (_, i) => `export const case${i} = { name: 'Đặng Thị Ngọc Hân ${i}', expected: 'Đặng Thị Ngọc Hân ${i}'.normalize('NFC') }`).join('\n')
  c.wait(3).tool({ name: 'Write', input: { file_path: `${cwd}\\test\\fixtures\\every-locale-we-ship.generated.ts`, content: created }, content: 'File created successfully.', report: { type: 'create', filePath: `${cwd}\\test\\fixtures\\every-locale-we-ship.generated.ts`, content: created, structuredPatch: [] } })
  c.wait(2).tool({
    name: 'Grep',
    input: { pattern: "normalize\\('NF[CD]'\\)", path: cwd },
    content: Array.from({ length: 250 }, (_, i) => `src/module-${i}/index.ts`).join('\n'),
    report: { mode: 'files_with_matches', numFiles: 250, filenames: Array.from({ length: 250 }, (_, i) => `src/module-${i}/index.ts`) }
  })
  c.wait(2).tool({ name: 'WebFetch', input: { url: LONG_URL, prompt: 'What does the runbook say about retries?' }, content: 'The runbook says to retry 1,284 times.' })
  c.wait(2).tool({
    name: 'mcp__northwind-industries-holdings-internal-docs__search_confluence_spaces_by_label',
    input: { label: 'notification-preferences', spaces: ['PLATFORM', 'INFRA', 'NOTIFY', 'EU-OPS'], limit: 50 },
    content: 'Found 50 pages.'
  })
  c.wait(2).tool({
    name: 'Task',
    input: { description: 'Audit every place in the monorepo that normalises customer names before export', prompt: 'Find them all.', subagent_type: 'general-purpose' },
    content: 'Found 14 places.'
  })
  c.wait(2).tool({
    name: 'Bash',
    input: { command: 'npm run export -- --table customers --since 2026-10-01', description: 'Run the export' },
    content: 'Exit code 1\n' + 'Error: connect ECONNRESET warehouse.internal.northwind.example:5432\n'.repeat(40),
    isError: true,
    report: { stdout: '', stderr: 'Error: connect ECONNRESET warehouse.internal.northwind.example:5432\n'.repeat(40), interrupted: false }
  })
  c.wait(3).tool({
    name: 'TodoWrite',
    input: {
      todos: Array.from({ length: 25 }, (_, i) => ({
        content: i === 3 ? 'Make the CSV writer stop double-escaping quotes inside quoted fields, and add a test with a name that has both a quote and a combining mark' : `Step ${i + 1}: check the ${['normaliser', 'writer', 'loader', 'retry policy', 'collation'][i % 5]}`,
        status: i < 8 ? 'completed' : i === 8 ? 'in_progress' : 'pending'
      }))
    },
    content: 'Todos updated.'
  })
  c.wait(4).respond().text(`Fixed: names keep their marks, and the export no longer drops 1,284 rows. See \`${LONG_PATH}\`.`)
  c.stop()

  // A screenshot as wide as a dashboard, and one as tall as a phone's scroll capture.
  const wide = pngBase64(2400, 120, (x, y) => [230 - (y % 40 === 0 ? 30 : 0), 228, 244 - Math.round((x / 2400) * 40)])
  const tall = pngBase64(120, 1600, (x, y) => [244 - Math.round((y / 1600) * 50), 236, 248 - (x % 30 === 0 ? 20 : 0)])
  c.wait(60).prompt([imageBlock(wide), imageBlock(tall), { type: 'text', text: '{"level":"error","job":"nightly-export","table":"customers","row":118204,"name":"Đặng Thị Ngọc Hân","bytes":"44e1baa76e672054686e1ba7","reason":"NFC/NFD mismatch after trim","trace":"at normalise (src/shared/normalise.ts:12:18) at writeRow (src/writers/csv/writer.ts:88:5)"}' }])
  c.respond().text('That one is the writer: it trims before it normalises.')
  c.stop()
  return c
}
