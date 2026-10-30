import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/** The whole window as Windows draws it, caption buttons included. Brings it to the front. */
export async function captureWindow(app: ElectronApplication, file: string): Promise<void> {
  const hwnd = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.show()
    win.focus()
    return win.getNativeWindowHandle().readBigInt64LE().toString()
  })
  const script = join(__dirname, 'capture-window.ps1')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Hwnd', hwnd, '-Out', file])
}

export async function setWindowSize(app: ElectronApplication, width: number, height = 800): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.unmaximize()
    win.setSize(size.width, size.height)
  }, { width, height })
}
