// Publishes a GitHub release that installed copies of Gloom update to:
//   npm run release -- [release notes]
// Builds the installer and the app's zip from the current commit (which must
// be committed and pushed: the release is tagged v<version> at it), then
// uploads them with update.json, the manifest the updater reads, and its
// signature by Gloom's release key (scripts/manifest.mjs):
//   { "version", "installer", "sha256", "size", "zip", "zipSha256", "zipSize" }
// Gloom unpacks the zip beside the running copy; older versions of Gloom read
// only the installer's fields, and those before 0.10 don't check the signature.
//   npm run release -- --local
// does everything but publish, for a folder GLOOM_UPDATE_FROM can try.
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { releaseKey, writeManifest } from './manifest.mjs'

const REPO = 'SilentGTX/Gloom'
const root = join(import.meta.dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const local = process.argv.includes('--local')

// Before the build, which takes a while: a release Gloom wouldn't install is no release.
releaseKey()
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// The build goes to release/<version>, over what's there: never over a version that's out.
if (git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)) throw new Error(`Gloom ${version} is out already: bump the version in package.json first.`)
const commit = git('rev-parse', 'HEAD')
if (!local) {
  if (git('status', '--porcelain')) throw new Error('Commit your changes first: the release is built from HEAD and tagged at it.')
  if (!git('branch', '-r', '--contains', commit)) throw new Error('Push HEAD first: GitHub tags the release at it.')
}

execSync('npm run dist', { cwd: root, stdio: 'inherit' })

const dir = join(root, 'release', version)
const { manifest, files } = writeManifest(dir, version)
const sizes = `${manifest.installer}, ${(manifest.size / 1e6).toFixed(1)} MB; ${manifest.zip}, ${(manifest.zipSize / 1e6).toFixed(1)} MB`
if (local) {
  console.log(`Built and signed Gloom ${version} in ${dir} (${sizes}); try it with GLOOM_UPDATE_FROM=${dir}`)
  process.exit(0)
}

const notes = process.argv.slice(2).join(' ') || `Gloom ${version}`
execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--repo', REPO, '--target', commit, '--title', `Gloom ${version}`, '--notes', notes], { cwd: root, stdio: 'inherit' })
console.log(`Released Gloom ${version}: ${sizes}`)
