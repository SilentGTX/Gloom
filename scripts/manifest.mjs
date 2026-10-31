// Writes a built release's update.json, the manifest the updater reads, and
// update.json.sig, its signature by Gloom's release key (src/main/release-key.ts):
//   node scripts/manifest.mjs release/<version> [version]
// scripts/release.mjs runs it before publishing; on its own, it makes a folder
// GLOOM_UPDATE_FROM can try an update from. The key is ~/.gloom/release-key.pem,
// or GLOOM_RELEASE_KEY.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const KEY_FILE = process.env.GLOOM_RELEASE_KEY || join(homedir(), '.gloom', 'release-key.pem')

/** The release key, once it's shown to be the one Gloom carries (a release signed with any other wouldn't install). */
export function releaseKey() {
  if (!existsSync(KEY_FILE)) throw new Error(`No release key at ${KEY_FILE}: releases are signed with it (scripts/release-key.mjs).`)
  const key = createPrivateKey(readFileSync(KEY_FILE))
  const carried = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'release-key.ts'), 'utf8').match(/-----BEGIN PUBLIC KEY-----[^-]+-----END PUBLIC KEY-----/)?.[0]
  const own = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString().trim()
  if (carried?.replace(/\s+/g, '') !== own.replace(/\s+/g, '')) throw new Error(`${KEY_FILE} isn't the key in src/main/release-key.ts: Gloom wouldn't install what it signs.`)
  return key
}

/** The files of `version` in `dir`, with update.json and its signature written beside them. */
export function writeManifest(dir, version) {
  const key = releaseKey()
  const installer = `Gloom-Setup-${version}.exe`
  const zip = `Gloom-${version}-win.zip`
  const sha256 = (data) => createHash('sha256').update(data).digest('hex')
  const manifest = { version }
  if (existsSync(join(dir, installer))) {
    const bytes = readFileSync(join(dir, installer))
    Object.assign(manifest, { installer, sha256: sha256(bytes), size: bytes.length })
  }
  if (existsSync(join(dir, zip))) {
    const bytes = readFileSync(join(dir, zip))
    Object.assign(manifest, { zip, zipSha256: sha256(bytes), zipSize: bytes.length })
  }
  if (!manifest.installer && !manifest.zip) throw new Error(`${dir} holds neither ${installer} nor ${zip}.`)
  const json = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(dir, 'update.json'), json)
  // Ed25519 signs the bytes themselves: Gloom checks exactly what it downloads.
  writeFileSync(join(dir, 'update.json.sig'), `${sign(null, json, key).toString('base64')}\n`)
  return { manifest, files: [manifest.installer, manifest.zip, 'update.json', 'update.json.sig'].filter(Boolean).map((name) => join(dir, name)) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = resolve(process.argv[2] ?? '')
  const { manifest } = writeManifest(dir, process.argv[3] ?? basename(dir))
  console.log(`Signed update.json for Gloom ${manifest.version} in ${dir}`)
}
