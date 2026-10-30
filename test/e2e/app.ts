import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC, type SplashState, type UpdateState } from '../../src/shared/ipc'

/** Launches the built app with a throwaway profile, so tests never see your real state. */
export async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'gloom-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..', '..'),
    // Playwright forces a light colour scheme by default; follow nativeTheme like the real app.
    colorScheme: null
  })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  return { app, page }
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
  const page = app.windows().find((p) => p.url().includes('splash.html'))
  if (!page) throw new Error('the update window did not open')
  return page
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
