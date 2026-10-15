import type { LibraryStatus } from '../../shared/types'
import type { Resolved } from './resolve'

interface MonitorOpts {
  intervalMs: number
  list: () => { id: string; rootPath: string; status: LibraryStatus }[]
  resolve: (lib: { id: string; rootPath: string }) => Promise<Resolved>
  onChange: (id: string, r: Resolved) => void
}

export class LibraryMonitor {
  private timer: NodeJS.Timeout | undefined
  private running = false
  private stopped = false

  constructor(private readonly opts: MonitorOpts) {}

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const lib of this.opts.list()) {
        if (this.stopped) break
        try {
          const r = await this.opts.resolve(lib)
          if (this.stopped) break
          const changed = r.status !== lib.status || (r.status === 'online' && r.rootPath !== lib.rootPath)
          if (changed) this.opts.onChange(lib.id, r)
        } catch (err) {
          console.error(`LibraryMonitor: falha ao verificar a biblioteca ${lib.id}`, err)
        }
      }
    } finally {
      this.running = false
    }
  }

  start(): void {
    if (this.timer) return
    this.stopped = false
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
