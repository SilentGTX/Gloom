import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC, type SplashState, type UpdateState } from '../../src/shared/ipc'
import { writeTranscript, type FakeSession } from '../support/transcripts'

export interface LaunchOptions {
  /** Reuse a profile, to see what survives a restart. */
  userData?: string
  /** Claude Code's folder (CLAUDE_CONFIG_DIR). By default an empty one: tests never read your sessions. */
  claudeDir?: string
}

/** Launches the built app with a throwaway profile, so tests never see your real state. */
export async function launch(options: LaunchOptions = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = options.userData ?? tempDir('gloom-e2e-')
  const claudeDir = options.claudeDir ?? fakeClaude([])
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..', '..'),
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
    // Playwright forces a light colour scheme by default; follow nativeTheme like the real app.
    colorScheme: null
  })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  return { app, page }
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A Claude Code folder holding these sessions' transcripts. */
export function fakeClaude(sessions: FakeSession[]): string {
  const dir = tempDir('gloom-claude-')
  mkdirSync(join(dir, 'projects'), { recursive: true })
  for (const s of sessions) writeTranscript(join(dir, 'projects'), s)
  return dir
}

/** An ISO time this many minutes ago. */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** The sidebar: your library and folders, with their sessions nested inside. */
export const sidebar = (page: Page): Locator => page.locator('aside[aria-label="Sidebar"]')

/** A library group or folder (or Archived), by the start of its name. */
export const groupRow = (page: Page, name: string): Locator => sidebar(page).getByRole('treeitem', { name: new RegExp(`^${name}`) })

/** A session's row in one group ('smart:all', 'folder:<id>', 'results'), by its title. A session shows in every group it belongs to. */
export const sessionRow = (page: Page, title: string, group = 'smart:all'): Locator =>
  sidebar(page).locator(`[data-nav^="${group}/"][data-label="${title.replace(/"/g, '\\"')}"]`)

/** Opens a library group or folder, if it's closed, once it has something to show. */
export async function openGroup(page: Page, name: string): Promise<void> {
  const row = groupRow(page, name)
  await expect(row).toHaveAttribute('aria-expanded', /true|false/)
  if ((await row.getAttribute('aria-expanded')) === 'true') return
  await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  await settle(page)
}

/** Waits out the rows springing to their new places (0.25 s), so positions read now are where they stay. */
export const settle = (page: Page) => page.waitForTimeout(350)

/** Drags with real pointer events, in steps, as dnd kit expects. */
export async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.waitForTimeout(80)
  await page.mouse.up()
}

/**
 * Fires a shortcut's application-menu item, as its accelerator does. Playwright's
 * injected keys go straight to the page and never reach the (hidden) menu.
 */
export async function triggerShortcut(app: ElectronApplication, accelerator: string): Promise<void> {
  const found = await app.evaluate(({ BrowserWindow, Menu }, wanted) => {
    const win = BrowserWindow.getAllWindows()[0]
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.accelerator === wanted) return item
        const inner = item.submenu && find(item.submenu.items)
        if (inner) return inner
      }
      return undefined
    }
    const item = find(Menu.getApplicationMenu()?.items ?? [])
    item?.click({ triggeredByAccelerator: true } as Electron.KeyboardEvent, win, win.webContents)
    return !!item
  }, accelerator)
  if (!found) throw new Error(`no menu item has the accelerator ${accelerator}`)
}

/**
 * Real keystrokes through Windows (SendKeys syntax: ^ Ctrl, + Shift). Sends
 * nothing unless Gloom is verifiably the foreground window, so a stray Ctrl+B
 * can never land in another app.
 */
export async function pressRealKeys(app: ElectronApplication, keys: string): Promise<void> {
  const hwnd = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.show()
    win.focus()
    return win.getNativeWindowHandle().readBigInt64LE().toString()
  })
  const script = [
    "Add-Type -Namespace GloomKeys -Name Win -MemberDefinition '[DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow();'",
    '$w = New-Object -ComObject WScript.Shell',
    "$null = $w.AppActivate('Gloom')",
    'Start-Sleep -Milliseconds 250',
    `if ([GloomKeys.Win]::GetForegroundWindow() -ne [System.IntPtr]${hwnd}) { exit 3 }`,
    `$w.SendKeys('${keys}')`
  ].join('; ')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
}

/** A window as Windows draws it, caption buttons included. Brings it to the front. */
export async function captureWindow(app: ElectronApplication, file: string, which: 'main' | 'update' = 'main'): Promise<void> {
  const hwnd = await app.evaluate(({ BrowserWindow }, update) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('splash.html') === update)!
    win.show()
    win.focus()
    return win.getNativeWindowHandle().readBigInt64LE().toString()
  }, which === 'update')
  const script = join(__dirname, 'capture-window.ps1')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Hwnd', hwnd, '-Out', file])
}

/** Tells the main window a newer Gloom is out. Development builds never check for real. */
export async function sendUpdateReady(app: ElectronApplication, available: string): Promise<void> {
  const state: UpdateState = { status: 'available', current: '0.0.0', available }
  await app.evaluate(({ BrowserWindow }, { channel, state }) => BrowserWindow.getAllWindows()[0].webContents.send(channel, state), {
    channel: IPC.updateStateChanged,
    state
  })
}

interface UpdateWindowHook {
  gloomUpdateWindow: { open(): Promise<unknown>; show(state: SplashState): void }
}

/** Opens the update window (development builds hand tests its controls) and returns its page. */
export async function openUpdateWindow(app: ElectronApplication): Promise<Page> {
  await app.evaluate(() => (globalThis as unknown as UpdateWindowHook).gloomUpdateWindow.open())
  // Playwright can learn of the new window a moment after it opens.
  const find = () => app.windows().find((p) => p.url().includes('splash.html'))
  await expect.poll(() => !!find(), { message: 'the update window did not open', timeout: 5000 }).toBe(true)
  return find()!
}

export async function showInUpdateWindow(app: ElectronApplication, state: SplashState): Promise<void> {
  await app.evaluate((_electron, s) => (globalThis as unknown as UpdateWindowHook).gloomUpdateWindow.show(s), state)
}

export async function setWindowSize(app: ElectronApplication, width: number, height = 800): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.unmaximize()
    win.setSize(size.width, size.height)
  }, { width, height })
  await keepAwayFromCursor(app)
}

/**
 * Puts the window where the real mouse cursor isn't. A cursor resting over the
 * window sends a real mouse move (no button held) whenever the window activates,
 * which ends a synthetic drag mid-way. This moves the window, never the cursor.
 */
export async function keepAwayFromCursor(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    const { width, height } = win.getBounds()
    const contains = (x: number, y: number) => cursor.x >= x && cursor.x < x + width && cursor.y >= y && cursor.y < y + height
    const spots = [
      { x: area.x, y: area.y },
      { x: area.x + area.width - width, y: area.y },
      { x: area.x, y: area.y + area.height - height },
      { x: area.x + area.width - width, y: area.y + area.height - height }
    ]
    const spot = spots.find((s) => !contains(s.x, s.y))
    if (spot) win.setPosition(Math.round(spot.x), Math.round(spot.y))
  })
}
