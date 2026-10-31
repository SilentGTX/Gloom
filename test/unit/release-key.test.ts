import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { signedByReleaseKey } from '../../src/main/release-key'

describe('a release is installed only with the release key’s signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const key = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const manifest = Buffer.from('{\n  "version": "1.2.3",\n  "zip": "Gloom-1.2.3-win.zip",\n  "zipSha256": "ab12"\n}\n')
  const signature = sign(null, manifest, privateKey).toString('base64')

  it('takes the signature of exactly these bytes', () => {
    expect(signedByReleaseKey(manifest, signature, key)).toBe(true)
    expect(signedByReleaseKey(manifest, `${signature}\n`, key)).toBe(true)
  })

  it('refuses anything else', () => {
    expect(signedByReleaseKey(Buffer.from(manifest.toString().replace('ab12', 'cd34')), signature, key)).toBe(false)
    expect(signedByReleaseKey(Buffer.from(manifest.toString().replace('\n', '\r\n')), signature, key)).toBe(false)
    expect(signedByReleaseKey(manifest, signature)).toBe(false)
    expect(signedByReleaseKey(manifest, '', key)).toBe(false)
    expect(signedByReleaseKey(manifest, 'not base64 at all!', key)).toBe(false)
    expect(signedByReleaseKey(manifest, signature, 'not a key')).toBe(false)
  })

  // The whole chain, where the release key lives: what scripts/manifest.mjs signs, Gloom installs.
  const keyFile = process.env.GLOOM_RELEASE_KEY || join(homedir(), '.gloom', 'release-key.pem')
  it.skipIf(!existsSync(keyFile))('takes what scripts/manifest.mjs signs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gloom-release-'))
    writeFileSync(join(dir, 'Gloom-1.2.3-win.zip'), 'zip')
    const script = pathToFileURL(join(__dirname, '..', '..', 'scripts', 'manifest.mjs')).href
    const { writeManifest } = (await import(/* @vite-ignore */ script)) as { writeManifest(dir: string, version: string): { manifest: { zipSize: number } } }
    expect(writeManifest(dir, '1.2.3').manifest.zipSize).toBe(3)
    const json = readFileSync(join(dir, 'update.json'))
    expect(signedByReleaseKey(json, readFileSync(join(dir, 'update.json.sig'), 'utf8'))).toBe(true)
    expect(signedByReleaseKey(Buffer.from(json.toString().replace('1.2.3', '1.2.4')), readFileSync(join(dir, 'update.json.sig'), 'utf8'))).toBe(false)
  })
})
