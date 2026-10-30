import type { ReactNode } from 'react'
import { PanelLeft, SquarePen } from 'lucide-react'
import { formatAccelerator } from '@shared/commands'
import { Button } from '../../components/ui/Button'
import { GlassCapsule } from '../../components/ui/Glass'
import { Tooltip } from '../../components/ui/Tooltip'
import { runCommand } from '../../lib/commands'
import { AppMenu } from './AppMenu'

/**
 * A pane's toolbar, floating over the top of its content the way macOS 26
 * integrates the toolbar with the title bar: title and navigation leading,
 * actions trailing. It is the window's title bar too, so it drags the window;
 * the rightmost one keeps clear of the caption buttons.
 */
export function PaneToolbar({ children, clearCaptionButtons }: { children: ReactNode; clearCaptionButtons?: boolean }) {
  return (
    <header
      className="drag absolute inset-x-0 top-0 z-10 flex h-[var(--titlebar-h)] items-center gap-2 px-3"
      style={clearCaptionButtons ? { paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 8px)' } : undefined}
    >
      {children}
    </header>
  )
}

/** The pane's title, with what it's doing beside it ("Active now"). Pixel-capped: the bar's height is fixed. */
export function BarTitle({ children, status }: { children: ReactNode; status?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 px-1">
      <h1 className="min-w-0 truncate font-display text-[min(0.9375rem,18px)] font-bold tracking-[-0.01em] text-label">{children}</h1>
      {status && <span className="shrink-0 text-[min(0.75rem,14px)] text-label-secondary tabular">{status}</span>}
    </div>
  )
}

/** With the sidebar away, its menu and New Session ride at the chat toolbar's leading edge. */
export function SidebarStandIns() {
  return (
    <GlassCapsule label="Navigation">
      <AppMenu shape="round" />
      <Tooltip label="New Session" shortcut="Ctrl+N">
        <Button aria-label="New session" shape="round" disabled>
          <SquarePen size={16} strokeWidth={1.75} />
        </Button>
      </Tooltip>
    </GlassCapsule>
  )
}

/** Shows or hides the sidebar: inline when the window has room, else as a sheet. */
export function SidebarButton({ shown }: { shown: boolean }) {
  return (
    <Tooltip label={shown ? 'Hide Sidebar' : 'Show Sidebar'} shortcut={formatAccelerator('CmdOrCtrl+B')}>
      <Button aria-label={shown ? 'Hide sidebar' : 'Show sidebar'} shape="round" onClick={() => runCommand('view.toggleSidebar')}>
        <PanelLeft size={16} strokeWidth={1.75} />
      </Button>
    </Tooltip>
  )
}
