// The Browser pane, as the Claude app's: a real browser view per session,
// laid over the pane's place in the window, in a profile of its own
// (persist:gloom-browser) that may ask for nothing (camera, location,
// notifications are all refused) and goes only to http(s) pages. Claude drives
// it through Gloom's browser tools: open a page, read it, find and click its
// parts, type, scroll, take a screenshot, read its console and network.
import { BrowserWindow, session as electronSession, WebContentsView, type Rectangle, type Session } from 'electron'

const PARTITION = 'persist:gloom-browser'
/** Console lines and requests kept per page, for Claude to read. */
const LOG_KEEP = 300

export interface BrowserState {
  sessionId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

interface View {
  view: WebContentsView
  console: { level: string; text: string; source: string; at: number }[]
  network: { method: string; url: string; status: number | null; error: string | null; type: string; at: number }[]
  /** The device size Claude set (resize), if any. */
  emulated: { width: number; height: number; mobile: boolean } | null
}

let configured: Session | null = null

/** The browser's own profile: nothing may ask for permissions, and requests are logged per page. */
function browserSession(views: Map<string, View>): Session {
  if (configured) return configured
  const s = electronSession.fromPartition(PARTITION)
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  s.setPermissionCheckHandler(() => false)
  const byContents = (id: number | undefined) => [...views.values()].find((v) => v.view.webContents.id === id)
  s.webRequest.onCompleted((details) => {
    const v = byContents(details.webContentsId)
    if (!v) return
    v.network.push({ method: details.method, url: details.url, status: details.statusCode, error: null, type: details.resourceType, at: Date.now() })
    if (v.network.length > LOG_KEEP) v.network.shift()
  })
  s.webRequest.onErrorOccurred((details) => {
    const v = byContents(details.webContentsId)
    if (!v) return
    v.network.push({ method: details.method, url: details.url, status: null, error: details.error, type: details.resourceType, at: Date.now() })
    if (v.network.length > LOG_KEEP) v.network.shift()
  })
  configured = s
  return s
}

const WEB_URL = /^(https?:\/\/|about:blank$)/i

/** What you typed in the address field, as a URL: a host gets http(s), anything else searches. */
export function addressToUrl(typed: string): string {
  const t = typed.trim()
  if (!t) return 'about:blank'
  if (WEB_URL.test(t)) return t
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(t)) return `http://${t}`
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !/\s/.test(t)) return `https://${t}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`
}

export class Browsers {
  private readonly views = new Map<string, View>()
  /** The session whose view shows in the pane now, and where. */
  private shown: { sessionId: string; bounds: Rectangle; win: BrowserWindow } | null = null

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly changed: (state: BrowserState) => void
  ) {}

  /** The session's view, made on first use. */
  private get(sessionId: string): View {
    const existing = this.views.get(sessionId)
    if (existing) return existing
    const view = new WebContentsView({
      webPreferences: { session: browserSession(this.views), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false }
    })
    const v: View = { view, console: [], network: [], emulated: null }
    const wc = view.webContents
    // Only web pages: no file://, no custom schemes, no new windows (they open in place).
    wc.on('will-navigate', (event, url) => {
      if (!WEB_URL.test(url)) event.preventDefault()
    })
    wc.on('will-redirect', (event, url) => {
      if (!WEB_URL.test(url)) event.preventDefault()
    })
    wc.setWindowOpenHandler(({ url }) => {
      if (WEB_URL.test(url)) void wc.loadURL(url)
      return { action: 'deny' }
    })
    wc.on('console-message', (event) => {
      const e = event as unknown as { level?: string | number; message?: string; sourceId?: string; lineNumber?: number }
      const level = typeof e.level === 'string' ? e.level : ['verbose', 'info', 'warning', 'error'][Number(e.level) || 0]
      v.console.push({ level, text: String(e.message ?? '').slice(0, 4000), source: `${e.sourceId ?? ''}${e.lineNumber ? `:${e.lineNumber}` : ''}`, at: Date.now() })
      if (v.console.length > LOG_KEEP) v.console.shift()
    })
    const report = () => this.changed(this.state(sessionId))
    for (const event of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const) wc.on(event as 'did-stop-loading', report)
    wc.on('did-start-navigation', (_e, _url, inPage, isMain) => {
      if (isMain && !inPage) {
        v.console = []
        v.network = []
      }
    })
    this.views.set(sessionId, v)
    return v
  }

  state(sessionId: string): BrowserState {
    const v = this.views.get(sessionId)
    const wc = v?.view.webContents
    return {
      sessionId,
      url: wc?.getURL() ?? '',
      title: wc?.getTitle() ?? '',
      loading: wc?.isLoading() ?? false,
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false
    }
  }

  /** The pane shows this session's view, laid over `bounds` (in the window's CSS pixels), in `on` (the main window, or a pane's own). */
  show(sessionId: string, bounds: Rectangle, on: BrowserWindow | null = null): void {
    const win = on ?? this.window()
    if (!win) return
    const v = this.get(sessionId)
    if (this.shown && (this.shown.sessionId !== sessionId || this.shown.win !== win)) this.detach(this.shown.sessionId, this.shown.win)
    if (!win.contentView.children.includes(v.view)) win.contentView.addChildView(v.view)
    const zoom = win.webContents.getZoomFactor()
    v.view.setBounds({ x: Math.round(bounds.x * zoom), y: Math.round(bounds.y * zoom), width: Math.max(1, Math.round(bounds.width * zoom)), height: Math.max(1, Math.round(bounds.height * zoom)) })
    v.view.setVisible(true)
    this.shown = { sessionId, bounds, win }
  }

  /** The pane went away, or something covers it (a menu, a sheet): the view steps out of sight. Only `from`'s, when named. */
  hide(from: BrowserWindow | null = null): void {
    if (!this.shown || (from && this.shown.win !== from)) return
    this.detach(this.shown.sessionId, this.shown.win)
    this.shown = null
  }

  private detach(sessionId: string, from: BrowserWindow | null = null): void {
    const v = this.views.get(sessionId)
    const win = from ?? this.window()
    if (!v || !win || win.isDestroyed()) return
    v.view.setVisible(false)
    if (win.contentView.children.includes(v.view)) win.contentView.removeChildView(v.view)
  }

  async navigate(sessionId: string, typed: string): Promise<BrowserState> {
    const url = addressToUrl(typed)
    const wc = this.get(sessionId).view.webContents
    await wc.loadURL(url).catch(() => {
      // An aborted or failed load still leaves the view where it got to; the state says so.
    })
    return this.state(sessionId)
  }

  back(sessionId: string): void {
    this.views.get(sessionId)?.view.webContents.navigationHistory.goBack()
  }

  forward(sessionId: string): void {
    this.views.get(sessionId)?.view.webContents.navigationHistory.goForward()
  }

  reload(sessionId: string): void {
    this.views.get(sessionId)?.view.webContents.reload()
  }

  // ─── What Claude's browser tools do ──────────────────────────────────────

  /** A screenshot of the page as PNG, at most 1280 px wide. */
  async screenshot(sessionId: string): Promise<{ data: string; width: number; height: number }> {
    const wc = this.get(sessionId).view.webContents
    let image = await wc.capturePage()
    if (image.isEmpty()) throw new Error('The page has nothing to show yet (open a page first, and show the Browser pane).')
    const size = image.getSize()
    if (size.width > 1280) image = image.resize({ width: 1280 })
    const out = image.getSize()
    return { data: image.toPNG().toString('base64'), width: out.width, height: out.height }
  }

  /** Runs a script in the page and gives back its result (JSON). */
  async evaluate(sessionId: string, script: string): Promise<unknown> {
    const wc = this.get(sessionId).view.webContents
    if (!wc.getURL()) throw new Error('No page is open: navigate first.')
    return wc.executeJavaScript(script, true)
  }

  /** The page's interactive parts and text as an outline, each part tagged ref_N for click and type. */
  async readPage(sessionId: string, filter: 'all' | 'interactive', maxChars: number): Promise<string> {
    const out = (await this.evaluate(sessionId, `(${READ_PAGE})(${JSON.stringify(filter)}, ${maxChars})`)) as string
    return out
  }

  /** Parts of the page whose role, name or text has `query`. */
  async find(sessionId: string, query: string): Promise<string> {
    return (await this.evaluate(sessionId, `(${FIND})(${JSON.stringify(query)})`)) as string
  }

  /** The page's main text. */
  async text(sessionId: string, maxChars: number): Promise<string> {
    return (await this.evaluate(sessionId, `(() => { const m = document.querySelector('main, article') || document.body; return (m ? m.innerText : '').slice(0, ${maxChars}) })()`)) as string
  }

  /** Clicks a ref_N part (scrolled into view) or a point, with real mouse events. */
  async click(sessionId: string, target: { ref?: string; x?: number; y?: number }, button: 'left' | 'right' = 'left', clickCount = 1): Promise<void> {
    const wc = this.get(sessionId).view.webContents
    let x = target.x
    let y = target.y
    if (target.ref) {
      const at = (await this.evaluate(
        sessionId,
        `(() => { const el = document.querySelector('[data-gloom-ref="${target.ref.replace(/[^\w-]/g, '')}"]'); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
      )) as { x: number; y: number } | null
      if (!at) throw new Error(`No element ${target.ref} on the page (read_page again: refs change as the page does).`)
      x = at.x
      y = at.y
    }
    if (typeof x !== 'number' || typeof y !== 'number') throw new Error('Give a ref or x and y.')
    const point = { x: Math.round(x), y: Math.round(y) }
    wc.sendInputEvent({ type: 'mouseMove', ...point })
    wc.sendInputEvent({ type: 'mouseDown', ...point, button, clickCount })
    wc.sendInputEvent({ type: 'mouseUp', ...point, button, clickCount })
  }

  /** Types text where the focus is (or into a ref_N field, focused first). */
  async type(sessionId: string, text: string, ref?: string): Promise<void> {
    const wc = this.get(sessionId).view.webContents
    if (ref) await this.click(sessionId, { ref })
    await wc.insertText(text)
  }

  /** Presses keys ("Enter", "Tab", "ctrl+a"), space-separated. */
  key(sessionId: string, keys: string, repeat = 1): void {
    const wc = this.get(sessionId).view.webContents
    for (let n = 0; n < Math.min(100, Math.max(1, repeat)); n++)
      for (const combo of keys.split(/\s+/).filter(Boolean)) {
        const parts = combo.split('+')
        const keyCode = parts.pop()!
        const modifiers = parts.map((p) => p.toLowerCase()).map((p) => (p === 'ctrl' || p === 'control' ? 'control' : p === 'cmd' || p === 'meta' ? 'meta' : p)) as ('control' | 'shift' | 'alt' | 'meta')[]
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        if (keyCode.length === 1) wc.sendInputEvent({ type: 'char', keyCode, modifiers })
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      }
  }

  /** Scrolls at a point (the page's middle by default). */
  scroll(sessionId: string, direction: 'up' | 'down' | 'left' | 'right', amount = 3, at?: { x: number; y: number }): void {
    const wc = this.get(sessionId).view.webContents
    const bounds = this.get(sessionId).view.getBounds()
    const x = Math.round(at?.x ?? bounds.width / 2)
    const y = Math.round(at?.y ?? bounds.height / 2)
    const step = 120 * Math.min(10, Math.max(1, amount))
    wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: direction === 'left' ? step : direction === 'right' ? -step : 0, deltaY: direction === 'up' ? step : direction === 'down' ? -step : 0 })
  }

  consoleLines(sessionId: string, onlyErrors: boolean, limit: number, pattern?: string): View['console'] {
    const lines = this.get(sessionId).console.filter((l) => (!onlyErrors || l.level === 'error') && (!pattern || l.text.includes(pattern)))
    return lines.slice(-limit)
  }

  requests(sessionId: string, limit: number, pattern?: string): View['network'] {
    return this.get(sessionId)
      .network.filter((r) => !pattern || r.url.includes(pattern))
      .slice(-limit)
  }

  /** Emulates a device size (mobile 375×812, tablet 768×1024), or back to the pane's own (desktop). */
  async resize(sessionId: string, size: { width: number; height: number; mobile: boolean } | null): Promise<void> {
    const v = this.get(sessionId)
    const dbg = v.view.webContents.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    if (size) await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: size.mobile })
    else await dbg.sendCommand('Emulation.clearDeviceMetricsOverride')
    v.emulated = size
  }

  close(sessionId: string): void {
    const v = this.views.get(sessionId)
    if (!v) return
    this.detach(sessionId)
    v.view.webContents.close()
    this.views.delete(sessionId)
  }

  closeAll(): void {
    for (const id of [...this.views.keys()]) this.close(id)
  }
}

// ─── Scripts that run in the page ───────────────────────────────────────────
// Plain strings, so no bundler helper ever ends up in them.

/** read_page: the outline, tagging interactive parts ref_N (`filter`, `maxChars` are filled in). */
const READ_PAGE = `(filter, maxChars) => {
  const lines = []
  let n = 0
  let size = 0
  const interactive = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[contenteditable=true],[tabindex]:not([tabindex="-1"])'
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const name = (el) => (el.getAttribute('aria-label') || el.placeholder || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const walk = (el, depth) => {
    if (size > maxChars) return
    if (el.matches(interactive) && visible(el)) {
      const ref = 'ref_' + (++n)
      el.setAttribute('data-gloom-ref', ref)
      const line = '  '.repeat(Math.min(depth, 8)) + (el.getAttribute('role') || el.tagName.toLowerCase()) + ' "' + name(el) + '" [' + ref + ']' + (el.type ? ' type=' + el.type : '')
      lines.push(line); size += line.length
    } else if (filter === 'all' && /^(H[1-6]|P|LI|TD|TH|LABEL)$/.test(el.tagName) && visible(el)) {
      const text = el.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)
      if (text) { const line = '  '.repeat(Math.min(depth, 8)) + el.tagName.toLowerCase() + ': ' + text; lines.push(line); size += line.length; return }
    }
    for (const child of Array.from(el.children)) walk(child, depth + 1)
  }
  walk(document.body, 0)
  return document.title + ' — ' + location.href + '\n' + lines.join('\n') + (size > maxChars ? '\n… (cut short)' : '')
}`

/** find: parts whose role, name or text has the query, tagged ref_N. */
const FIND = `(query) => {
  const q = query.toLowerCase()
  const out = []
  let n = document.querySelectorAll('[data-gloom-ref]').length
  for (const el of Array.from(document.querySelectorAll('a,button,input,select,textarea,[role],h1,h2,h3,label,summary'))) {
    const text = ((el.getAttribute('aria-label') || el.innerText || el.placeholder || '') + ' ' + (el.getAttribute('role') || el.tagName)).toLowerCase()
    if (!text.includes(q)) continue
    let ref = el.getAttribute('data-gloom-ref')
    if (!ref) { ref = 'ref_' + (++n); el.setAttribute('data-gloom-ref', ref) }
    out.push((el.getAttribute('role') || el.tagName.toLowerCase()) + ' "' + (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 100) + '" [' + ref + ']')
    if (out.length >= 20) break
  }
  return out.length ? out.join('\n') : 'Nothing on the page matches "' + query + '".'
}`
