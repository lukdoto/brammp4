import { isWatched } from '../../shared/rules'

export interface SavedProgress {
  positionS: number
  durationS?: number
  watched: boolean
}

export interface TrackerOptions {
  save: (p: SavedProgress) => void
  now: () => number
  /** intervalo mínimo entre gravações periódicas (padrão 5000 ms) */
  intervalMs?: number
}

const same = (a: SavedProgress, b: SavedProgress) => a.positionS === b.positionS && a.durationS === b.durationS && a.watched === b.watched

/**
 * Decide quando gravar o progresso. Nada é gravado antes de arm() (o `playback-restart` do mpv):
 * enquanto o mpv carrega, `time-pos` pode valer ~0 e apagar o ponto que o usuário tinha salvo.
 */
export class ProgressTracker {
  private armed = false
  private position: number | undefined
  private duration: number | undefined
  private lastSaveAt = Number.NEGATIVE_INFINITY
  private lastSaved: SavedProgress | undefined
  private readonly intervalMs: number

  constructor(private readonly opts: TrackerOptions) {
    this.intervalMs = opts.intervalMs ?? 5000
  }

  arm(): void {
    this.armed = true
  }

  get isArmed(): boolean {
    return this.armed
  }

  get positionS(): number | undefined {
    return this.position
  }

  onTimePos(v: unknown): void {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return
    this.position = v
    if (this.armed && this.opts.now() - this.lastSaveAt >= this.intervalMs) this.saveNow()
  }

  onDuration(v: unknown): void {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) this.duration = v
  }

  onPause(v: unknown): void {
    if (v === true) this.saveNow()
  }

  /** `eof` leva a posição até o fim (assistido); qualquer outro motivo só grava onde estava. */
  onEnd(reason: unknown): void {
    if (reason === 'eof' && this.armed && this.duration !== undefined) this.position = this.duration
    this.saveNow()
  }

  flush(): void {
    this.saveNow()
  }

  private saveNow(): void {
    if (!this.armed || this.position === undefined) return
    const next: SavedProgress = {
      positionS: this.position,
      ...(this.duration !== undefined ? { durationS: this.duration } : {}),
      watched: isWatched(this.position, this.duration)
    }
    this.lastSaveAt = this.opts.now()
    if (this.lastSaved && same(this.lastSaved, next)) return
    this.lastSaved = next
    this.opts.save(next)
  }
}
