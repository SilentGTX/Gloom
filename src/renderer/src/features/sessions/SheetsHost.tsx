import { RewindSheet } from '../chat/Rewind'
import { MergeSheet, RemoveWorktreeSheet } from '../chat/Worktree'
import { SettingsSheet } from '../settings/Settings'
import { NewSessionSheet } from './NewSession'

/** The window-wide sheets: New Session, Settings, Rewind, Merge and a worktree's removal. One shows at a time. */
export function SessionsSheetsHost() {
  return (
    <>
      <NewSessionSheet />
      <SettingsSheet />
      <RewindSheet />
      <MergeSheet />
      <RemoveWorktreeSheet />
    </>
  )
}
