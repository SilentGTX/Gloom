// Releases are signed. scripts/manifest.mjs signs each release's update.json
// with Gloom's release key (Ed25519; the private half stays on the PC releases
// are made from, scripts/release-key.mjs), and the updater checks it against
// the public half below before it trusts anything the release says. update.json
// names the SHA-256 of the installer and the zip, so the signature covers them
// too: someone who got hold of the GitHub account, or the token Gloom asks gh
// for, could publish a release, but not one Gloom would install.
import { createPublicKey, verify } from 'node:crypto'

export const RELEASE_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAk0KynmsEj+Vb834YEWOW/N0L4OHmdD4c9NK4uZbpP5s=
-----END PUBLIC KEY-----
`

/** Whether `signature` (base64, as update.json.sig holds it) is the release key's signature of exactly these bytes. */
export function signedByReleaseKey(manifest: Buffer, signature: string, key = RELEASE_KEY): boolean {
  try {
    return verify(null, manifest, createPublicKey(key), Buffer.from(signature.trim(), 'base64'))
  } catch {
    return false
  }
}
