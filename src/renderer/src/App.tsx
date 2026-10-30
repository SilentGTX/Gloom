import { useEffect } from 'react'
import { TooltipProvider } from './components/ui/Tooltip'
import { Shell } from './features/shell/Shell'
import { UpdatedNote } from './features/update/UpdateButton'
import { useCommandBridge } from './lib/commands'
import { Toasts } from './lib/toast'
import { useApplyWindowState, useWindowState } from './lib/window-state'
import { useLibrary, useLibraryBridge } from './stores/library'
import { useTranscriptBridge } from './stores/transcript'
import { useUi } from './stores/ui'

export function App() {
  useApplyWindowState(useWindowState())
  useCommandBridge()
  useLibraryBridge()
  useTranscriptBridge()
  usePlaceGuard()
  const textScale = useUi((s) => s.textScale)
  const glassAlways = useUi((s) => s.glassAlways)
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(textScale))
  }, [textScale])
  useEffect(() => {
    document.documentElement.dataset.glass = glassAlways ? 'on' : 'auto'
  }, [glassAlways])

  return (
    <TooltipProvider>
      <Shell />
      <UpdatedNote />
      <Toasts />
    </TooltipProvider>
  )
}

/** A folder that's gone (deleted, or never loaded) sends the list back to All Sessions. */
function usePlaceGuard(): void {
  const place = useUi((s) => s.place)
  const rev = useLibrary((s) => s.rev)
  const exists = useLibrary((s) => !('folder' in place) || s.library.folders.some((f) => f.id === place.folder))
  useEffect(() => {
    if (rev > 0 && !exists) useUi.getState().go({ smart: 'all' })
  }, [rev, exists])
}
