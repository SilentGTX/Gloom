import { useEffect } from 'react'
import { TooltipProvider } from './components/ui/Tooltip'
import { Shell } from './features/shell/Shell'
import { UpdatedNote } from './features/update/UpdateButton'
import { useCommandBridge } from './lib/commands'
import { useApplyWindowState, useWindowState } from './lib/window-state'
import { useUi } from './stores/ui'

export function App() {
  useApplyWindowState(useWindowState())
  useCommandBridge()
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
    </TooltipProvider>
  )
}
