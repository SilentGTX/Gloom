// Gloom's page comes from its own scheme, app://gloom/, rather than file://.
// A file:// page gets powers no web page has (fetching any other file on the
// PC, for one), and the GrantFileProtocolExtraPrivileges fuse now takes them
// away (electron-builder.yml); on its own scheme the page is an ordinary,
// secure origin. Only the renderer's folder is served, from inside the app
// archive.
import { net, protocol } from 'electron'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const APP_SCHEME = 'app'
export const APP_HOST = 'gloom'
/** The page's own URL in a built Gloom. */
export const APP_PAGE = `${APP_SCHEME}://${APP_HOST}/index.html`

/** Inline widgets (show_widget) are served from a scheme of their own, in a sandboxed frame. */
export const WIDGET_SCHEME = 'gloom-widget'

/** Before the app is ready: the scheme behaves like https (a standard, secure origin, with fetch and V8's code cache). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    { scheme: WIDGET_SCHEME, privileges: { standard: true, secure: true } }
  ])
}

/** Widgets' pages by ID: the last few hundred shown. */
const widgets = new Map<string, string>()
const WIDGETS_KEPT = 300

/**
 * A widget Claude drew may run scripts from the three CDNs the Claude app
 * allows and draw images it carries itself; it can't reach the network
 * otherwise, nor the page around it (the frame is sandboxed, without Gloom's origin).
 */
const WIDGET_CSP =
  "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

/** Keeps a widget's page; resolves to the URL its frame loads. */
export function serveWidget(id: string, html: string): string {
  widgets.delete(id)
  widgets.set(id, html)
  while (widgets.size > WIDGETS_KEPT) widgets.delete(widgets.keys().next().value!)
  return `${WIDGET_SCHEME}://w/${encodeURIComponent(id)}`
}

function serveWidgets(): void {
  protocol.handle(WIDGET_SCHEME, (request) => {
    const url = new URL(request.url)
    const html = url.host === 'w' ? widgets.get(decodeURIComponent(url.pathname.slice(1))) : undefined
    if (html === undefined) return notFound()
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': WIDGET_CSP, 'x-content-type-options': 'nosniff' } })
  })
}

/** The file under `root` that a request's path names, or null for anything outside it. */
export function fileFor(root: string, pathname: string): string | null {
  let path: string
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return null
  }
  // join, not resolve: '/index.html' is inside root, not at the top of the drive.
  const file = join(root, path)
  const inside = relative(root, file)
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? file : null
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })

/** Serves the renderer's folder at app://gloom/. Call once the app is ready. */
export function serveApp(): void {
  serveWidgets()
  const root = join(__dirname, '../renderer')
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    const file = url.host === APP_HOST ? fileFor(root, url.pathname) : null
    return file ? net.fetch(pathToFileURL(file).href).catch(notFound) : notFound()
  })
}
