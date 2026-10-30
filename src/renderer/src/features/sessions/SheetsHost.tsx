import { SettingsSheet } from '../settings/Settings'
import { NewSessionSheet } from './NewSession'

/** The window-wide sheets: New Session and Settings. One shows at a time. */
export function SessionsSheetsHost() {
  return (
    <>
      <NewSessionSheet />
      <SettingsSheet />
    </>
  )
}
