import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { DEMO_TITLE, demoSession } from '../support/demo'
import { fakeClaude, openGroup, sessionRow, tempDir } from './app'

// A packaged build, checked before it's released:
//   GLOOM_PACKAGED_EXE=release\<version>\win-unpacked\Gloom.exe npx playwright test packaged
// Its fuses refuse Node's --inspect, which Playwright's Electron driver needs, so
// the check starts Gloom.exe itself and connects to Chromium's DevTools port.
// It runs from inside the app archive with no update check (--no-update) and a
// throwaway profile and Claude folder: the settings Gloom kept under file://
// moving to app://gloom, the transcripts process, git by its full path, node-pty
// from app.asar.unpacked, the keyboard's rings and F6, `@` listing a session's
// files, the command palette, the clipboard (the only permission the page has),
// Resume in Terminal (a dry run), and Update Claude Code… opening a real terminal
// (hidden). Then a copy of the build with one byte of its archive changed has to
// refuse to start.
const exe = process.env.GLOOM_PACKAGED_EXE
test.skip(!exe, 'set GLOOM_PACKAGED_EXE to a packaged Gloom.exe')
test.setTimeout(120_000)

const root = join(__dirname, '..', '..')

interface Packaged {
  child: ChildProcess
  browser: Browser
  page: Page
  /** What Gloom.exe wrote to stdout and stderr. */
  output: () => string
}

/** Starts a packaged Gloom.exe and connects to its window over the DevTools port. */
async function launchPackaged(profile: string, env: NodeJS.ProcessEnv, args: string[] = []): Promise<Packaged> {
  const child = spawn(exe!, ['--no-update', `--user-data-dir=${profile}`, '--remote-debugging-port=0', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout!.on('data', (data) => (output += data))
  child.stderr!.on('data', (data) => (output += data))
  await expect.poll(() => output, { timeout: 30_000 }).toMatch(/DevTools listening on ws:\/\//)
  const browser = await chromium.connectOverCDP(output.match(/DevTools listening on (ws:\/\/\S+)/)![1])
  const context = browser.contexts()[0]
  const page = context.pages().find((p) => p.url().startsWith('app://')) ?? (await context.waitForEvent('page', { predicate: (p) => p.url().startsWith('app://') }))
  return { child, browser, page, output: () => output }
}

/** Quits through Gloom's own command, as File › Quit does; a Gloom that hangs is ended, shells and all. */
async function quit({ child, browser, page }: Packaged): Promise<void> {
  const exited = new Promise((resolve) => child.once('exit', resolve))
  await page.evaluate(() => window.gloom!.runCommand('app.quit')).catch(() => {})
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15_000))])
  await browser.close().catch(() => {})
  if (child.exitCode === null && child.signalCode === null) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
}

const command = (page: Page, id: string) => page.evaluate((id) => window.gloom!.runCommand(id as never), id)

/** The clipboard's text, through PowerShell (the main process is out of reach). */
const powershell = (script: string, env: NodeJS.ProcessEnv = {}) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } })
const readClipboard = () => powershell('Get-Clipboard -Raw').replace(/\r?\n$/, '')
const writeClipboard = (text: string) =>
  powershell(text ? 'Set-Clipboard -Value $env:GLOOM_CLIPBOARD' : 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()', { GLOOM_CLIPBOARD: text })

test('its fuses are set', async () => {
  const wire = await getCurrentFuseWire(exe!)
  const on = (fuse: FuseV1Options) => wire[fuse] === '1'.charCodeAt(0)
  expect({
    runAsNode: on(FuseV1Options.RunAsNode),
    cookieEncryption: on(FuseV1Options.EnableCookieEncryption),
    nodeOptions: on(FuseV1Options.EnableNodeOptionsEnvironmentVariable),
    inspect: on(FuseV1Options.EnableNodeCliInspectArguments),
    asarIntegrity: on(FuseV1Options.EnableEmbeddedAsarIntegrityValidation),
    onlyFromAsar: on(FuseV1Options.OnlyLoadAppFromAsar),
    fileProtocolPrivileges: on(FuseV1Options.GrantFileProtocolExtraPrivileges)
  }).toEqual({ runAsNode: false, cookieEncryption: true, nodeOptions: false, inspect: false, asarIntegrity: true, onlyFromAsar: true, fileProtocolPrivileges: false })
})

test('a packaged build opens a session, its panes and its keyboard', async () => {
  const cwd = tempDir('gloom-packaged-')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=gloom@example.com', '-c', 'user.name=Gloom', ...args], { cwd, windowsHide: true })
  writeFileSync(join(cwd, 'server.ts'), 'export const port = 3000\n')
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  writeFileSync(join(cwd, 'server.ts'), 'export const port = 8080\n')
  const claudeDir = fakeClaude([])
  demoSession(cwd).write(join(claudeDir, 'projects'))

  // A profile an earlier Gloom ran in: its settings under file:// (by Electron
  // itself, as storage.spec.ts does) and its window's place.
  const profile = tempDir('gloom-packaged-profile-')
  // In the classic design, which the steps below were written for; the last switches to the concept.
  const ui = { state: { sidebarWidth: 300, sidebarHidden: false, textScale: 1.0625, glassAlways: false, design: 'classic', sort: 'created', openSmart: [], selection: [] }, version: 4 }
  execFileSync(require('electron') as unknown as string, [join(root, 'test', 'support', 'seed-storage.cjs'), `--user-data-dir=${profile}`], {
    env: { ...process.env, GLOOM_SEED: JSON.stringify([['gloom.ui', JSON.stringify(ui)]]) },
    timeout: 30_000
  })
  writeFileSync(join(profile, 'window-state.json'), JSON.stringify({ width: 1280, height: 860, maximized: false }))

  // An empty Claude folder is signed out: as a test, it skips the first-run sign-in screen.
  // --inspect too, which the fuses ignore.
  const gloom = await launchPackaged(profile, { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, GLOOM_RESUME_DRY_RUN: '1', GLOOM_NO_CLAUDE_ASKS: '1' }, ['--inspect=0'])
  const { page } = gloom
  // Anything the page reports going wrong (a file app://gloom couldn't serve, a policy refusal).
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  try {
    await page.waitForSelector('main')
    await expect(page.locator('[inert]')).toHaveCount(0)
    // Gloom's own page (the look it opens in rides along as ?design=).
    expect(page.url().split('?')[0]).toBe('app://gloom/index.html')
    expect(gloom.output()).not.toMatch(/Debugger listening/)
    // The settings moved over from file://.
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--text-scale'))).toBe('1.0625')

    // The transcript, read by the transcripts process from inside the archive,
    // its code coloured by the highlighting worker (a module worker from app://gloom).
    await openGroup(page, 'All Sessions')
    await sessionRow(page, DEMO_TITLE).click()
    await page.locator('img[alt="Attached image"]').waitFor()
    await expect(page.locator('.code-card code span[style*="color"]').first()).toBeAttached({ timeout: 15_000 })

    // Keyboard focus shows, and F6 moves between the panes.
    await page.getByLabel('Transcript').focus()
    await page.keyboard.press('Shift+Tab')
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return { tag: el.tagName, outline: getComputedStyle(el).outlineStyle }
    })
    expect(ring).toEqual({ tag: 'BUTTON', outline: 'solid' })
    await command(page, 'view.nextPane')
    expect(await page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane'))).toBe('transcript')

    // Copy Code reaches the clipboard (whatever was on it goes back afterwards).
    const before = readClipboard()
    try {
      await page.getByRole('button', { name: 'Copy Code' }).first().click()
      await expect.poll(readClipboard).toContain('rateLimit')
    } finally {
      writeClipboard(before)
    }

    // `@` lists the session's files (git, by its full path, from main), and Tab puts one in.
    const composer = page.getByRole('textbox', { name: 'Message' })
    await composer.click()
    await page.keyboard.type('@ser')
    await expect(page.getByRole('listbox', { name: 'Files' }).locator('[role="option"][aria-selected="true"]')).toHaveAccessibleName(/^server\.ts/)
    await page.keyboard.press('Tab')
    await expect(composer).toHaveValue('@server.ts ')
    await composer.fill('')

    // The command palette finds a command as you type, and Enter runs it: the diff pane.
    await command(page, 'view.palette')
    const palette = page.getByRole('dialog', { name: 'Command Palette' })
    await expect(palette.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('show diff')
    await expect(palette.locator('[role="option"][aria-selected="true"]')).toHaveAccessibleName(/Show Diff/)
    await page.keyboard.press('Enter')
    await expect(palette).toHaveCount(0)

    // Working Tree: git, run by its full path.
    const diff = page.locator('aside[aria-label="Diff"]')
    await diff.getByRole('tab', { name: 'Working Tree' }).click()
    await expect(diff.getByRole('button', { name: 'server.ts, Modified, 1 line added, 1 removed' })).toBeVisible({ timeout: 15_000 })

    // A shell in the terminal pane (node-pty from app.asar.unpacked).
    await command(page, 'view.toggleTerminal')
    const terminal = page.locator('section[aria-label="Terminal"]')
    await expect(terminal.getByRole('tab', { name: 'PowerShell' })).toBeVisible()
    await terminal.locator('.xterm-screen').click()
    await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
    await page.keyboard.type('Write-Output ("packaged-" + "terminal-ok")')
    await page.keyboard.press('Enter')
    await expect(terminal.locator('.xterm-rows')).toContainText('packaged-terminal-ok', { timeout: 20_000 })

    // Resume in Terminal, as far as the command it would run.
    await page.getByRole('button', { name: 'Session info' }).click()
    await page.getByRole('button', { name: 'Resume in Terminal' }).click()
    await expect(page.getByText('Resumed in a terminal window')).toBeVisible()

    // The concept design draws from the archive too: its views, and the inspector listing what git sees.
    await command(page, 'view.designConcept')
    await expect(page.getByRole('tablist', { name: 'Show' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('server.ts', { timeout: 15_000 })

    // Parity (PLAN.md › 12): the side pane opens, and an inline widget's frame loads from Gloom's widget scheme.
    await command(page, 'view.panePlan')
    await expect(page.getByRole('complementary', { name: 'Pane' })).toBeVisible()
    const loaded = await page.evaluate(async () => {
      const url = await window.gloom!.widget('packaged-check', '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', 'check', { dark: false, accent: '#8860ea' })
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      const done = new Promise<boolean>((resolve) => {
        frame.addEventListener('load', () => resolve(true))
        setTimeout(() => resolve(false), 10_000)
      })
      frame.src = url
      document.body.appendChild(frame)
      const ok = (await done) && url.startsWith('gloom-widget://')
      frame.remove()
      return ok
    })
    expect(loaded).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await quit(gloom)
  }
})

/** The process IDs of PowerShell windows running `claude <args>`, as src/main/terminal.ts starts them (not the PowerShell asking). */
const terminals = (args: string): string[] =>
  powershell(`Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ? { $_.CommandLine -like '*-NoExit -Command & $env:GLOOM_CLAUDE ${args}*' -and $_.ProcessId -ne $PID } | % { $_.ProcessId }`)
    .split(/\s+/)
    .filter(Boolean)

test('Update Claude Code… opens a terminal', async () => {
  // Hidden, with Windows' whoami standing in for claude: nothing shows and nothing updates.
  const env = { ...process.env, CLAUDE_CONFIG_DIR: fakeClaude([]), GLOOM_CLAUDE_EXE: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), GLOOM_TERMINAL_HIDDEN: '1' }
  const before = new Set(terminals('update'))
  const gloom = await launchPackaged(tempDir('gloom-packaged-profile-'), env)
  const { page } = gloom
  try {
    await page.waitForSelector('main')
    await expect(page.locator('[inert]')).toHaveCount(0)
    await command(page, 'app.settings')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('radio', { name: 'Claude Code' }).click()
    await settings.getByRole('button', { name: 'Update Claude Code…' }).click()
    await expect.poll(() => terminals('update').filter((pid) => !before.has(pid)).length, { timeout: 15_000 }).toBe(1)
  } finally {
    for (const pid of terminals('update')) if (!before.has(pid)) spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { windowsHide: true })
    await quit(gloom)
  }
})

/** A copy of the build made of hard links (same drive, so it's cheap), apart from its app archive, which is left out. */
function linkBuild(from: string, to: string): void {
  for (const entry of readdirSync(from, { withFileTypes: true, recursive: true })) {
    const source = join(entry.parentPath, entry.name)
    const path = relative(from, source)
    if (entry.isDirectory()) mkdirSync(join(to, path), { recursive: true })
    else if (path.toLowerCase() !== join('resources', 'app.asar')) {
      mkdirSync(dirname(join(to, path)), { recursive: true })
      linkSync(source, join(to, path))
    }
  }
}

test('a changed app archive doesn’t start', async () => {
  const build = dirname(exe!)
  // Beside the build, on its drive: hard links can't cross drives.
  const copy = join(dirname(build), `tampered-${Date.now()}`)
  const asar = join(copy, 'resources', 'app.asar')
  const smoke = () => {
    const result = join(tempDir('gloom-smoke-'), 'smoke.json')
    const run = spawnSync(join(copy, 'Gloom.exe'), [`--smoke-pty=${result}`], { timeout: 60_000, windowsHide: true })
    return { status: run.status, ran: existsSync(result) }
  }
  try {
    linkBuild(build, copy)
    // Untouched, the copy runs: its smoke test passes.
    copyFileSync(join(build, 'resources', 'app.asar'), asar)
    expect(smoke()).toEqual({ status: 0, ran: true })
    // One letter of a string in the main process's code, which would run fine
    // without the check. Written as a new file, so the build's own can't change.
    const bytes = readFileSync(asar)
    const at = bytes.indexOf('Gloom Transcripts')
    expect(at).toBeGreaterThan(0)
    bytes[at + 'Gloom Transcript'.length] = 'z'.charCodeAt(0)
    unlinkSync(asar)
    writeFileSync(asar, bytes)
    const tampered = smoke()
    expect(tampered.ran).toBe(false)
    expect(tampered.status).not.toBe(0)
  } finally {
    rmSync(copy, { recursive: true, force: true, maxRetries: 10 })
  }
})
