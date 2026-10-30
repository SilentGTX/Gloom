import { describe, expect, it } from 'vitest'
import { CHAT_MIN, computeLayout, SIDEBAR } from '../../src/renderer/src/features/shell/layout'

const prefs = { sidebarWidth: SIDEBAR.initial, sidebarHidden: false }

describe('computeLayout', () => {
  it('keeps the sidebar beside the chat when both fit', () => {
    expect(computeLayout(SIDEBAR.initial + CHAT_MIN, prefs)).toMatchObject({ sidebarInline: true, sidebarFits: true })
  })

  it('folds the sidebar away once the chat would drop below its minimum', () => {
    expect(computeLayout(SIDEBAR.initial + CHAT_MIN - 1, prefs)).toMatchObject({ sidebarInline: false, sidebarFits: false })
  })

  it('keeps a hidden sidebar hidden however wide the window is', () => {
    expect(computeLayout(4000, { ...prefs, sidebarHidden: true })).toMatchObject({ sidebarInline: false, sidebarFits: true })
  })
})
