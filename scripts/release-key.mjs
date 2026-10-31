// Makes Gloom's release key, the Ed25519 key that signs every release's
// update.json (scripts/manifest.mjs):
//   node scripts/release-key.mjs
// The private half goes to ~/.gloom/release-key.pem (or GLOOM_RELEASE_KEY), on
// the PC releases are made from, and never into the repo; keep a copy somewhere
// safe. The public half it prints belongs in src/main/release-key.ts. Copies of
// Gloom only install releases signed by the key they carry, so a new key means
// installing the first release signed with it by hand, with its installer.
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const file = process.env.GLOOM_RELEASE_KEY || join(homedir(), '.gloom', 'release-key.pem')
if (existsSync(file)) throw new Error(`${file} already exists: Gloom's release key is made once.`)
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
console.log(`Private key: ${file} (keep a copy somewhere safe)`)
console.log(`Public key, for src/main/release-key.ts:\n${publicKey.export({ type: 'spki', format: 'pem' })}`)
