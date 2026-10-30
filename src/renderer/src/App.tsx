import { useEffect } from 'react'
import { TooltipProvider } from './components/ui/Tooltip'
import { Shell } from './features/shell/Shell'
import { useCommandBridge } from './lib/commands'
import { useApplyWindowState, useWindowState } from './lib/window-state'
import { useUi } from './stores/ui'

export function App() {
  useApplyWindowState(useWindowState())
  useCommandBridge()
  const textScale = useUi((s) => s.textScale)
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(textScale))
  }, [textScale])

  return (
    <TooltipProvider>
      <Shell />
    </TooltipProvider>
  )
}
