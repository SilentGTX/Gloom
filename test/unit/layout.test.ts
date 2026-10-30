import { describe, expect, it } from 'vitest'
import { CHAT_MIN, computeLayout, FOLDERS, SESSIONS } from '../../src/renderer/src/features/shell/layout'

const prefs = { folderWidth: FOLDERS.initial, sessionWidth: SESSIONS.initial, foldersHidden: false, sessionsHidden: false }
const both = FOLDERS.initial + SESSIONS.initial + CHAT_MIN

describe('computeLayout', () => {
  it('shows all three columns when they fit', () => {
    expect(computeLayout(both, prefs)).toMatchObject({ foldersInline: true, sessionsInline: true })
  })

  it('folds the folders away first', () => {
    expect(computeLayout(both - 1, prefs)).toMatchObject({ foldersInline: false, sessionsInline: true })
  })

  it('never keeps the folders once the session list has gone, even where they alone would fit', () => {
    const width = SESSIONS.initial + CHAT_MIN - 1 // room for the folders (232), not the list (320)
    expect(computeLayout(width, prefs)).toMatchObject({ foldersInline: false, sessionsInline: false })
  })

  it('lets the folders use the room of a session list you hid', () => {
    const layout = computeLayout(FOLDERS.initial + CHAT_MIN, { ...prefs, sessionsHidden: true })
    expect(layout).toMatchObject({ foldersInline: true, sessionsInline: false })
  })

  it('keeps hidden columns hidden however wide the window is', () => {
    expect(computeLayout(4000, { ...prefs, foldersHidden: true })).toMatchObject({ foldersInline: false, foldersFit: true })
  })
})
