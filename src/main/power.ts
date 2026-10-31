// Keeps the computer from idle-sleeping while Claude works, as the Claude app
// does (Settings › Sessions): held while any session is mid-turn or waiting,
// let go shortly after the work ends. On battery only when you allow it. It
// stops idle sleep only; closing the lid still sleeps.
import { powerMonitor, powerSaveBlocker } from 'electron'
import { settings } from './claude/settings'

/** How long after the last turn ends the hold stays, so back-to-back turns don't flap it. */
const LINGER_MS = 30_000

export class KeepAwake {
  private blocker: number | null = null
  private working = false
  private release: ReturnType<typeof setTimeout> | null = null

  constructor() {
    powerMonitor.on('on-battery', () => this.apply())
    powerMonitor.on('on-ac', () => this.apply())
  }

  /** Whether any session works now; call it as their states change, and when the settings do. */
  update(working: boolean): void {
    if (working === this.working) return this.apply()
    this.working = working
    if (working) {
      if (this.release) clearTimeout(this.release)
      this.release = null
      this.apply()
    } else {
      this.release ??= setTimeout(() => {
        this.release = null
        this.apply()
      }, LINGER_MS)
    }
  }

  /** Whether the hold is on now (for tests and the inspector). */
  get holding(): boolean {
    return this.blocker !== null && powerSaveBlocker.isStarted(this.blocker)
  }

  private apply(): void {
    const s = settings()
    const want = s.keepAwake && (this.working || this.release !== null) && (s.keepAwakeOnBattery || !powerMonitor.isOnBatteryPower())
    if (want && !this.holding) this.blocker = powerSaveBlocker.start('prevent-app-suspension')
    else if (!want && this.blocker !== null) {
      if (powerSaveBlocker.isStarted(this.blocker)) powerSaveBlocker.stop(this.blocker)
      this.blocker = null
    }
  }

  stop(): void {
    if (this.release) clearTimeout(this.release)
    this.release = null
    this.working = false
    this.apply()
  }
}
