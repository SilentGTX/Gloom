// Updates the way Sync does them (and Discord before it). At launch the update
// screen checks the private repo's latest GitHub release; while Gloom runs, a
// check every half hour lights up the Update button. Either way the update
// screen downloads the app the release carries, verifies its SHA-256 and
// unpacks it beside the running copy, which hands its window over to it
// (versions.ts, handover.ts). Where that can't be done, the installer runs
// silently instead, closing Gloom and starting the new version.
//
// A release carries the NSIS installer, a zip of the app and update.json:
//   { "version": "1.2.3", "installer": "Gloom-Setup-1.2.3.exe", "sha256": "…", "size": 123,
//     "zip": "Gloom-1.2.3-win.zip", "zipSha256": "…", "zipSize": 456 }
// (scripts/release.mjs makes them; older versions of Gloom read only the installer's
// fields), and update.json.sig, update.json's signature by Gloom's release key: a
// newer release installs only when it's there and right (release-key.ts). The
// repo is private, so requests carry your `gh` login's token, or
// GLOOM_GITHUB_TOKEN when set. GLOOM_UPDATE_FROM=<folder> reads update.json and
// its files from a folder instead, to try an update without publishing it
// (`npm run release -- --local` makes one).
import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { UpdateState } from '@shared/ipc'
import { isNewer } from '@shared/version'
import { onPath } from './exec'
import { signedByReleaseKey } from './release-key'

const REPO = 'SilentGTX/Gloom'
const MANIFEST = 'update.json'
/** update.json's signature by the release key, base64. */
const SIGNATURE = 'update.json.sig'
const CHECK_EVERY_MS = 30 * 60 * 1000
/** A download that receives nothing for this long has stalled. */
const STALL_MS = 30_000

/** A file the release carries. */
export interface Asset {
  name: string
  sha256: string
  size: number
  /** Its id in the GitHub release. */
  assetId: number
}

export interface Release {
  version: string
  installer?: Asset
  /** The app itself, to unpack beside the running copy. */
  zip?: Asset
}

interface Manifest {
  version: string
  installer?: string
  sha256?: string
  size?: number
  zip?: string
  zipSha256?: string
  zipSize?: number
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

/** Update was clicked while Claude was working: the button says it installs once the sessions settle. */
export function setUpdateWaiting(waiting: boolean): void {
  if (!!state.waiting === waiting) return
  state = { ...state, waiting }
  for (const listener of listeners) listener(state)
}

async function githubToken(): Promise<string> {
  if (process.env.GLOOM_GITHUB_TOKEN) return process.env.GLOOM_GITHUB_TOKEN
  const gh = onPath('gh.exe')
  const token = await new Promise<string | null>((resolve) =>
    gh ? execFile(gh, ['auth', 'token'], { windowsHide: true, timeout: 5_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null)) : resolve(null)
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

/** GLOOM_UPDATE_FROM: a folder standing in for the latest release. */
const localSource = () => process.env.GLOOM_UPDATE_FROM || null

/** The files update.json names, found by `idOf` (undefined when the release lacks one). */
function releaseFrom(manifest: Manifest, idOf: (name: string) => number | undefined): Release {
  // The version names a folder Gloom empties and fills, and the files are saved by name: plain ones only.
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`${MANIFEST} names an odd version: ${String(manifest.version).slice(0, 40)}`)
  const asset = (name: string | undefined, sha256: string | undefined, size: number | undefined): Asset | undefined => {
    if (!name || !sha256 || size === undefined) return undefined
    if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new Error(`${MANIFEST} names an odd file: ${name.slice(0, 60)}`)
    const assetId = idOf(name)
    if (assetId === undefined) throw new Error(`The release lists ${name} but doesn't include it.`)
    return { name, sha256, size, assetId }
  }
  const release = { version: manifest.version, installer: asset(manifest.installer, manifest.sha256, manifest.size), zip: asset(manifest.zip, manifest.zipSha256, manifest.zipSize) }
  if (!release.installer && !release.zip) throw new Error(`${MANIFEST} names nothing to install.`)
  return release
}

/**
 * update.json's contents when they name a newer version than this one; null
 * when they don't. A newer one must carry the release key's signature of the
 * very bytes downloaded: an older one is ignored either way, so only it is checked.
 */
async function newerManifest(bytes: Buffer, signature: () => Promise<string | null>): Promise<Manifest | null> {
  const manifest = JSON.parse(bytes.toString('utf8')) as Manifest
  if (!isNewer(String(manifest.version), app.getVersion())) return null
  const signed = await signature()
  if (signed === null) throw new Error(`Gloom ${String(manifest.version).slice(0, 40)} isn’t signed, so it won’t be installed.`)
  if (!signedByReleaseKey(bytes, signed)) throw new Error(`Gloom ${String(manifest.version).slice(0, 40)} isn’t signed with Gloom’s release key, so it won’t be installed.`)
  return manifest
}

/** The latest release, if it's newer than this Gloom. Throws when GitHub can't be asked, or the release isn't signed. */
export async function findUpdate(timeoutMs: number): Promise<Release | null> {
  const source = localSource()
  if (source) {
    const sig = join(source, SIGNATURE)
    const manifest = await newerManifest(readFileSync(join(source, MANIFEST)), async () => (existsSync(sig) ? readFileSync(sig, 'utf8') : null))
    return manifest && releaseFrom(manifest, (name) => (existsSync(join(source, name)) ? 0 : undefined))
  }
  const signal = AbortSignal.timeout(timeoutMs)
  const token = await githubToken()
  const release = (await (await github(`/repos/${REPO}/releases/latest`, token, signal)).json()) as { assets: ReleaseAsset[] }
  const asset = (name: string) => release.assets.find((a) => a.name === name)
  const manifestAsset = asset(MANIFEST)
  if (!manifestAsset) throw new Error(`The latest release has no ${MANIFEST}.`)
  const fetchAsset = async (id: number) => (await github(`/repos/${REPO}/releases/assets/${id}`, token, signal, 'application/octet-stream')).arrayBuffer()
  const signatureAsset = asset(SIGNATURE)
  const manifest = await newerManifest(Buffer.from(await fetchAsset(manifestAsset.id)), async () =>
    signatureAsset ? Buffer.from(await fetchAsset(signatureAsset.id)).toString('utf8') : null
  )
  return manifest && releaseFrom(manifest, (name) => asset(name)?.id)
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

const downloads = () => join(app.getPath('userData'), 'updates')

/** Downloads are kept until they're installed; Gloom up to date, they go. */
export function removeDownloads(): void {
  try {
    rmSync(downloads(), { recursive: true, force: true })
  } catch (error) {
    console.warn('[updater]', error instanceof Error ? error.message : error)
  }
}

/**
 * Downloads one of the release's files, reporting the bytes received, and
 * checks its SHA-256. An intact earlier download is reused.
 */
export async function download(asset: Asset, onProgress: (received: number) => void): Promise<string> {
  const file = join(downloads(), asset.name)
  if (existsSync(file) && (await sha256Of(file)) === asset.sha256) {
    onProgress(asset.size)
    return file
  }
  mkdirSync(downloads(), { recursive: true })
  const part = `${file}.part`
  const stalled = new AbortController()
  let timer = setTimeout(() => stalled.abort(), STALL_MS)
  const hash = createHash('sha256')
  let received = 0
  try {
    const source = localSource()
    const body = source
      ? createReadStream(join(source, asset.name))
      : Readable.fromWeb((await github(`/repos/${REPO}/releases/assets/${asset.assetId}`, await githubToken(), stalled.signal, 'application/octet-stream')).body as unknown as WebReadableStream)
    await pipeline(
      body,
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
  if (hash.digest('hex') !== asset.sha256) {
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
