// Publishes a GitHub release that installed copies of Gloom update to:
//   npm run release -- [release notes]
// Builds the installer and the app's zip from the current commit (which must
// be committed and pushed: the release is tagged v<version> at it), then
// uploads them with update.json, the manifest the updater reads:
//   { "version", "installer", "sha256", "size", "zip", "zipSha256", "zipSize" }
// Gloom unpacks the zip beside the running copy; older versions of Gloom read
// only the installer's fields.
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'SilentGTX/Gloom'
const root = join(import.meta.dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

if (git('status', '--porcelain')) throw new Error('Commit your changes first: the release is built from HEAD and tagged at it.')
const commit = git('rev-parse', 'HEAD')
if (!git('branch', '-r', '--contains', commit)) throw new Error('Push HEAD first: GitHub tags the release at it.')

execSync('npm run dist', { cwd: root, stdio: 'inherit' })

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dir = join(root, 'release', version)
const installer = `Gloom-Setup-${version}.exe`
const zip = `Gloom-${version}-win.zip`
const bytes = readFileSync(join(dir, installer))
const zipBytes = readFileSync(join(dir, zip))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const manifest = { version, installer, sha256: sha256(bytes), size: bytes.length, zip, zipSha256: sha256(zipBytes), zipSize: zipBytes.length }
writeFileSync(join(dir, 'update.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const notes = process.argv.slice(2).join(' ') || `Gloom ${version}`
execFileSync(
  'gh',
  ['release', 'create', `v${version}`, join(dir, installer), join(dir, zip), join(dir, 'update.json'), '--repo', REPO, '--target', commit, '--title', `Gloom ${version}`, '--notes', notes],
  { cwd: root, stdio: 'inherit' }
)
console.log(`Released Gloom ${version}: ${installer}, ${(bytes.length / 1e6).toFixed(1)} MB; ${zip}, ${(zipBytes.length / 1e6).toFixed(1)} MB`)
