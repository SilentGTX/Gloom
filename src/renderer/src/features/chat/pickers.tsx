// The model, mode and effort pop-up buttons: in the composer (switched live
// on a running session) and in New Session and Settings. Each shows its
// current choice; its menu lists the others, with what each does.
import type { ReactNode } from 'react'
import { ChevronDown, ClipboardList, Cpu, FilePen, Gauge, Hand, ShieldOff, Sparkles } from 'lucide-react'
import { EFFORT_LABELS, EFFORTS, MODES, modeInfo, modelLabel, type Effort, type ModeId, type ModelChoice } from '@shared/live'
import { MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'

export const MODE_ICONS: Record<ModeId, typeof Hand> = {
  default: Hand,
  acceptEdits: FilePen,
  plan: ClipboardList,
  auto: Sparkles,
  bypassPermissions: ShieldOff
}

type Look = 'chip' | 'field'

/**
 * A pop-up button. `chip`: small and quiet, in the composer's bar; `field`:
 * full width with its label beside it, in a form.
 */
function PopUp({ look, label, value, spoken = value, icon, tooltip, tone, disabled, children }: { look: Look; label: string; value: string; spoken?: string; icon: ReactNode; tooltip?: string; tone?: 'warning'; disabled?: boolean; children: ReactNode }) {
  const trigger = (
    <MenuTrigger
      disabled={disabled}
      aria-label={`${label}: ${spoken}`}
      className={cn(
        'no-drag flex min-w-0 items-center gap-1.5 outline-none select-none',
        'transition-[transform,background-color,color] duration-[var(--duration-press)] ease-out focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] disabled:opacity-35',
        look === 'chip'
          ? 'h-7 rounded-full px-2 text-[12.5px] text-label-secondary enabled:hover:bg-fill-strong enabled:hover:text-label enabled:active:scale-[0.97] data-[popup-open]:bg-fill-strong data-[popup-open]:text-label motion-reduce:enabled:active:scale-100'
          : 'h-8 w-full rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-[13px] text-label shadow-[inset_0_0_0_0.5px_var(--separator-strong)] enabled:hover:bg-fill-strong',
        tone === 'warning' && 'text-[var(--destructive)] enabled:hover:text-[var(--destructive)]'
      )}
    >
      <span className={cn('flex shrink-0 [&>svg]:size-[14px]', look === 'chip' && 'chip-icon')} aria-hidden>
        {icon}
      </span>
      <span className={cn('truncate', look === 'field' && 'flex-1 text-left')}>{value}</span>
      <ChevronDown size={12} strokeWidth={2.25} aria-hidden className="shrink-0 opacity-60" />
    </MenuTrigger>
  )
  return (
    <MenuRoot>
      {tooltip ? <Tooltip label={tooltip}>{trigger}</Tooltip> : trigger}
      <MenuPopup align="start">{children}</MenuPopup>
    </MenuRoot>
  )
}

export function ModePicker({ value, onChange, look = 'chip', disabled }: { value: ModeId; onChange(mode: ModeId): void; look?: Look; disabled?: boolean }) {
  const info = modeInfo(value)
  const Icon = MODE_ICONS[value]
  return (
    <PopUp look={look} label="Mode" value={look === 'chip' ? info.short : info.label} icon={<Icon strokeWidth={1.75} />} tooltip={look === 'chip' ? 'Permission mode' : undefined} tone={value === 'bypassPermissions' ? 'warning' : undefined} disabled={disabled}>
      <MenuRadioGroup value={value} onChange={onChange}>
        {MODES.map((m) => (
          <MenuRadioItem key={m.id} value={m.id} label={m.label} detail={m.detail} destructive={m.id === 'bypassPermissions'} />
        ))}
      </MenuRadioGroup>
    </PopUp>
  )
}

/** `null` is Claude Code's own default model. */
export function ModelPicker({ value, models, onChange, look = 'chip', disabled }: { value: string | null; models: ModelChoice[]; onChange(model: string | null): void; look?: Look; disabled?: boolean }) {
  // "default" in the list is the same as no choice: one Default row.
  const list = models.filter((m) => m.value !== 'default')
  return (
    <PopUp look={look} label="Model" value={modelLabel(value === 'default' ? null : value, models)} icon={<Cpu strokeWidth={1.75} />} tooltip={look === 'chip' ? 'Model' : undefined} disabled={disabled}>
      <MenuRadioGroup value={value && value !== 'default' ? value : ''} onChange={(v) => onChange(v || null)}>
        <MenuRadioItem value="" label="Default" detail={models.find((m) => m.value === 'default')?.description || 'The model Claude Code picks for your plan'} />
        {list.length > 0 && <MenuSeparator />}
        {list.map((m) => (
          <MenuRadioItem key={m.value} value={m.value} label={m.label} detail={m.description || undefined} />
        ))}
      </MenuRadioGroup>
    </PopUp>
  )
}

/** The efforts the model takes; a model without effort levels gets no picker. */
export function effortsFor(model: string | null, models: ModelChoice[]): readonly Effort[] {
  const chosen = models.find((m) => m.value === (model ?? 'default')) ?? models.find((m) => m.value === 'default')
  return chosen ? chosen.efforts : EFFORTS
}

export function EffortPicker({ value, efforts, onChange, look = 'chip', disabled }: { value: Effort | null; efforts: readonly Effort[]; onChange(effort: Effort | null): void; look?: Look; disabled?: boolean }) {
  const name = value ? EFFORT_LABELS[value] : 'Default'
  // The chip says just "Effort" until you pick one; it's still read out as Default.
  return (
    <PopUp look={look} label="Effort" value={look === 'chip' && !value ? 'Effort' : name} spoken={name} icon={<Gauge strokeWidth={1.75} />} tooltip={look === 'chip' ? 'How hard Claude thinks' : undefined} disabled={disabled}>
      <MenuRadioGroup value={value ?? ''} onChange={(v) => onChange(v ? (v as Effort) : null)}>
        {/* Inside the group it names: Base UI throws for a group label outside a group, which blanked the window. */}
        <MenuGroupLabel>Effort</MenuGroupLabel>
        <MenuRadioItem value="" label="Default" detail="What the model uses unless told" />
        {efforts.map((e) => (
          <MenuRadioItem key={e} value={e} label={EFFORT_LABELS[e]} />
        ))}
      </MenuRadioGroup>
    </PopUp>
  )
}
