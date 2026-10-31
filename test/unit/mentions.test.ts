import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '../../src/shared/transcript'
import { lineEntries } from '../../src/shared/transcript'
import { listFiles } from '../../src/main/files'
import { insertMention, mentionAt, prepareFiles, rankFiles } from '../../src/renderer/src/features/chat/mentions'
import { buildRows } from '../../src/renderer/src/features/chat/rows'
import { describeMention } from '../../src/renderer/src/features/chat/tools'

// `@` file mentions (PLAN.md › 10): the word at the caret, the ranking, what a
// pick puts in, the listing in main, and the attachment lines Claude Code
// writes for what it read in (shapes recorded from CLI 2.1.186 and 2.1.314).

/** The caret where `|` is. */
const at = (marked: string) => mentionAt(marked.replace('|', ''), marked.indexOf('|'))

describe('the @ word at the caret', () => {
  it('starts at an @ at the start or after a space, and runs to the caret', () => {
    expect(at('@|')).toEqual({ start: 0, end: 1, query: '' })
    expect(at('@src/co|')).toEqual({ start: 0, end: 7, query: 'src/co' })
    expect(at('look at @but|')).toEqual({ start: 8, end: 12, query: 'but' })
    expect(at('first line\n@rea|')).toMatchObject({ start: 11, query: 'rea' })
  })

  it('takes in the rest of the word past the caret, which a pick replaces', () => {
    expect(at('@RE|ADME and more')).toEqual({ start: 0, end: 7, query: 'RE' })
  })

  it('isn’t one inside a word, or once a space follows it', () => {
    expect(at('mail me@example|')).toBeNull()
    expect(at('@src/app.ts |')).toBeNull()
    expect(at('no mention|')).toBeNull()
    expect(at('|')).toBeNull()
  })

  it('reads a quoted path with spaces while its quote is open, and not after it closes', () => {
    expect(at('@"|')).toEqual({ start: 0, end: 2, query: '' })
    expect(at('see @"my docs/gu|')).toEqual({ start: 4, end: 16, query: 'my docs/gu' })
    expect(at('see @"my do|cs/guide.md" too')).toEqual({ start: 4, end: 23, query: 'my do' })
    expect(at('see @"my docs/a.md" |')).toBeNull()
    expect(at('see @"my docs/a.md" and @no|')).toMatchObject({ start: 24, query: 'no' })
  })
})

describe('what a pick puts in', () => {
  it('puts the path in with a space after it, and the caret after that', () => {
    const text = 'look at @but'
    expect(insertMention(text, at('look at @but|')!, 'src/components/Button.tsx')).toEqual({ text: 'look at @src/components/Button.tsx ', caret: 35 })
  })

  it('quotes a path with a space in it, as Claude Code writes it', () => {
    expect(insertMention('@guide', at('@guide|')!, 'docs/guide one.md').text).toBe('@"docs/guide one.md" ')
  })

  it('replaces the whole word, and keeps a space that’s already there', () => {
    const marked = '@RE|ADME and more'
    const done = insertMention(marked.replace('|', ''), at(marked)!, 'README.md')
    expect(done).toEqual({ text: '@README.md and more', caret: 11 })
  })

  it('puts a folder in whole, with its slash', () => {
    expect(insertMention('@src/comp', at('@src/comp|')!, 'src/components/').text).toBe('@src/components/ ')
  })
})

describe('ranking', () => {
  const files = prepareFiles({
    top: ['.git/', '.gitignore', 'docs/', 'package.json', 'README.md', 'src/'],
    all: [
      'docs/',
      'src/',
      'src/components/',
      'src/lib/',
      '.gitignore',
      'README.md',
      'package.json',
      'app.config.ts',
      'docs/guide one.md',
      'src/app.ts',
      'src/components/Button.tsx',
      'src/components/IconButton.tsx',
      'src/components/Menu.tsx',
      'src/lib/format.ts',
      'src/lib/unbuttoned.ts'
    ],
    truncated: false
  })
  const rank = (q: string) => rankFiles(files, q)

  it('lists the folder’s top level when nothing’s typed', () => {
    expect(rank('')).toEqual(['.git/', '.gitignore', 'docs/', 'package.json', 'README.md', 'src/'])
  })

  it('puts the name first: whole, its start, a word in it, then inside it', () => {
    expect(rank('button')).toEqual(['src/components/Button.tsx', 'src/components/IconButton.tsx', 'src/lib/unbuttoned.ts'])
    expect(rank('menu.tsx')[0]).toBe('src/components/Menu.tsx')
    expect(rank('conf')[0]).toBe('app.config.ts')
  })

  it('finds letters in order, in the name before the path', () => {
    expect(rank('btn')[0]).toBe('src/components/Button.tsx')
    // Claude Code finds this one this way too.
    expect(rank('sbtn')).toContain('src/components/Button.tsx')
    expect(rank('zzz')).toEqual([])
  })

  it('matches across folders when a slash is typed, either way round', () => {
    expect(rank('comp/m')).toEqual(['src/components/Menu.tsx'])
    expect(rank('comp\\m')).toEqual(['src/components/Menu.tsx'])
    expect(rank('src/comp')[0]).toBe('src/components/')
  })

  it('puts a folder before what’s in it, then the shorter paths, then A–Z', () => {
    expect(rank('comp')).toEqual(['src/components/', 'src/components/Menu.tsx', 'src/components/Button.tsx', 'src/components/IconButton.tsx'])
    expect(rank('a').slice(0, 2)).toEqual(['src/app.ts', 'app.config.ts'])
  })

  it('lists 15 at most, the best ones', () => {
    const many = prepareFiles({ top: [], all: Array.from({ length: 400 }, (_, i) => `notes/note-${String(i).padStart(3, '0')}.md`).concat('note.md'), truncated: false })
    const found = rankFiles(many, 'note')
    expect(found).toHaveLength(15)
    expect(found[0]).toBe('note.md')
    expect(found[1]).toBe('notes/note-000.md')
  })

  it('keeps up with a big folder', () => {
    const big = prepareFiles({ top: [], all: Array.from({ length: 50_000 }, (_, i) => `packages/p${i % 97}/src/module-${i}/index-${i}.ts`), truncated: false })
    const t = performance.now()
    for (const q of ['i', 'in', 'ind', 'inde', 'index-49']) rankFiles(big, q)
    expect((performance.now() - t) / 5).toBeLessThan(100)
  })
})

describe('the listing', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=gloom@example.com', '-c', 'user.name=Gloom', '-c', 'core.autocrlf=false', ...args], { cwd, windowsHide: true })
  const folder = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'gloom-files-'))
    for (const f of files) {
      mkdirSync(dirname(join(dir, f)), { recursive: true })
      writeFileSync(join(dir, f), 'x\n')
    }
    return dir
  }

  it('in a git repository: what git knows and new files it doesn’t ignore, with their folders', async () => {
    const dir = folder(['.gitignore', 'README.md', 'src/app.ts', 'src/lib/format.ts', 'dist/out.js', 'debug.log'])
    writeFileSync(join(dir, '.gitignore'), 'dist/\n*.log\n')
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'first')
    writeFileSync(join(dir, 'notes.txt'), 'new\n')
    const listing = await listFiles(dir)
    expect([...listing.all].sort()).toEqual(['.gitignore', 'README.md', 'notes.txt', 'src/', 'src/app.ts', 'src/lib/', 'src/lib/format.ts'])
    // Its top level is everything there, as a directory listing shows it.
    expect(listing.top).toEqual(['.git/', '.gitignore', 'debug.log', 'dist/', 'notes.txt', 'README.md', 'src/'])
    expect(listing.truncated).toBe(false)
    // From a folder inside it, only what's under that folder, from there.
    const inside = await listFiles(join(dir, 'src'))
    expect([...inside.all].sort()).toEqual(['app.ts', 'lib/', 'lib/format.ts'])
  })

  it('anywhere else: every file, hidden ones too, but not inside .git', async () => {
    const dir = folder(['README.md', '.env', 'node_modules/lib/index.js', 'sub/.git/HEAD', 'sub/main.c'])
    const listing = await listFiles(dir)
    expect([...listing.all].sort()).toEqual(['.env', 'README.md', 'node_modules/', 'node_modules/lib/', 'node_modules/lib/index.js', 'sub/', 'sub/main.c'])
  })

  it('answers again from the same listing for a few seconds', () => {
    const dir = folder(['a.txt'])
    expect(listFiles(dir)).toBe(listFiles(dir))
  })
})

describe('what Claude Code read in', () => {
  const line = { offset: 0, length: 100 }
  const attachment = (attachment: object): Record<string, unknown> => ({ type: 'attachment', uuid: 'm1', parentUuid: 'u1', timestamp: '2026-10-31T12:00:00.000Z', attachment })

  it('turns a file it read into a mention, with its lines', () => {
    const { entries } = lineEntries(
      attachment({
        type: 'file',
        filename: 'C:\\work\\web\\notes\\a.txt',
        content: { type: 'text', file: { filePath: 'C:\\work\\web\\notes\\a.txt', content: 'The code word is MARIGOLD.\n', numLines: 2, startLine: 1, totalLines: 2 } },
        displayPath: 'notes\\a.txt'
      }),
      line
    )
    expect(entries).toEqual([
      { kind: 'mention', key: 'm1', time: Date.parse('2026-10-31T12:00:00.000Z'), folder: false, path: 'notes/a.txt', full: 'C:\\work\\web\\notes\\a.txt', lines: 2, from: 1, total: 2, content: { type: 'text', text: 'The code word is MARIGOLD.\n' } }
    ])
    expect(describeMention(entries[0] as never)).toMatchObject({ verb: 'Read', note: '2 lines' })
  })

  it('says which lines, for part of a file', () => {
    const { entries } = lineEntries(
      attachment({ type: 'file', filename: 'C:\\w\\e.txt', content: { type: 'text', file: { filePath: 'C:\\w\\e.txt', content: 'three CEDAR\nfour DAHLIA', numLines: 2, startLine: 3, totalLines: 7 } }, displayPath: 'e.txt' }),
      line
    )
    expect(describeMention(entries[0] as never)).toMatchObject({ verb: 'Read', note: 'lines 3–4' })
  })

  it('turns a folder into a mention with its listing', () => {
    const { entries } = lineEntries(attachment({ type: 'directory', path: 'C:\\w\\listing', content: 'PELICAN.md\nWALRUS.md', displayPath: 'listing' }), line)
    expect(entries[0]).toMatchObject({ kind: 'mention', folder: true, path: 'listing', content: { text: 'PELICAN.md\nWALRUS.md' } })
    expect(describeMention(entries[0] as never)).toEqual(expect.objectContaining({ verb: 'Listed' }))
  })

  it('leaves a long file in the transcript, to be read when it’s opened', () => {
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
    const { entries } = lineEntries(attachment({ type: 'file', filename: 'C:\\w\\big.txt', content: { type: 'text', file: { content: long, numLines: 500, startLine: 1, totalLines: 500 } }, displayPath: 'big.txt' }), line)
    const mention = entries[0] as Extract<TranscriptEntry, { kind: 'mention' }>
    expect(mention.content.text.split('\n').length).toBeLessThan(500)
    expect(mention.content.more).toBe('0:100:attachment/content/file/content')
  })

  it('shows none of the other context the CLI adds', () => {
    for (const a of [{ type: 'skill_listing', content: '- animate' }, { type: 'deferred_tools_delta', addedNames: ['Monitor'] }, { type: 'file' }]) expect(lineEntries(attachment(a), line).entries).toEqual([])
  })

  it('sits close under the message that mentioned it', () => {
    const mention = (key: string, s: number): TranscriptEntry => ({ kind: 'mention', key, time: Date.parse('2026-10-31T12:00:00Z') + s * 1000, folder: false, path: `${key}.ts`, full: `C:\\w\\${key}.ts`, content: { type: 'text', text: 'x' } })
    const rows = buildRows([{ kind: 'prompt', key: 'p', time: Date.parse('2026-10-31T12:00:00Z'), text: 'look at @a.ts @b.ts', images: [] }, mention('a', 0), mention('b', 0)], {})
    expect(rows.map((r) => [r.kind, r.space])).toEqual([
      ['time', 12],
      ['prompt', 6],
      ['mention', 6],
      ['mention', 2]
    ])
  })
})
