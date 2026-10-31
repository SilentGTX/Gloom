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

/** Before the app is ready: the scheme behaves like https (a standard, secure origin, with fetch and V8's code cache). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }])
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
  const root = join(__dirname, '../renderer')
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    const file = url.host === APP_HOST ? fileFor(root, url.pathname) : null
    return file ? net.fetch(pathToFileURL(file).href).catch(notFound) : notFound()
  })
}
