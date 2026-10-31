import { Fragment } from 'react'
import { Menu as MenuIcon } from 'lucide-react'
import { COMMANDS, formatAccelerator, GROUP_LABELS, menuEntries, type CommandGroup, type CommandId, type CommandSpec } from '@shared/commands'
import { Button } from '../../components/ui/Button'
import {
  MenuCheckItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuSubmenu,
  MenuTrigger
} from '../../components/ui/Menu'
import { runCommand } from '../../lib/commands'
import { DIFF_TABS, SORTS, useCommandState } from '../../lib/command-state'
import { useUi } from '../../stores/ui'

const ORDER: CommandGroup[] = ['file', 'edit', 'view', 'help', 'developer']

/** Every command, since Windows draws no menu bar here. Toggles say what they will do. */
export function AppMenu({ shape = 'rounded' }: { shape?: 'rounded' | 'round' }) {
  const ui = useUi()
  const stateOf = useCommandState()
  // A submenu is one choice of several: how sessions sort, what the diff shows.
  const radio = (commands: CommandSpec[]) => {
    const choices: Record<string, string> = commands.some((c) => c.id in DIFF_TABS) ? DIFF_TABS : SORTS
    const value = choices === DIFF_TABS ? ui.diffTab : ui.sort
    return (
      <MenuRadioGroup value={value} onChange={(v) => runCommand(commands.find((c) => choices[c.id] === v)!.id as CommandId)}>
        {commands.map((c) => (
          <MenuRadioItem key={c.id} value={choices[c.id]} label={c.label} />
        ))}
      </MenuRadioGroup>
    )
  }
  const item = (c: CommandSpec) => {
    const state = stateOf(c)
    return c.id === 'view.toggleGlass' ? (
      <MenuCheckItem key={c.id} label={c.label} checked={state.checked} onClick={() => runCommand(c.id as CommandId)} />
    ) : (
      <MenuItem
        key={c.id}
        label={state.label}
        shortcut={c.accelerator ? formatAccelerator(c.accelerator) : undefined}
        disabled={state.disabled}
        note={c.arrivesIn}
        onClick={() => runCommand(c.id as CommandId)}
      />
    )
  }

  const groups = ORDER.map((group) => ({ group, entries: menuEntries((COMMANDS as readonly CommandSpec[]).filter((c) => c.group === group)) }))
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
        {groups.map(({ group, entries }, i) => (
          <Fragment key={group}>
            {i > 0 && <MenuSeparator />}
            <MenuGroup>
              <MenuGroupLabel>{GROUP_LABELS[group]}</MenuGroupLabel>
              {entries.map((e) =>
                e.kind === 'command' ? (
                  item(e.command)
                ) : (
                  <MenuSubmenu key={e.label} label={e.label}>
                    {radio(e.commands)}
                  </MenuSubmenu>
                )
              )}
            </MenuGroup>
          </Fragment>
        ))}
      </MenuPopup>
    </MenuRoot>
  )
}
