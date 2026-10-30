import { Fragment } from 'react'
import { Menu as MenuIcon } from 'lucide-react'
import { COMMANDS, formatAccelerator, GROUP_LABELS, type CommandGroup, type CommandId, type CommandSpec } from '@shared/commands'
import { Button } from '../../components/ui/Button'
import { MenuCheckItem, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { runCommand } from '../../lib/commands'
import { useUi } from '../../stores/ui'
import { computeLayout } from './layout'

const ORDER: CommandGroup[] = ['file', 'view', 'help', 'developer']

/** Every command, since Windows draws no menu bar here. Toggles say what they will do. */
export function AppMenu({ shape = 'rounded' }: { shape?: 'rounded' | 'round' }) {
  const ui = useUi()
  const layout = computeLayout(window.innerWidth, ui)
  const foldersShown = layout.foldersInline || ui.overlay === 'folders'
  const sessionsShown = layout.sessionsInline || ui.overlay === 'sessions'
  const labelOf = (c: CommandSpec) =>
    c.id === 'view.toggleFolders'
      ? foldersShown
        ? 'Hide Folders'
        : 'Show Folders'
      : c.id === 'view.toggleSessions'
        ? sessionsShown
          ? 'Hide Session List'
          : 'Show Session List'
        : c.label

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
                    disabled={!!c.arrivesIn}
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
