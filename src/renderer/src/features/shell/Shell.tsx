import { useEffect, useState } from 'react'
import { useUi } from '../../stores/ui'
import { CHAT_MIN, computeLayout, FOLDERS, SESSIONS } from './layout'
import { ChatColumn } from '../chat/ChatColumn'
import { FolderColumn } from '../folders/FolderColumn'
import { SessionColumn } from '../sessions/SessionColumn'
import { OverlaySheet } from './OverlaySheet'
import { Splitter } from './Splitter'
import type { LeadingControl } from './Toolbar'

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/** Folder tree | session list | chat. Narrow windows fold the folders away first, then the list. */
export function Shell() {
  const width = useWindowWidth()
  const ui = useUi()
  const { foldersInline, sessionsInline } = computeLayout(width, ui)

  // A column that fits inline again doesn't need its sheet.
  const { overlay, closeOverlay } = ui
  useEffect(() => {
    if ((overlay === 'folders' && foldersInline) || (overlay === 'sessions' && sessionsInline)) closeOverlay(true)
  }, [overlay, foldersInline, sessionsInline, closeOverlay])

  // A splitter may not push the chat under its minimum (which would fold a column away mid-drag).
  const folderMax = Math.max(FOLDERS.min, Math.min(FOLDERS.max, width - CHAT_MIN - (sessionsInline ? ui.sessionWidth : 0)))
  const sessionMax = Math.max(SESSIONS.min, Math.min(SESSIONS.max, width - CHAT_MIN - (foldersInline ? ui.folderWidth : 0)))

  const sessionsLeading: LeadingControl[] = foldersInline ? [] : ['menu', 'folders']
  const chatLeading: LeadingControl[] = sessionsInline ? [] : foldersInline ? ['sessions'] : ['menu', 'folders', 'sessions']

  return (
    <div className="relative flex h-full overflow-hidden">
      {foldersInline && (
        <>
          <FolderColumn width={ui.folderWidth} leading={['menu']} />
          <Splitter label="Resize folders" value={ui.folderWidth} min={FOLDERS.min} max={folderMax} initial={FOLDERS.initial} onChange={ui.setFolderWidth} />
        </>
      )}
      {sessionsInline && (
        <>
          <SessionColumn width={ui.sessionWidth} leading={sessionsLeading} />
          <Splitter label="Resize session list" value={ui.sessionWidth} min={SESSIONS.min} max={sessionMax} initial={SESSIONS.initial} onChange={ui.setSessionWidth} />
        </>
      )}
      <ChatColumn leading={chatLeading} />

      <OverlaySheet open={overlay === 'folders'} instant={ui.overlayInstant} left={0} width={ui.folderWidth} label="Folders" onClose={closeOverlay}>
        <FolderColumn width={ui.folderWidth} leading={['menu']} inSheet />
      </OverlaySheet>
      <OverlaySheet
        open={overlay === 'sessions'}
        instant={ui.overlayInstant}
        left={foldersInline ? ui.folderWidth : 0}
        width={ui.sessionWidth}
        label="Sessions"
        onClose={closeOverlay}
      >
        <SessionColumn width={ui.sessionWidth} leading={[]} inSheet />
      </OverlaySheet>
    </div>
  )
}
