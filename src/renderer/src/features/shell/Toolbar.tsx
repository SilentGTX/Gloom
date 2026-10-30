import type { ReactNode } from 'react'
import { List, PanelLeft } from 'lucide-react'
import { formatAccelerator } from '@shared/commands'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { runCommand } from '../../lib/commands'
import { cn } from '../../lib/cn'
import { AppMenu } from './AppMenu'

/**
 * A column's top bar. It doubles as the window's title bar, so it drags the
 * window; the rightmost one keeps clear of the caption buttons.
 */
export function Toolbar({ children, className, clearCaptionButtons }: { children: ReactNode; className?: string; clearCaptionButtons?: boolean }) {
  return (
    <header
      className={cn('drag flex h-[var(--titlebar-h)] shrink-0 items-center gap-1 px-2', className)}
      style={clearCaptionButtons ? { paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 8px)' } : undefined}
    >
      {children}
    </header>
  )
}

export type LeadingControl = 'menu' | 'folders' | 'sessions'

/** The menu button and the buttons that bring back collapsed columns, in the first visible column. */
export function LeadingControls({ controls }: { controls: LeadingControl[] }) {
  if (controls.length === 0) return null
  return (
    <div className="flex items-center gap-0.5">
      {controls.includes('menu') && <AppMenu />}
      {controls.includes('folders') && (
        <Tooltip label="Show Folders" shortcut={formatAccelerator('CmdOrCtrl+B')}>
          <Button aria-label="Show folders" onClick={() => runCommand('view.toggleFolders')}>
            <PanelLeft size={16} strokeWidth={1.75} />
          </Button>
        </Tooltip>
      )}
      {controls.includes('sessions') && (
        <Tooltip label="Show Session List" shortcut={formatAccelerator('CmdOrCtrl+Shift+B')}>
          <Button aria-label="Show session list" onClick={() => runCommand('view.toggleSessions')}>
            <List size={16} strokeWidth={1.75} />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
