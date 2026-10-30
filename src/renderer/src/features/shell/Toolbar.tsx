import type { ReactNode } from 'react'
import { FileDiff, List, PanelLeft, SquarePen, SquareTerminal } from 'lucide-react'
import { formatAccelerator } from '@shared/commands'
import { Button } from '../../components/ui/Button'
import { GlassCapsule } from '../../components/ui/Glass'
import { Tooltip } from '../../components/ui/Tooltip'
import { runCommand } from '../../lib/commands'
import { AppMenu } from './AppMenu'

export type LeadingControl = 'menu' | 'folders' | 'sessions'

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

/** The pane's title, large and bold. Pixel-capped: the bar's height is fixed. */
export function BarTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="min-w-0 truncate px-1 font-display text-[min(1.25rem,20px)] font-bold tracking-[var(--tracking-title)] text-label">{children}</h1>
  )
}

/** The menu and the buttons that bring back collapsed columns, when the sidebar isn't there to hold them. */
export function LeadingControls({ controls }: { controls: LeadingControl[] }) {
  if (controls.length === 0) return null
  return (
    <GlassCapsule label="Navigation">
      {controls.includes('menu') && <AppMenu shape="round" />}
      {controls.includes('folders') && (
        <Tooltip label="Show Folders" shortcut={formatAccelerator('CmdOrCtrl+B')}>
          <Button aria-label="Show folders" shape="round" onClick={() => runCommand('view.toggleFolders')}>
            <PanelLeft size={16} strokeWidth={1.75} />
          </Button>
        </Tooltip>
      )}
      {controls.includes('sessions') && (
        <Tooltip label="Show Session List" shortcut={formatAccelerator('CmdOrCtrl+Shift+B')}>
          <Button aria-label="Show session list" shape="round" onClick={() => runCommand('view.toggleSessions')}>
            <List size={16} strokeWidth={1.75} />
          </Button>
        </Tooltip>
      )}
    </GlassCapsule>
  )
}

export function NewSessionButton() {
  return (
    <GlassCapsule>
      <Tooltip label="New Session" shortcut="Ctrl+N">
        <Button aria-label="New session" shape="round" disabled>
          <SquarePen size={16} strokeWidth={1.75} />
        </Button>
      </Tooltip>
    </GlassCapsule>
  )
}

export function ChatControls() {
  return (
    <GlassCapsule label="Panes">
      <Tooltip label="Diff" shortcut="Ctrl+Shift+D">
        <Button aria-label="Diff pane" shape="round" disabled>
          <FileDiff size={16} strokeWidth={1.75} />
        </Button>
      </Tooltip>
      <Tooltip label="Terminal" shortcut="Ctrl+`">
        <Button aria-label="Terminal" shape="round" disabled>
          <SquareTerminal size={16} strokeWidth={1.75} />
        </Button>
      </Tooltip>
    </GlassCapsule>
  )
}
