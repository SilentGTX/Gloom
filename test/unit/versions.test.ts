import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installRoot, newestStarted } from '../../src/main/versions'

describe('versions installed beside the installer’s copy', () => {
  it('finds the install folder from a version inside it', () => {
    expect(installRoot('C:\\Apps\\Gloom\\Gloom.exe')).toBe('C:\\Apps\\Gloom')
    expect(installRoot('C:\\Apps\\Gloom\\versions\\0.7.0\\Gloom.exe')).toBe('C:\\Apps\\Gloom')
  })

  it('starts the newest version that has shown its window before', () => {
    const root = mkdtempSync(join(tmpdir(), 'gloom-versions-'))
    const version = (name: string, started: boolean) => {
      const dir = join(root, 'versions', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'Gloom.exe'), '')
      if (started) writeFileSync(join(dir, '.started'), '')
    }
    version('0.7.0', true)
    version('0.7.1', true)
    // Never got its window up, half unpacked, not a version: none of these run.
    version('0.7.2', false)
    version('0.7.3.partial', true)
    version('notes', true)
    expect(newestStarted(root, '0.6.2', 'Gloom.exe')?.version).toBe('0.7.1')
    expect(newestStarted(root, '0.6.2', 'Gloom.exe')?.exe).toBe(join(root, 'versions', '0.7.1', 'Gloom.exe'))
    // The installer's copy is already as new: it runs itself.
    expect(newestStarted(root, '0.7.1', 'Gloom.exe')).toBeNull()
    expect(newestStarted(join(root, 'nowhere'), '0.6.2', 'Gloom.exe')).toBeNull()
  })
})
