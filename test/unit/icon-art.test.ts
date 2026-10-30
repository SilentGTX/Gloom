import { describe, expect, it } from 'vitest'
import { iconDetailFor, iconSvg, sparklePath } from '../../src/shared/icon-art'

describe('app icon', () => {
  it('drops the small sparkles where they would turn to specks', () => {
    expect(iconDetailFor(16)).toBe('small')
    expect(iconDetailFor(24)).toBe('small')
    expect(iconDetailFor(32)).toBe('medium')
    expect(iconDetailFor(48)).toBe('full')
    expect(iconSvg({ size: 16 })).not.toContain('sparkle-top')
    expect(iconSvg({ size: 256 })).toContain('sparkle-low')
  })

  it('draws a closed four-point sparkle', () => {
    const d = sparklePath(50, 50, 40, 0.2)
    expect(d.startsWith('M50 10')).toBe(true)
    expect(d.match(/Q/g)).toHaveLength(4)
    expect(d.endsWith('Z')).toBe(true)
  })

  it('keeps ids apart for copies on one page', () => {
    expect(iconSvg({ size: 96, id: 'a' })).toContain('id="a-bg"')
    expect(iconSvg({ size: 96, id: 'b' })).not.toContain('id="a-bg"')
  })
})
