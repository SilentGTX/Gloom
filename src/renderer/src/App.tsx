import { useEffect, useLayoutEffect } from 'react'
import { TooltipProvider } from './components/ui/Tooltip'
import { useFinishedTracking } from './features/concept/finished'
import { usePetReport } from './features/pet/Pet'
import { Palette } from './features/palette/Palette'
import { SessionsSheetsHost } from './features/sessions/SheetsHost'
import { Shell } from './features/shell/Shell'
import { UpdatedNote } from './features/update/UpdateButton'
import { UpdateScreen } from './features/update/UpdateScreen'
import { useWaitingBadge } from './lib/badge'
import { useCommandBridge } from './lib/commands'
import { Toasts } from './lib/toast'
import { useUpdateScreen } from './lib/update'
import { useApplyWindowState, useWindowState } from './lib/window-state'
import { useLibraryBridge } from './stores/library'
import { startScreens } from './features/terminal/registry'
import { useLive, useLiveBridge } from './stores/live'
import { usePalette, useSessionVisits } from './stores/palette'
import { useTerminalsBridge } from './stores/terminals'
import { useTranscriptBridge } from './stores/transcript'
import { useUi } from './stores/ui'

export function App() {
  useApplyWindowState(useWindowState())
  useCommandBridge()
  useLibraryBridge()
  useTranscriptBridge()
  useLiveBridge()
  useTerminalsBridge()
  useEffect(() => startScreens(), [])
  useWaitingBadge()
  useSessionVisits()
  useFinishedTracking()
  usePetReport()
  const textScale = useUi((s) => s.textScale)
  const glassAlways = useUi((s) => s.glassAlways)
  const design = useUi((s) => s.design)
  const updateScreen = useUpdateScreen()
  const palette = usePalette((s) => s.open)
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(textScale))
  }, [textScale])
  useEffect(() => {
    document.documentElement.dataset.glass = glassAlways ? 'on' : 'auto'
  }, [glassAlways])
  // Before paint, so the first frame is already in the look you chose.
  useLayoutEffect(() => {
    document.documentElement.dataset.design = design
  }, [design])
  // Kept by main too, for the next window's first frame.
  const keptDesign = useLive((s) => s.settings.design)
  useEffect(() => {
    if (keptDesign !== design) void useLive.getState().updateSettings({ design })
  }, [design, keptDesign])

  return (
    <TooltipProvider>
      {/* Under the update screen or the command palette the app can't be reached, by pointer, keyboard or screen reader. */}
      <div className="contents" inert={updateScreen !== null || palette}>
        <Shell />
        <SessionsSheetsHost />
        <UpdatedNote />
        <Toasts />
      </div>
      <Palette blocked={updateScreen !== null} />
      <UpdateScreen screen={updateScreen} />
    </TooltipProvider>
  )
}
