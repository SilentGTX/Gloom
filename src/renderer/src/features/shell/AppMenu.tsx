import { Fragment } from 'react'
import { Menu as MenuIcon } from 'lucide-react'
import { COMMANDS, formatAccelerator, GROUP_LABELS, type CommandGroup, type CommandId, type CommandSpec } from '@shared/commands'
import { Button } from '../../components/ui/Button'
import { MenuCheckItem, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { runCommand } from '../../lib/commands'
import { useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { computeLayout } from './layout'

const ORDER: CommandGroup[] = ['file', 'edit', 'view', 'help', 'developer']

/** Every command, since Windows draws no menu bar here. Toggles say what they will do. */
export function AppMenu({ shape = 'rounded' }: { shape?: 'rounded' | 'round' }) {
  const ui = useUi()
  const lastUndo = useLibrary((s) => s.undoStack.at(-1))
  const layout = computeLayout(window.innerWidth, ui)
  const foldersShown = layout.foldersInline || ui.overlay === 'folders'
  const sessionsShown = layout.sessionsInline || ui.overlay === 'sessions'
  // Toggles say what they will do; Undo says what it undoes ("Undo Archive").
  const labelOf = (c: CommandSpec) => {
    if (c.id === 'edit.undo') return lastUndo ? `Undo ${lastUndo.label}` : 'Undo'
    if (c.id === 'view.toggleFolders') return foldersShown ? 'Hide Folders' : 'Show Folders'
    if (c.id === 'view.toggleSessions') return sessionsShown ? 'Hide Session List' : 'Show Session List'
    return c.label
  }

  const groups = ORDER.map((group) => ({ group, commands: (COMMANDS as readonly CommandSpec[]).filter((c) => c.group === group) }))
  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button aria-label="Menu" shape={shape}>
            <MenuIcon size={16} strokeWidth={1.75} />
          </Button>
        }
      />
      <MenuPopup>
        {groups.map(({ group, commands }, i) => (
          <Fragment key={group}>
            {i > 0 && <MenuSeparator />}
            <MenuGroup>
              <MenuGroupLabel>{GROUP_LABELS[group]}</MenuGroupLabel>
              {commands.map((c) =>
                c.id === 'view.toggleGlass' ? (
                  <MenuCheckItem key={c.id} label={c.label} checked={ui.glassAlways} onClick={() => runCommand(c.id as CommandId)} />
                ) : (
                  <MenuItem
                    key={c.id}
                    label={labelOf(c)}
                    shortcut={c.accelerator ? formatAccelerator(c.accelerator) : undefined}
                    disabled={!!c.arrivesIn || (c.id === 'edit.undo' && !lastUndo)}
                    note={c.arrivesIn}
                    onClick={() => runCommand(c.id as CommandId)}
                  />
                )
              )}
            </MenuGroup>
          </Fragment>
        ))}
      </MenuPopup>
    </MenuRoot>
  )
}
