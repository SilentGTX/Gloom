import { Fragment } from 'react'
import { Menu as MenuIcon } from 'lucide-react'
import { COMMANDS, formatAccelerator, GROUP_LABELS, type CommandGroup, type CommandId, type CommandSpec } from '@shared/commands'
import { Button } from '../../components/ui/Button'
import { MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { runCommand } from '../../lib/commands'

const ORDER: CommandGroup[] = ['file', 'view', 'help', 'developer']

/** The title bar's menu button: every command, since Windows draws no menu bar here. */
export function AppMenu() {
  const groups = ORDER.map((group) => ({ group, commands: (COMMANDS as readonly CommandSpec[]).filter((c) => c.group === group) }))
  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button aria-label="Menu">
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
              {commands.map((c) => (
                <MenuItem
                  key={c.id}
                  label={c.label}
                  shortcut={c.accelerator ? formatAccelerator(c.accelerator) : undefined}
                  disabled={!!c.arrivesIn}
                  note={c.arrivesIn}
                  onClick={() => runCommand(c.id as CommandId)}
                />
              ))}
            </MenuGroup>
          </Fragment>
        ))}
      </MenuPopup>
    </MenuRoot>
  )
}
