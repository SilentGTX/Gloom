// Updates the way Sync does them (and Discord before it). At launch the update
// screen checks the private repo's latest GitHub release; while Gloom runs, a
// check every half hour lights up the Update button. Either way the update
// screen downloads the installer the release names, verifies its SHA-256 and
// runs it silently; the installer closes Gloom and starts the new version.
//
// A release carries the NSIS installer and update.json:
//   { "version": "0.3.1", "installer": "Gloom-Setup-0.3.1.exe", "sha256": "…", "size": 123 }
// (scripts/release.mjs makes both). The repo is private, so requests carry your
// `gh` login's token, or GLOOM_GITHUB_TOKEN when set.
import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { UpdateState } from '@shared/ipc'
import { isNewer } from '@shared/version'

const REPO = 'SilentGTX/Gloom'
const MANIFEST = 'update.json'
const CHECK_EVERY_MS = 30 * 60 * 1000
/** A download that receives nothing for this long has stalled. */
const STALL_MS = 30_000

export interface Release {
  version: string
  installer: string
  sha256: string
  size: number
  /** The installer's asset id in the release. */
  assetId: number
}
interface ReleaseAsset {
  id: number
  name: string
}

/** Development builds never update themselves, unless GLOOM_UPDATER_DEV is set. */
export function updatesEnabled(): boolean {
  return app.isPackaged || !!process.env.GLOOM_UPDATER_DEV
}

let state: UpdateState = { status: updatesEnabled() ? 'idle' : 'disabled', current: app.getVersion() }
let pending: Release | null = null
const listeners = new Set<(s: UpdateState) => void>()

export function updateState(): UpdateState {
  return state
}

export function onUpdateState(listener: (s: UpdateState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The newer release a check found, which the Update button installs. */
export function pendingUpdate(): Release | null {
  return pending
}

/** Remembers a newer release and lights up the Update button. */
export function offerUpdate(release: Release): void {
  pending = release
  state = { ...state, status: 'available', available: release.version }
  for (const listener of listeners) listener(state)
}

async function githubToken(): Promise<string> {
  if (process.env.GLOOM_GITHUB_TOKEN) return process.env.GLOOM_GITHUB_TOKEN
  const token = await new Promise<string | null>((resolve) =>
    execFile('gh', ['auth', 'token'], { windowsHide: true, timeout: 5_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null))
  )
  if (!token) throw new Error('No GitHub sign-in: run `gh auth login` in a terminal, then check again.')
  return token
}

async function github(path: string, token: string, signal: AbortSignal, accept = 'application/vnd.github+json'): Promise<Response> {
  // Asset downloads redirect to storage on another host; fetch drops the token there.
  const response = await fetch(`https://api.github.com${path}`, {
    signal,
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `Gloom/${app.getVersion()}` }
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`)
  return response
}

/** The latest release, if it's newer than this Gloom. Throws when GitHub can't be asked. */
export async function findUpdate(timeoutMs: number): Promise<Release | null> {
  const signal = AbortSignal.timeout(timeoutMs)
  const token = await githubToken()
  const release = (await (await github(`/repos/${REPO}/releases/latest`, token, signal)).json()) as { assets: ReleaseAsset[] }
  const manifestAsset = release.assets.find((a) => a.name === MANIFEST)
  if (!manifestAsset) throw new Error(`The latest release has no ${MANIFEST}.`)
  const manifest = (await (await github(`/repos/${REPO}/releases/assets/${manifestAsset.id}`, token, signal, 'application/octet-stream')).json()) as Omit<Release, 'assetId'>
  if (!isNewer(manifest.version, app.getVersion())) return null
  const installer = release.assets.find((a) => a.name === manifest.installer)
  if (!installer) throw new Error(`The release lists ${manifest.installer} but doesn't include it.`)
  return { ...manifest, assetId: installer.id }
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Downloads the release's installer, reporting the bytes received, and checks
 * its SHA-256. An intact earlier download is reused.
 */
export async function download(release: Release, onProgress: (received: number) => void): Promise<string> {
  const dir = join(app.getPath('userData'), 'updates')
  const file = join(dir, release.installer)
  if (existsSync(file) && (await sha256Of(file)) === release.sha256) {
    onProgress(release.size)
    return file
  }
  mkdirSync(dir, { recursive: true })
  const part = `${file}.part`
  const stalled = new AbortController()
  let timer = setTimeout(() => stalled.abort(), STALL_MS)
  const hash = createHash('sha256')
  let received = 0
  try {
    const response = await github(`/repos/${REPO}/releases/assets/${release.assetId}`, await githubToken(), stalled.signal, 'application/octet-stream')
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          clearTimeout(timer)
          timer = setTimeout(() => stalled.abort(), STALL_MS)
          hash.update(chunk)
          received += chunk.length
          onProgress(received)
          yield chunk
        }
      },
      createWriteStream(part)
    )
  } catch (error) {
    rmSync(part, { force: true })
    throw stalled.signal.aborted ? new Error('The download stalled.') : error
  } finally {
    clearTimeout(timer)
  }
  if (hash.digest('hex') !== release.sha256) {
    rmSync(part, { force: true })
    throw new Error('The download was damaged.')
  }
  rmSync(file, { force: true })
  renameSync(part, file)
  return file
}

/**
 * Runs the installer silently, with electron-updater's flags: `--updated`
 * gives Gloom a moment to close itself instead of being killed, and
 * `--force-run` starts the new version when it's done.
 */
export function install(file: string): void {
  // GLOOM_UPDATE_DRY_RUN: everything but the install, for trying a packaged build.
  if (process.env.GLOOM_UPDATE_DRY_RUN) return
  spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

let lastCheck = 0
let checking = false
let nextCheck: ReturnType<typeof setTimeout> | undefined

/** A quiet check that lights up the Update button when there's something new. The next is due half an hour on. */
async function checkQuietly(): Promise<void> {
  if (checking) return
  checking = true
  lastCheck = Date.now()
  try {
    const release = await findUpdate(20_000)
    if (release && release.version !== pending?.version) offerUpdate(release)
  } catch (error) {
    console.warn('[updater]', error instanceof Error ? error.message : error)
  } finally {
    checking = false
    clearTimeout(nextCheck)
    nextCheck = setTimeout(() => void checkQuietly(), CHECK_EVERY_MS)
  }
}

/** While Gloom runs, a quiet check every half hour. Starts after the launch check. */
export function startBackgroundChecks(): void {
  if (!updatesEnabled()) return
  lastCheck = Date.now()
  nextCheck = setTimeout(() => void checkQuietly(), CHECK_EVERY_MS)
}

/** Coming back to Gloom when a check is overdue (the PC slept, say) runs it then. */
export function checkOnFocus(): void {
  if (updatesEnabled() && Date.now() - lastCheck >= CHECK_EVERY_MS) void checkQuietly()
}
