// Settings › Pets, as Codex's Mini & Pets page: the pet you chose on a stage
// (Customize sets its size), whether it shows, and your pets: Gloom's eight and
// the ones you create. Create Pet asks for a name and an idea, and starts a
// Claude Code session that draws it with pxl on Gloom's pet kit; the new pet
// shows here, and on your desktop, once it's built.
import { useState, type FormEvent } from 'react'
import { FolderOpen, Plus, Trash2, X } from 'lucide-react'
import type { CustomPet } from '@shared/ipc'
import { PET_KINDS, PET_SIZE, type BuiltInPet, type PetKind } from '@shared/live'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { useLive } from '../../stores/live'
import { useCustomPetList } from '../pet/custom'
import { PixelPet } from '../pet/Pet'

export const PET_LABELS: Record<BuiltInPet, { label: string; detail: string }> = {
  blob: { label: 'Blob', detail: 'A blue cloud with a prompt for a face' },
  sprout: { label: 'Sprout', detail: 'A seedling with two leaves' },
  ghost: { label: 'Ghost', detail: 'A soft violet ghost' },
  ember: { label: 'Ember', detail: 'A fire spirit' },
  cat: { label: 'Cat', detail: 'A cat with yellow eyes' },
  frog: { label: 'Frog', detail: 'A frog with a wide smile' },
  bot: { label: 'Bot', detail: 'A little screen-faced robot' },
  owl: { label: 'Owl', detail: 'A wide-eyed owl' }
}

const update = (patch: Parameters<ReturnType<typeof useLive.getState>['updateSettings']>[0]) => void useLive.getState().updateSettings(patch)

export function PetsPane() {
  const settings = useLive((s) => s.settings)
  const custom = useCustomPetList()
  const [customizing, setCustomizing] = useState(false)
  const [creating, setCreating] = useState(false)
  const chosen = settings.petKind.startsWith('custom:') ? custom.find((p) => `custom:${p.id}` === settings.petKind) : undefined
  const name = chosen?.name ?? (PET_LABELS[settings.petKind as BuiltInPet]?.label || 'Blob')
  const choose = (petKind: PetKind) => update({ petKind, pet: true })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="pt-1 text-[12.5px] leading-snug text-label-secondary">
          A companion that floats on top of all your apps. Drag it anywhere; click it to hide Gloom or bring it back; right-click it for its menu. /pet shows or hides it.
        </p>
        <Button size="text" tone="secondary" onClick={() => update({ pet: !settings.pet })}>
          {settings.pet ? 'Hide Pet' : 'Show Pet'}
        </Button>
      </div>

      {/* The stage: the pet you chose, at its size. */}
      <div className="relative flex h-[190px] items-center justify-center overflow-hidden rounded-[14px] bg-fill-strong shadow-[inset_0_0_0_0.5px_var(--separator-strong)]">
        <Preview kind={settings.petKind} custom={chosen} scale={Math.min(settings.petSize, 5)} label={name} />
        <div className="absolute right-3 bottom-3">
          <Button size="text" tone="secondary" onClick={() => setCustomizing((v) => !v)} aria-expanded={customizing}>
            Customize
          </Button>
        </div>
      </div>
      {customizing && <Customize size={settings.petSize} onClose={() => setCustomizing(false)} />}

      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-label">My Pets</h3>
        <div className="flex items-center gap-1.5">
          <Button size="text" tone="secondary" onClick={() => void window.gloom?.pets.reveal()} aria-label="Show the pets folder">
            <FolderOpen size={13} strokeWidth={2} aria-hidden />
          </Button>
          <Button size="text" tone="secondary" onClick={() => setCreating(true)}>
            <Plus size={13} strokeWidth={2.25} aria-hidden /> Create Pet
          </Button>
        </div>
      </div>
      {creating && <CreatePet onClose={() => setCreating(false)} />}
      <div className="grid grid-cols-3 gap-2.5">
        {PET_KINDS.map((kind) => (
          <PetCard key={kind} kind={kind} label={PET_LABELS[kind].label} detail={PET_LABELS[kind].detail} chosen={settings.petKind === kind} onChoose={() => choose(kind)} />
        ))}
        {custom.map((pet) => (
          <PetCard
            key={pet.id}
            kind={`custom:${pet.id}`}
            custom={pet}
            label={pet.name}
            detail={pet.description || 'Yours'}
            chosen={settings.petKind === `custom:${pet.id}`}
            onChoose={() => choose(`custom:${pet.id}`)}
            onRemove={() => void window.gloom?.pets.remove(pet.id)}
          />
        ))}
      </div>
    </div>
  )
}

/** A pet that's happy while the pointer is on it, as on the desktop. */
function Preview({ kind, custom, scale, label }: { kind: PetKind; custom?: CustomPet; scale: number; label?: string }) {
  const [hover, setHover] = useState(false)
  return (
    <div {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <PixelPet kind={kind} custom={custom} mood="rest" loop={hover ? 'happy' : 'idle'} scale={scale} />
    </div>
  )
}

function PetCard({
  kind,
  custom,
  label,
  detail,
  chosen,
  onChoose,
  onRemove
}: {
  kind: PetKind
  custom?: CustomPet
  label: string
  detail: string
  chosen: boolean
  onChoose(): void
  onRemove?(): void
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={chosen}
        className={cn(
          'flex h-full w-full flex-col items-center gap-1 rounded-[12px] px-2 pt-3 pb-2.5 text-center shadow-[inset_0_0_0_0.5px_var(--separator-strong)] outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]',
          chosen && 'bg-[var(--accent-fill)] shadow-[inset_0_0_0_1.5px_var(--accent-ring)] hover:bg-[var(--accent-fill)]'
        )}
      >
        <div className="flex h-[84px] items-end">
          <Preview kind={kind} custom={custom} scale={3} />
        </div>
        <span className="text-[12.5px] font-semibold text-label">{label}</span>
        <span className="line-clamp-2 text-[11px] leading-snug text-label-secondary">{detail}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={() => (confirm ? onRemove() : setConfirm(true))}
          onBlur={() => setConfirm(false)}
          aria-label={confirm ? `Delete ${label} for good` : `Delete ${label}`}
          className={cn(
            'absolute top-1.5 right-1.5 flex h-6 items-center gap-1 rounded-full px-1.5 text-[11px] text-label-secondary opacity-0 outline-none group-hover:opacity-100 hover:bg-fill-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]',
            confirm && 'bg-[var(--removed-text)] text-white opacity-100 hover:bg-[var(--removed-text)]'
          )}
        >
          <Trash2 size={12} strokeWidth={2} aria-hidden />
          {confirm && 'Delete'}
        </button>
      )}
    </div>
  )
}

/** Customize, under the stage so the pet shows as it changes: its size, in whole pixels so it stays crisp. */
function Customize({ size, onClose }: { size: number; onClose(): void }) {
  return (
    <div role="group" aria-label="Customize pet" className="-mt-2 rounded-[12px] p-3 shadow-[inset_0_0_0_0.5px_var(--separator-strong)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-label">Customize Pet</span>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-6 place-items-center rounded-full text-label-secondary hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]">
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <label className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-[12px] text-label-secondary">Pet size</span>
        <input
          type="range"
          min={PET_SIZE.min}
          max={PET_SIZE.max}
          step={1}
          value={size}
          onChange={(e) => update({ petSize: Number(e.target.value) })}
          aria-valuetext={`${size} times`}
          className="min-w-0 flex-1 accent-[var(--accent)]"
        />
        <Button size="text" tone="secondary" disabled={size === PET_SIZE.initial} onClick={() => update({ petSize: PET_SIZE.initial })}>
          Reset
        </Button>
      </label>
    </div>
  )
}

/** Create Pet: a name and an idea; Claude draws the rest. */
function CreatePet({ onClose }: { onClose(): void }) {
  const [name, setName] = useState('')
  const [idea, setIdea] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Give your pet a name.')
    setWorking(true)
    try {
      await window.gloom?.pets.create(name.trim(), idea.trim())
      useLive.getState().setSettingsOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
      setWorking(false)
    }
  }
  const field =
    'w-full rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-[13px] text-label shadow-[inset_0_0_0_0.5px_var(--separator-strong)] outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]'
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-[12px] p-3 shadow-[inset_0_0_0_0.5px_var(--separator-strong)]">
      <p className="text-[12px] leading-snug text-label-secondary">
        Claude draws your pet in a new session, as pixel art with pxl, and it shows here when it’s done. Say what it looks like and what it’s like.
      </p>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Pet name" maxLength={40} className={cn(field, 'h-8')} />
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="A curious fox with copper fur and navy ear tips…"
        aria-label="What it looks like"
        rows={3}
        maxLength={2000}
        className={cn(field, 'resize-none py-1.5')}
      />
      {error && (
        <p role="alert" className="text-[11.5px] text-[var(--removed-text)]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="text" tone="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button size="text" tone="primary" type="submit" disabled={working}>
          {working ? 'Starting…' : 'Create Pet'}
        </Button>
      </div>
    </form>
  )
}
