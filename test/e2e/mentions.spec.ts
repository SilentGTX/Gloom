import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ChatBuilder } from '../support/chat'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir, triggerShortcut } from './app'

// `@` file mentions (PLAN.md › 10): the composer's list of the working folder's
// files as you type after an `@`, and under a message, the files Claude Code
// read in. Captures in light and dark. Output: test-screens/mentions/.
const dir = join(__dirname, '..', '..', 'test-screens', 'mentions')
const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
const SESSION = '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c'
const TITLE = 'Tidy the buttons'
const READ = '6f5e4d3c-2b1a-4098-8e7d-6c5b4a3f2e1d'
const READ_TITLE = 'Where the menu is'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=gloom@example.com', '-c', 'user.name=Gloom', '-c', 'core.autocrlf=false', ...args], { cwd, windowsHide: true })

/** A small git project: files git knows, a new one it doesn't, and an ignored build folder. */
function project(): string {
  const cwd = join(tempDir('gloom-mentions-'), 'web')
  const put = (path: string, text = 'x\n') => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), text)
  }
  put('.gitignore', 'dist/\n')
  put('README.md', '# Web\n')
  put('package.json', '{}\n')
  put('src/app.ts', 'export {}\n')
  put('src/components/Button.tsx', 'export const Button = 1\n')
  put('src/components/Menu.tsx', 'export const Menu = 1\n')
  put('src/components/forms/inputs/TextField.tsx', 'export const TextField = 1\n')
  put('docs/guide one.md', '# Guide\n')
  put('dist/out.js', 'x\n')
  git(cwd, 'init', '-q', '-b', 'main')
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', 'first')
  put('notes.txt', 'notes\n')
  return cwd
}

/** A session that mentioned three things, and the attachment lines Claude Code wrote for them (as CLI 2.1.186 does). */
function readSession(cwd: string): ChatBuilder {
  const c = new ChatBuilder(READ, cwd, new Date(Date.now() - 30 * 60_000).toISOString())
  c.prompt('Where does @src/components/Menu.tsx open, and what else is in @src/components/ ? Lines @src/app.ts#L2-3 too.')
  c.attachment({
    type: 'file',
    filename: join(cwd, 'src', 'components', 'Menu.tsx'),
    content: { type: 'text', file: { filePath: join(cwd, 'src', 'components', 'Menu.tsx'), content: 'export const Menu = 1\n', numLines: 2, startLine: 1, totalLines: 2 } },
    displayPath: 'src\\components\\Menu.tsx'
  })
  c.attachment({ type: 'directory', path: join(cwd, 'src', 'components'), content: 'Button.tsx\nMenu.tsx\nforms/', displayPath: 'src\\components' })
  c.attachment({
    type: 'file',
    filename: join(cwd, 'src', 'app.ts'),
    content: { type: 'text', file: { filePath: join(cwd, 'src', 'app.ts'), content: 'const port = 3000\nexport {}', numLines: 2, startLine: 2, totalLines: 4 } },
    displayPath: 'src\\app.ts'
  })
  // Context the CLI adds that isn't a mention: hidden.
  c.attachment({ type: 'skill_listing', content: '- animate', skillCount: 1 })
  c.wait(3).respond().text('`Menu` opens from the toolbar. The folder also holds `Button.tsx` and `forms/`.')
  c.stop()
  c.meta({ type: 'ai-title', aiTitle: READ_TITLE })
  return c
}

let app: ElectronApplication
let page: Page
let cwd: string

test.beforeEach(async () => {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = 'smoke'
  process.env.FAKE_CLAUDE_SPEED = '0'
  cwd = project()
  const claudeDir = fakeClaude([{ id: SESSION, cwd, prompt: 'Look at the buttons', title: TITLE, created: minutesAgo(90), updated: minutesAgo(60) }])
  readSession(cwd).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir }))
  await setWindowSize(app, 1280, 860)
  await openGroup(page, 'All Sessions')
})
test.afterEach(async () => app?.close())

const composer = () => page.getByRole('textbox', { name: 'Message' })
const files = () => page.getByRole('listbox', { name: 'Files' })
const names = () => files().getByRole('option').allInnerTexts()
const active = () => files().locator('[role="option"][aria-selected="true"]')

async function openSession(title: string) {
  await sessionRow(page, title).click()
  await expect(composer()).toBeVisible()
  await composer().click()
}

test('@ lists the folder, finds files as you type, and Tab or Enter puts one in', async () => {
  await openSession(TITLE)
  // `@` alone: the folder's top level, A–Z, ignored and hidden ones too, as Claude Code lists it.
  await composer().pressSequentially('@')
  await expect(files()).toBeVisible()
  expect((await names()).map((n) => n.split('\n')[0].replace(' (folder)', ''))).toEqual(['.git', '.gitignore', 'dist', 'docs', 'notes.txt', 'package.json', 'README.md', 'src'])
  await expect(composer()).toHaveAttribute('aria-activedescendant', (await active().getAttribute('id'))!)

  // Typing finds files anywhere below: letters in order, the name first.
  await composer().pressSequentially('but')
  await expect(active()).toHaveAccessibleName(/^Button\.tsx/)
  await composer().press('Tab')
  await expect(composer()).toHaveValue('@src/components/Button.tsx ')
  await expect(files()).toHaveCount(0)

  // Mid-sentence, a path with a space goes in quoted; Enter puts it in rather than sending.
  await composer().pressSequentially('and @guide')
  await expect(active()).toHaveAccessibleName(/^guide one\.md/)
  await composer().press('Enter')
  await expect(composer()).toHaveValue('@src/components/Button.tsx and @"docs/guide one.md" ')

  // git's ignored files aren't found; new ones are.
  await composer().fill('')
  await composer().pressSequentially('@out')
  await expect(files()).toBeVisible()
  await expect(files().getByRole('option', { name: /^out\.js/ })).toHaveCount(0)
  await composer().fill('')
  await composer().pressSequentially('@notes')
  await expect(active()).toHaveAccessibleName(/^notes\.txt/)
})

test('the arrows move through the list, Esc puts it away and the next key brings it back', async () => {
  await openSession(TITLE)
  await composer().pressSequentially('@comp')
  // The folder first, then what's in it, the shortest paths first.
  await expect(active()).toHaveAccessibleName(/^components \(folder\)/)
  await composer().press('ArrowDown')
  await expect(active()).toHaveAccessibleName(/^forms \(folder\)/)
  await composer().press('ArrowDown')
  await expect(active()).toHaveAccessibleName(/^Menu\.tsx/)
  await composer().press('ArrowUp')
  await composer().press('ArrowUp')
  await composer().press('ArrowUp')
  // Up from the top goes round to the bottom.
  await expect(files().getByRole('option').last()).toHaveAttribute('aria-selected', 'true')
  await composer().press('Escape')
  await expect(files()).toHaveCount(0)
  await expect(composer()).toHaveValue('@comp')
  await composer().pressSequentially('/m')
  await expect(active()).toHaveAccessibleName(/^Menu\.tsx/)
  // A folder goes in whole, as Claude Code puts it in.
  await composer().fill('')
  await composer().pressSequentially('@src/comp')
  await composer().press('Tab')
  await expect(composer()).toHaveValue('@src/components/ ')
  // An @ inside a word isn't a mention.
  await composer().fill('')
  await composer().pressSequentially('mail me at me@example')
  await expect(files()).toHaveCount(0)
})

test('the pointer picks a file, and the list goes when the box loses the keyboard', async () => {
  await openSession(TITLE)
  await composer().pressSequentially('Look at @men')
  const menu = files().getByRole('option', { name: /^Menu\.tsx/ })
  await menu.hover()
  await expect(menu).toHaveAttribute('aria-selected', 'true')
  await menu.click()
  await expect(composer()).toHaveValue('Look at @src/components/Menu.tsx ')
  await expect(composer()).toBeFocused()
  // A deep file says where it is, shortened; all of it on hover.
  await composer().pressSequentially('@textf')
  await expect(active()).toHaveAccessibleName(/^TextField\.tsx.*src\/components\/forms\/inputs/)
  await expect(active().locator('[title]')).toHaveAttribute('title', 'src/components/forms/inputs')
  await page.locator('main h1').click()
  await expect(files()).toHaveCount(0)
})

test('the / list is the same list: its highlight follows the arrows, and Tab puts the command in', async () => {
  await openSession(TITLE)
  // The session's commands come with its first reply.
  await composer().fill('Reply with exactly: pong')
  await composer().press('Enter')
  await expect(page.getByLabel('Transcript').getByText('pong', { exact: true })).toBeVisible()
  await composer().pressSequentially('/')
  const commands = page.getByRole('listbox', { name: 'Commands' })
  await expect(commands.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await composer().press('ArrowDown')
  const second = commands.getByRole('option').nth(1)
  await expect(second).toHaveAttribute('aria-selected', 'true')
  await expect(composer()).toHaveAttribute('aria-activedescendant', (await second.getAttribute('id'))!)
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, 'slash.png') })
  const name = await second.locator('span').first().innerText()
  await composer().press('Tab')
  await expect(composer()).toHaveValue(`${name} `)
  await expect(commands).toHaveCount(0)
})

test('the files Claude Code read show under the message, and open to what it read', async () => {
  await openSession(READ_TITLE)
  const transcript = page.locator('main')
  const menu = transcript.getByRole('button', { name: /^Read src\/components\/Menu\.tsx 2 lines/ })
  await expect(menu).toBeVisible()
  await expect(transcript.getByRole('button', { name: /^Listed src\/components\// })).toBeVisible()
  await expect(transcript.getByRole('button', { name: /^Read src\/app\.ts lines 2–3/ })).toBeVisible()
  // The CLI's other context isn't shown.
  await expect(transcript.getByText('animate')).toHaveCount(0)
  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(transcript.getByText('export const Menu = 1')).toBeVisible()
})

for (const theme of ['light', 'dark'] as const) {
  test(`captures, ${theme}`, async () => {
    mkdirSync(dir, { recursive: true })
    await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
    await openSession(READ_TITLE)
    await page.locator('main').getByRole('button', { name: /^Read src\/components\/Menu\.tsx/ }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(dir, `transcript-${theme}.png`) })
    await composer().click()
    await composer().pressSequentially('Tidy @')
    await expect(files()).toBeVisible()
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(dir, `folder-${theme}.png`) })
    await composer().pressSequentially('co')
    await composer().press('ArrowDown')
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(dir, `found-${theme}.png`) })
    // Windows' contrast themes repaint every fill: the row Tab takes is the theme's highlight.
    await page.emulateMedia({ forcedColors: 'active' })
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(dir, `forced-colors-${theme}.png`) })
    await page.emulateMedia({ forcedColors: 'none', contrast: 'more' })
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(dir, `contrast-more-${theme}.png`) })
    await page.emulateMedia({ contrast: 'no-preference' })
  })
}

test('at 200% text the list grows with it, inside the window, and nothing spills sideways', async () => {
  mkdirSync(dir, { recursive: true })
  await openSession(READ_TITLE)
  for (let i = 0; i < 6; i++) await triggerShortcut(app, 'CmdOrCtrl+=')
  await composer().click()
  await composer().pressSequentially('@t')
  await expect(files()).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir, 'text-200.png') })
  const list = await files().evaluate((el) => ({ top: el.getBoundingClientRect().top, spill: el.scrollWidth - el.clientWidth }))
  expect(list.top).toBeGreaterThanOrEqual(0)
  expect(list.spill).toBeLessThanOrEqual(0)
  await triggerShortcut(app, 'CmdOrCtrl+0')
})
