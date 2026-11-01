import { RewindSheet } from '../chat/Rewind'
import { MergeSheet, RemoveWorktreeSheet } from '../chat/Worktree'
import { SettingsSheet } from '../settings/Settings'
import { RoutinesSheet } from '../routines/RoutinesSheet'

/** The window-wide sheets: Settings, Rewind, Merge, a worktree's removal and Routines. One shows at a time. A new session is the chat itself (NewSessionView). */
export function SessionsSheetsHost() {
  return (
    <>
      <SettingsSheet />
      <RewindSheet />
      <MergeSheet />
      <RemoveWorktreeSheet />
      <RoutinesSheet />
    </>
  )
}
