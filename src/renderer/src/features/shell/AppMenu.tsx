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
import { useLibrary } from '../../stores/library'
import { useTranscript } from '../../stores/transcript'
import { useUi, type SortOrder } from '../../stores/ui'
import { computeLayout } from './layout'

const ORDER: CommandGroup[] = ['file', 'edit', 'view', 'help', 'developer']
/** Commands that act on the open session's transcript. */
const NEEDS_TRANSCRIPT = new Set<string>(['session.resume', 'edit.find', 'edit.findNext', 'edit.findPrevious'])
/** The Sort Sessions By choices, by command. */
const SORTS: Record<string, SortOrder> = { 'view.sortActivity': 'activity', 'view.sortName': 'name', 'view.sortCreated': 'created' }

/** Every command, since Windows draws no menu bar here. Toggles say what they will do. */
export function AppMenu({ shape = 'rounded' }: { shape?: 'rounded' | 'round' }) {
  const ui = useUi()
  const lastUndo = useLibrary((s) => s.undoStack.at(-1))
  const reading = useTranscript((s) => s.status === 'ready')
  const sidebarShown = computeLayout(window.innerWidth, ui).sidebarInline || ui.sheet
  // Toggles say what they will do; Undo says what it undoes ("Undo Archive").
  const labelOf = (c: CommandSpec) => {
    if (c.id === 'edit.undo') return lastUndo ? `Undo ${lastUndo.label}` : 'Undo'
    if (c.id === 'view.toggleSidebar') return sidebarShown ? 'Hide Sidebar' : 'Show Sidebar'
    return c.label
  }
  const item = (c: CommandSpec) =>
    c.id === 'view.toggleGlass' ? (
      <MenuCheckItem key={c.id} label={c.label} checked={ui.glassAlways} onClick={() => runCommand(c.id as CommandId)} />
    ) : (
      <MenuItem
        key={c.id}
        label={labelOf(c)}
        shortcut={c.accelerator ? formatAccelerator(c.accelerator) : undefined}
        disabled={
          !!c.arrivesIn || (c.id === 'edit.undo' && !lastUndo) || (NEEDS_TRANSCRIPT.has(c.id) && !reading) || (c.id === 'session.info' && ui.selection.length !== 1)
        }
        note={c.arrivesIn}
        onClick={() => runCommand(c.id as CommandId)}
      />
    )

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
                    <MenuRadioGroup value={ui.sort} onChange={(sort) => runCommand(e.commands.find((c) => SORTS[c.id] === sort)!.id as CommandId)}>
                      {e.commands.map((c) => (
                        <MenuRadioItem key={c.id} value={SORTS[c.id]} label={c.label} />
                      ))}
                    </MenuRadioGroup>
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
