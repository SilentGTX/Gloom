import { describe, expect, it } from 'vitest'
import type { SessionMeta } from '../../src/shared/library'
import {
  flatten,
  fold,
  rankPalette,
  RECENT_COUNT,
  SESSION_LIMIT,
  usable,
  type PaletteCommand,
  type PaletteFolder,
  type PaletteInput,
  type PaletteSession
} from '../../src/renderer/src/features/palette/rank'

const now = Date.parse('2026-10-31T12:00:00Z')
const hoursAgo = (h: number) => now - h * 3_600_000

function command(id: string, label: string, extra: Partial<PaletteCommand> = {}): PaletteCommand {
  return { id, label, names: [], keywords: '', disabled: false, checked: false, ...extra }
}

function session(id: string, title: string, extra: Partial<SessionMeta> & { archived?: boolean } = {}): PaletteSession {
  const { archived = false, ...meta } = extra
  return {
    id,
    title,
    archived,
    meta: {
      id,
      file: `C:\\projects\\x\\${id}.jsonl`,
      project: 'x',
      cwd: 'D:\\JS\\Gloom',
      title,
      firstPrompt: null,
      lastPrompt: null,
      created: hoursAgo(100),
      updated: hoursAgo(10),
      size: 1,
      entrypoint: 'cli',
      gitBranch: null,
      version: null,
      remote: false,
      ...meta
    }
  }
}

const folder = (id: string, name: string, path: string[] = []): PaletteFolder => ({ id, name, path })

// In menu order, as the registry lists them.
const COMMANDS = [
  command('session.new', 'New Session…', { shortcut: 'Ctrl+N', keywords: 'chat start File' }),
  command('folder.new', 'New Folder', { keywords: 'group File' }),
  command('session.info', 'Session Info', { keywords: 'details id File' }),
  command('terminal.new', 'New Terminal', { keywords: 'File' }),
  command('app.settings', 'Settings…', { keywords: 'preferences options File' }),
  command('edit.undo', 'Undo', { disabled: true, keywords: 'Edit' }),
  command('view.toggleTerminal', 'Show Terminal', { names: ['Show or Hide Terminal'], keywords: 'shell console View' }),
  command('view.toggleSidebar', 'Hide Sidebar', { names: ['Show or Hide Sidebar'], keywords: 'View' }),
  command('view.sortName', 'Name', { submenu: 'Sort Sessions By', names: ['Sort Sessions By Name'], keywords: 'View' }),
  command('view.toggleTranscripts', 'Determine Transcripts', { keywords: 'View' })
]

function input(query: string, extra: Partial<PaletteInput> = {}): PaletteInput {
  return { query, commands: COMMANDS, sessions: [], folders: [], current: null, viewed: {}, picked: {}, ...extra }
}

const keys = (i: PaletteInput) => flatten(rankPalette(i)).map((item) => item.key)
const groupKeys = (i: PaletteInput) => rankPalette(i).map((g) => g.key)

describe('the command palette, before you type', () => {
  const sessions = [
    session('a', 'Alpha', { updated: hoursAgo(1) }),
    session('b', 'Bravo', { updated: hoursAgo(2) }),
    session('c', 'Charlie', { updated: hoursAgo(3) }),
    session('d', 'Delta', { updated: hoursAgo(4), archived: true }),
    session('e', 'Echo', { updated: hoursAgo(5) }),
    session('f', 'Foxtrot', { updated: hoursAgo(6) }),
    session('g', 'Golf', { updated: hoursAgo(7) })
  ]

  it('lists the sessions you were in last, newest first, leaving out the open one, then every command in menu order', () => {
    const groups = rankPalette(input('', { sessions, current: 'c', viewed: { c: hoursAgo(0.1), e: hoursAgo(0.2), a: hoursAgo(0.3) } }))
    expect(groups.map((g) => g.key)).toEqual(['recent', 'commands'])
    // Where you were before the open one first (Enter goes back to it), then the rest by last activity; archived ones stay out.
    expect(groups[0].items.map((i) => i.key)).toEqual(['session:e', 'session:a', 'session:b', 'session:f', 'session:g'])
    expect(groups[0].items).toHaveLength(RECENT_COUNT)
    expect(groups[1].items.map((i) => i.key)).toEqual(COMMANDS.map((c) => `command:${c.id}`))
  })

  it('counts a session picked in the palette as a visit', () => {
    const groups = rankPalette(input('', { sessions, picked: { 'session:g': hoursAgo(0.1) } }))
    expect(groups[0].items[0].key).toBe('session:g')
  })

  it('shows only the commands when there are no sessions', () => {
    expect(groupKeys(input(''))).toEqual(['commands'])
    expect(groupKeys(input('   '))).toEqual(['commands'])
  })
})

describe('the command palette, as you type', () => {
  it('puts the start of a word ahead of the middle of one', () => {
    expect(keys(input('term')).slice(0, 3)).toEqual(['command:terminal.new', 'command:view.toggleTerminal', 'command:view.toggleTranscripts'])
  })

  it('finds a command by its initials ahead of letters inside a word', () => {
    expect(keys(input('ns'))[0]).toBe('command:session.new')
    expect(keys(input('ns'))).toContain('command:view.toggleTranscripts')
  })

  it('finds letters in order with others between, after everything closer', () => {
    expect(keys(input('trml'))).toEqual(['command:terminal.new', 'command:view.toggleTerminal'])
  })

  it('needs every word, and rewards them as one phrase', () => {
    expect(keys(input('show term'))[0]).toBe('command:view.toggleTerminal')
    expect(keys(input('show xyz'))).toEqual([])
  })

  it('finds a toggle by what it says now and by its menu name, and a submenu item by the submenu', () => {
    expect(keys(input('hide terminal'))).toEqual(['command:view.toggleTerminal'])
    expect(keys(input('show sidebar'))).toEqual(['command:view.toggleSidebar'])
    expect(keys(input('sort name'))[0]).toBe('command:view.sortName')
  })

  it('finds a command by its keywords and its menu, below a match on its name', () => {
    expect(keys(input('preferences'))).toEqual(['command:app.settings'])
    expect(keys(input('shell'))).toEqual(['command:view.toggleTerminal'])
    const found = keys(input('session', { commands: [...COMMANDS, command('x.y', 'Something', { keywords: 'session' })] }))
    expect(found.indexOf('command:x.y')).toBeGreaterThan(found.indexOf('command:session.info'))
  })

  it('ignores case and accents', () => {
    const sessions = [session('cafe', 'Café notes')]
    expect(keys(input('CAFE', { sessions }))).toEqual(['session:cafe'])
    expect(fold('Ünïcödé')).toBe('unicode')
  })

  it('lists commands that can’t run now last, and never picks them', () => {
    const undo = rankPalette(input('undo'))
    expect(flatten(undo).map((i) => i.key)).toEqual(['command:edit.undo'])
    expect(usable(flatten(undo)[0])).toBe(false)
    const commands = [command('a', 'Open Thing', { disabled: true }), command('b', 'Open Other')]
    expect(keys(input('open thing', { commands }))).toEqual(['command:a'])
    expect(keys(input('open', { commands }))).toEqual(['command:b', 'command:a'])
  })

  it('breaks a tie with what you picked last', () => {
    const commands = [command('a', 'Copy Path'), command('b', 'Copy Link')]
    expect(keys(input('copy', { commands }))).toEqual(['command:a', 'command:b'])
    expect(keys(input('copy', { commands, picked: { 'command:b': hoursAgo(1) } }))).toEqual(['command:b', 'command:a'])
  })
})

describe('sessions and folders in the palette', () => {
  const sessions = [
    session('rate', 'API rate limits', { lastPrompt: 'Add rate limiting to the API', cwd: 'D:\\Work\\api' }),
    session('login', 'Login page fix', { firstPrompt: 'Fix the login page', cwd: 'D:\\Work\\web' }),
    session('mention', 'Refactor', { lastPrompt: 'the login form is slow', cwd: 'D:\\Work\\web' }),
    session('old', 'Login archive', { archived: true, cwd: 'D:\\Work\\web' })
  ]
  const folders = [folder('w', 'Work'), folder('g', 'Gloom', ['Work']), folder('p', 'Phases', ['Work', 'Gloom']), folder('g2', 'Gloom')]

  it('finds a session by its title, prompts or project, title matches first and archived ones last', () => {
    expect(keys(input('login', { sessions, commands: [] }))).toEqual(['session:login', 'session:mention', 'session:old'])
    // The project (the working folder's name) finds them too, as the sidebar's search does.
    expect(keys(input('web', { sessions, commands: [] }))).toEqual(['session:login', 'session:mention', 'session:old'])
  })

  it('puts the group with the best match on top', () => {
    expect(groupKeys(input('login page fix', { sessions }))).toEqual(['sessions'])
    expect(groupKeys(input('new', { sessions, folders: [folder('n', 'Notes new')] }))).toEqual(['commands', 'folders'])
    expect(groupKeys(input('work', { sessions, folders }))[0]).toBe('folders')
    // A match on a session's title beats a command's keyword.
    expect(groupKeys(input('refactor', { sessions, commands: [...COMMANDS, command('r', 'Tidy', { keywords: 'refactor' })] }))).toEqual(['sessions', 'commands'])
  })

  it('finds a folder by its name or the folders it is in, shallower first', () => {
    expect(keys(input('gloom', { folders, commands: [] }))).toEqual(['folder:g2', 'folder:g', 'folder:p'])
    expect(keys(input('work phases', { folders, commands: [] }))).toEqual(['folder:p'])
  })

  it('lists the best sessions only, however many match', () => {
    const many = Array.from({ length: SESSION_LIMIT + 20 }, (_, i) => session(`s${i}`, `Session ${i}`))
    const groups = rankPalette(input('session', { sessions: many, commands: [] }))
    expect(groups[0].items).toHaveLength(SESSION_LIMIT)
  })

  it('offers the open session too once you type its name', () => {
    expect(keys(input('api rate', { sessions, current: 'rate', commands: [] }))).toEqual(['session:rate'])
  })
})
