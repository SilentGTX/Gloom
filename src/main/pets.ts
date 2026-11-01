// Pets you create. They live in Gloom's pets folder (userData/pets), one folder
// each: pet.px.js (drawn with pxl on Gloom's pet kit), pet.json (its name,
// description and loop timings) and a PNG strip per loop. The folder's _kit holds
// the kit, Gloom's own pets as examples and the script that builds a pet.
//
// Create Pet starts a Claude Code session in the pets folder that draws one; Gloom
// watches the folder and offers each pet as soon as its loops are built, choosing
// the one it was asked for.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PET_LOOPS, type CustomPet, type PetLoopData, type PetLoopKey } from '@shared/ipc'
import { PET_ID } from '@shared/live'
import { PET_EXAMPLES, PET_KIT } from './pet-kit'

/** Builds a pet: runs pxl on <id>/pet.px.js, copies its loops beside it, and fills in pet.json's loops. */
const BUILD_SCRIPT = `// Builds a Gloom pet: node _kit/build-pet.mjs <id>
// Draws <id>/pet.px.js with pxl (github.com/crsolver/claude-pxl), copies each loop's
// strip to <id>/<loop>.png and writes the loops' sizes and timings into <id>/pet.json.
// Previews to look at: <id>/out/_preview/<id>_sheet.png (every frame of every loop).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOOPS = ${JSON.stringify(PET_LOOPS)}
const id = process.argv[2]
if (!id || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error('Usage: node _kit/build-pet.mjs <id> (lowercase letters, digits, dashes)')
const pets = join(import.meta.dirname, '..')
const dir = join(pets, id)
const pxl = process.env.PXL ?? join(homedir(), '.claude/skills/pxl-pixel-art/bin/pxl.js')
if (!existsSync(pxl)) throw new Error('pxl is missing: git clone https://github.com/crsolver/claude-pxl.git ' + join(homedir(), '.claude/skills/pxl-pixel-art'))
const [major, minor] = process.versions.node.split('.').map(Number)
const only = [...LOOPS.map((l) => id + '_' + l), id + '_sheet'].join(',')
const args = [pxl, 'build', join(dir, 'pet.px.js'), '--only', only]
// pxl needs Node 22.18 or later; on an older one it runs under Node 24 through npx.
if (major > 22 || (major === 22 && minor >= 18)) execFileSync(process.execPath, args, { stdio: 'inherit' })
else execFileSync('npx', ['-y', 'node@24', ...args], { stdio: 'inherit', shell: process.platform === 'win32' })

const file = join(dir, 'pet.json')
const pet = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
pet.loops = {}
for (const loop of LOOPS) {
  const name = id + '_' + loop
  copyFileSync(join(dir, 'out/anims', name + '.png'), join(dir, loop + '.png'))
  const frames = Object.values(JSON.parse(readFileSync(join(dir, 'out/anims', name + '.json'), 'utf8')).frames)
  pet.loops[loop] = { w: frames[0].frame.w, h: frames[0].frame.h, durations: frames.map((f) => f.duration), ...(loop === 'jump' ? { once: true } : {}) }
}
writeFileSync(file, JSON.stringify(pet, null, 2))
console.log('Built ' + id + ': Gloom shows it in Settings > Pets. Preview: ' + join(dir, 'out/_preview', id + '_sheet.png'))
`

const README = `Gloom's pets folder. Each pet you create has a folder here:
  pet.px.js   the pet, drawn with pxl on _kit/pet-kit.px.js
  pet.json    its name and description (and its loops, written by the build)
  <loop>.png  its six loops: idle, busy, walk, fall, happy, jump

Build one: node _kit/build-pet.mjs <folder>. Gloom picks it up by itself.
A tall pet can say where its status dot goes: "badge": { "x": 36, "y": 8 } in pet.json (its own pixels).
_kit/examples.px.js is Gloom's own pets, to learn from. Delete a folder to delete its pet.
`

const MAX_PNG = 1024 * 1024
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

function readLoop(dir: string, loop: PetLoopKey, raw: unknown): PetLoopData | null {
  if (!raw || typeof raw !== 'object') return null
  const { w, h, durations, once, loopFrom } = raw as Record<string, unknown>
  // Up to 128 × 128: a sheet you slice into a pet can have big frames.
  if (!isInt(w, 4, 128) || !isInt(h, 4, 128) || !Array.isArray(durations) || !durations.length || durations.length > 64) return null
  if (!durations.every((d) => isInt(d, 16, 10_000))) return null
  const png = join(dir, `${loop}.png`)
  if (!existsSync(png) || statSync(png).size > MAX_PNG) return null
  const src = `data:image/png;base64,${readFileSync(png).toString('base64')}`
  const from = isInt(loopFrom, 1, durations.length - 1) ? { loopFrom } : {}
  return { src, w, h, durations: durations as number[], ...(once === true ? { once: true } : {}), ...from }
}

/** A pet's folder, read: null until it's built (every loop there and sound). */
function readPet(root: string, id: string): CustomPet | null {
  try {
    const dir = join(root, id)
    const raw = JSON.parse(readFileSync(join(dir, 'pet.json'), 'utf8')) as Record<string, unknown>
    const loops = {} as Record<PetLoopKey, PetLoopData>
    for (const loop of PET_LOOPS) {
      const data = readLoop(dir, loop, (raw.loops as Record<string, unknown> | undefined)?.[loop])
      if (!data) return null
      loops[loop] = data
    }
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : id
    const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 160) : ''
    const b = raw.badge as Record<string, unknown> | undefined
    const badge = b && isInt(b.x, 0, 127) && isInt(b.y, 0, 127) ? { x: b.x, y: b.y } : undefined
    return { id, name, description, loops, ...(badge ? { badge } : {}) }
  } catch {
    return null
  }
}

/** A folder name for a pet called this, not yet taken. */
export function petIdFor(name: string, taken: (id: string) => boolean): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'pet'
  let id = base
  for (let n = 2; taken(id); n++) id = `${base}-${n}`
  return id
}

export class Pets {
  readonly dir: string
  private list: CustomPet[] = []
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Pets Create Pet asked for, chosen as soon as they're built. */
  private wanted = new Set<string>()

  constructor(
    userData: string,
    private readonly changed: (pets: CustomPet[]) => void,
    private readonly built: (id: string) => void
  ) {
    this.dir = join(userData, 'pets')
  }

  /** The folder, its kit (always the one this Gloom ships), and the pets in it. */
  start(): void {
    const kit = join(this.dir, '_kit')
    mkdirSync(kit, { recursive: true })
    writeFileSync(join(kit, 'pet-kit.px.js'), PET_KIT)
    writeFileSync(join(kit, 'examples.px.js'), PET_EXAMPLES)
    writeFileSync(join(kit, 'build-pet.mjs'), BUILD_SCRIPT)
    writeFileSync(join(this.dir, 'README.txt'), README)
    this.list = this.read()
    try {
      this.watcher = watch(this.dir, { recursive: true }, (_event, file) => {
        if (file && /(^|[\\/])(out|_kit)([\\/]|$)/.test(String(file))) return
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.refresh(), 400)
      })
    } catch (error) {
      console.warn('Gloom: can’t watch the pets folder:', error)
    }
  }

  stop(): void {
    this.watcher?.close()
    clearTimeout(this.timer)
  }

  all(): CustomPet[] {
    return this.list
  }

  get(id: string): CustomPet | null {
    return this.list.find((p) => p.id === id) ?? null
  }

  private read(): CustomPet[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && PET_ID.test(d.name))
      .map((d) => readPet(this.dir, d.name))
      .filter((p): p is CustomPet => p !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  refresh(): void {
    const next = this.read()
    const before = JSON.stringify(this.list)
    this.list = next
    if (JSON.stringify(next) !== before) this.changed(next)
    for (const pet of next) {
      if (!this.wanted.delete(pet.id)) continue
      this.built(pet.id)
    }
  }

  /** A folder for a new pet, with its name and the idea for it; the session drawing it starts there. */
  prepare(name: string, idea: string): string {
    const id = petIdFor(name, (candidate) => existsSync(join(this.dir, candidate)))
    mkdirSync(join(this.dir, id), { recursive: true })
    writeFileSync(join(this.dir, id, 'pet.json'), JSON.stringify({ name: name.trim().slice(0, 40), description: idea.trim().slice(0, 160) }, null, 2))
    this.wanted.add(id)
    return id
  }

  remove(id: string): void {
    if (!PET_ID.test(id)) return
    rmSync(join(this.dir, id), { recursive: true, force: true })
    this.refresh()
  }

  /** What the session drawing a new pet is asked. */
  prompt(id: string, name: string, idea: string): string {
    const pxl = join(homedir(), '.claude/skills/pxl-pixel-art')
    return [
      `Create a pet for Gloom called "${name}"${idea.trim() ? `: ${idea.trim()}` : '.'}`,
      '',
      `Gloom's pets are small pixel characters drawn as code with pxl, the pixel-art DSL (its skill is pxl-pixel-art, in ${pxl}; if it isn't there, run \`git clone https://github.com/crsolver/claude-pxl.git "${pxl}"\` and read its SKILL.md).`,
      '',
      `1. Read _kit/pet-kit.px.js (how a pet is built: one draw function that takes a pose, and definePet, which makes its six loops) and _kit/examples.px.js (Gloom's eight pets on the same kit).`,
      `2. Write ${id}/pet.px.js: include("../_kit/pet-kit.px.js"), the pet's own palette (keep off the kit's keys k, w, p, D, d, Q, z), a 16 px wide mirrored sprite at rest, and definePet("${id}", { ... }). Give its idle loop a little life of its own, as the examples do.`,
      `3. Build it: node _kit/build-pet.mjs ${id}`,
      `4. Look at ${id}/out/_preview/${id}_sheet.png (every frame of every loop) and fix what reads badly: the face must stay clear in every loop, including over the laptop at the desk (busy). Rebuild and look again until it's good.`,
      '',
      `Keep its name and description in ${id}/pet.json (they're there already). Gloom shows the pet as soon as it's built, and switches to it.`
    ].join('\n')
  }
}
