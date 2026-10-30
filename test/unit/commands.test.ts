import { describe, expect, it } from 'vitest'
import { COMMANDS, formatAccelerator, type CommandSpec } from '../../src/shared/commands'

const specs = COMMANDS as readonly CommandSpec[]

describe('command registry', () => {
  it('has unique ids and unique shortcuts', () => {
    const ids = specs.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const accelerators = specs.flatMap((c) => (c.accelerator ? [c.accelerator] : []))
    expect(new Set(accelerators).size).toBe(accelerators.length)
  })

  it('shows shortcuts the way Windows does', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+N')).toBe('Ctrl+Shift+N')
    expect(formatAccelerator('CmdOrCtrl+=')).toBe('Ctrl+=')
    expect(formatAccelerator('F11')).toBe('F11')
  })
})
