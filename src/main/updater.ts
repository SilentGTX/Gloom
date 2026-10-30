// Updates the way Sync does it: check the private repo's latest GitHub release,
// download the installer it names, verify its SHA-256, light up the title-bar
// button, and on click run the installer silently and relaunch.
//
// A release carries the NSIS installer and update.json:
//   { "version": "0.2.1", "installer": "Gloom-Setup-0.2.1.exe", "sha256": "…", "size": 123 }
// (scripts/release.mjs makes both). The repo is private, so requests carry your
// `gh` login's token, or GLOOM_GITHUB_TOKEN when set.
import { app, dialog } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { UpdateState } from '@shared/ipc'
import { isNewer } from '@shared/version'

const REPO = 'SilentGTX/Gloom'
const MANIFEST = 'update.json'
const FIRST_CHECK_MS = 4_000
const CHECK_EVERY_MS = 60 * 60 * 1000

interface Manifest {
  version: string
  installer: string
  sha256: string
  size: number
}
interface ReleaseAsset {
  id: number
  name: string
}

let state: UpdateState = { status: 'idle', current: app.getVersion() }
let installer: string | null = null
const listeners = new Set<(s: UpdateState) => void>()

function setState(next: Partial<UpdateState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener(state)
}

export function updateState(): UpdateState {
  return state
}

export function onUpdateState(listener: (s: UpdateState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function githubToken(): Promise<string | null> {
  if (process.env.GLOOM_GITHUB_TOKEN) return process.env.GLOOM_GITHUB_TOKEN
  return new Promise((resolve) =>
    execFile('gh', ['auth', 'token'], { windowsHide: true, timeout: 10_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null))
  )
}

async function github(path: string, token: string, accept = 'application/vnd.github+json'): Promise<Response> {
  // Asset downloads redirect to storage on another host; fetch drops the token there.
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `Gloom/${app.getVersion()}` }
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`)
  return response
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Streams an asset to disk, hashing as it goes. Returns the SHA-256. */
async function download(response: Response, file: string, size: number): Promise<string> {
  const hash = createHash('sha256')
  const out = createWriteStream(file)
  let received = 0
  let reported = 0
  for await (const chunk of Readable.fromWeb(response.body as unknown as WebReadableStream)) {
    hash.update(chunk as Buffer)
    received += (chunk as Buffer).length
    if (!out.write(chunk)) await once(out, 'drain')
    if (received - reported > size / 50) {
      reported = received
      setState({ progress: Math.min(1, received / size) })
    }
  }
  await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())))
  return hash.digest('hex')
}

/** Checks for a newer release and downloads it. `interactive` reports the outcome in a dialog. */
export async function checkForUpdates(interactive = false): Promise<void> {
  if (state.status === 'disabled' && !interactive) return
  if (state.status === 'checking' || state.status === 'downloading') return
  if (state.status === 'ready') {
    if (interactive) await dialog.showMessageBox({ type: 'info', message: `Gloom ${state.available} is ready.`, detail: 'Click Update in the title bar to install it.' })
    return
  }
  setState({ status: 'checking', error: undefined })
  try {
    const token = await githubToken()
    if (!token) throw new Error('No GitHub sign-in: run `gh auth login` in a terminal, then check again.')
    const release = (await (await github(`/repos/${REPO}/releases/latest`, token)).json()) as { assets: ReleaseAsset[] }
    const manifestAsset = release.assets.find((a) => a.name === MANIFEST)
    if (!manifestAsset) throw new Error(`The latest release has no ${MANIFEST}.`)
    const manifest = (await (await github(`/repos/${REPO}/releases/assets/${manifestAsset.id}`, token, 'application/octet-stream')).json()) as Manifest

    if (!isNewer(manifest.version, app.getVersion())) {
      setState({ status: 'idle', available: undefined })
      if (interactive) await dialog.showMessageBox({ type: 'info', message: 'Gloom is up to date.', detail: `You have version ${app.getVersion()}.` })
      return
    }

    const asset = release.assets.find((a) => a.name === manifest.installer)
    if (!asset) throw new Error(`The release lists ${manifest.installer} but doesn't include it.`)
    const dir = join(app.getPath('userData'), 'updates')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, manifest.installer)
    if (!existsSync(file) || (await sha256Of(file)) !== manifest.sha256) {
      setState({ status: 'downloading', available: manifest.version, progress: 0 })
      const digest = await download(await github(`/repos/${REPO}/releases/assets/${asset.id}`, token, 'application/octet-stream'), file, manifest.size)
      if (digest !== manifest.sha256) {
        rmSync(file, { force: true })
        throw new Error('The downloaded installer failed its SHA-256 check and was deleted.')
      }
    }
    installer = file
    setState({ status: 'ready', available: manifest.version, progress: undefined })
  } catch (error) {
    setState({ status: 'error', error: error instanceof Error ? error.message : String(error), progress: undefined })
    console.warn('[updater]', state.error)
    if (interactive) await dialog.showMessageBox({ type: 'error', message: 'Couldn’t check for updates.', detail: state.error })
  }
}

/**
 * Quits and runs the installer silently, with electron-updater's flags:
 * `--updated` gives Gloom a moment to exit instead of being killed, and
 * `--force-run` starts the new version when it's done. Window bounds and
 * layout are saved on quit, so it reopens as it was. (With live sessions,
 * Phase 4 makes this wait until none is mid-turn, as the Claude app does.)
 */
export function installUpdate(): void {
  if (state.status !== 'ready' || !installer) return
  spawn(installer, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  app.quit()
}

/** Checks a few seconds after launch, then hourly. Development builds never update themselves. */
export function startUpdater(): void {
  if (!app.isPackaged && !process.env.GLOOM_UPDATER_DEV) {
    setState({ status: 'disabled' })
    return
  }
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
