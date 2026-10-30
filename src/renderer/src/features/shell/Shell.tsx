import { useEffect, useState } from 'react'
import { useUi } from '../../stores/ui'
import { ChatColumn } from '../chat/ChatColumn'
import { FolderPanel } from '../folders/FolderColumn'
import { LibraryDnd } from '../library/drag'
import { SessionColumn } from '../sessions/SessionColumn'
import { CHAT_MIN, computeLayout, FOLDERS, SESSIONS } from './layout'
import { OverlaySheet } from './OverlaySheet'
import { Splitter } from './Splitter'
import type { LeadingControl } from './Toolbar'

/** The sidebar floats this far inside the window's edges. */
const FRAME = 8

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/**
 * macOS 26's composition: soft paper edge to edge across the whole window,
 * and the folder tree floating over it as one glass panel that carries Gloom's
 * dusk inside. The session list and chat each have a toolbar floating over
 * their top. Narrow windows fold the folders away first, then the list.
 */
export function Shell() {
  const width = useWindowWidth()
  const ui = useUi()
  const { foldersInline, sessionsInline } = computeLayout(width, ui)

  // A column that fits inline again doesn't need its sheet.
  const { overlay, closeOverlay } = ui
  useEffect(() => {
    if ((overlay === 'folders' && foldersInline) || (overlay === 'sessions' && sessionsInline)) closeOverlay(true)
  }, [overlay, foldersInline, sessionsInline, closeOverlay])

  const column = ui.folderWidth + FRAME * 2
  // A splitter may not push the chat under its minimum (which would fold a column away mid-drag).
  const folderMax = Math.max(FOLDERS.min, Math.min(FOLDERS.max, width - CHAT_MIN - FRAME * 2 - (sessionsInline ? ui.sessionWidth : 0)))
  const sessionMax = Math.max(SESSIONS.min, Math.min(SESSIONS.max, width - CHAT_MIN - (foldersInline ? column : 0)))

  // The sidebar holds the menu; without it, the first pane's toolbar does.
  const listLeading: LeadingControl[] = foldersInline ? [] : ['menu', 'folders']
  const chatLeading: LeadingControl[] = sessionsInline ? [] : foldersInline ? ['sessions'] : ['menu', 'folders', 'sessions']

  return (
    <LibraryDnd>
      <div className="paper relative flex h-full overflow-hidden">
        {foldersInline && (
          <>
            <div className="shrink-0 p-[var(--frame)]" style={{ width: column }}>
              <FolderPanel width={ui.folderWidth} />
            </div>
            <Splitter variant="edge" label="Resize folders" value={ui.folderWidth} min={FOLDERS.min} max={folderMax} initial={FOLDERS.initial} onChange={ui.setFolderWidth} />
          </>
        )}
        {sessionsInline && (
          <>
            <SessionColumn width={ui.sessionWidth} leading={listLeading} />
            <Splitter
              variant="hairline"
              label="Resize session list"
              value={ui.sessionWidth}
              min={SESSIONS.min}
              max={sessionMax}
              initial={SESSIONS.initial}
              onChange={ui.setSessionWidth}
            />
          </>
        )}
        <ChatColumn leading={chatLeading} withNewSession={!sessionsInline} />

        <OverlaySheet open={overlay === 'folders'} instant={ui.overlayInstant} area={{ inset: 0 }} inset={FRAME} width={ui.folderWidth} label="Folders" onClose={closeOverlay}>
          <FolderPanel width={ui.folderWidth} inSheet />
        </OverlaySheet>
        <OverlaySheet
          open={overlay === 'sessions'}
          instant={ui.overlayInstant}
          area={{ top: 0, bottom: 0, left: foldersInline ? column : 0, right: 0 }}
          inset={0}
          width={ui.sessionWidth}
          label="Sessions"
          onClose={closeOverlay}
        >
          <SessionColumn width={ui.sessionWidth} className="paper shadow-[var(--glass-shadow)]" />
        </OverlaySheet>
      </div>
    </LibraryDnd>
  )
}
