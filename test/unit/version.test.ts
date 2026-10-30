import { describe, expect, it } from 'vitest'
import { isNewer } from '../../src/shared/version'

describe('isNewer', () => {
  it('compares each part as a number', () => {
    expect(isNewer('0.2.1', '0.2.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  })

  it('is false for the same or an older version', () => {
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
  })

  it('ignores a leading v and a prerelease tag', () => {
    expect(isNewer('v0.3.0', '0.2.9')).toBe(true)
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false)
  })
})
