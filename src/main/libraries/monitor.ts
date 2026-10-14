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

  constructor(private readonly opts: MonitorOpts) {}

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const lib of this.opts.list()) {
        try {
          const r = await this.opts.resolve(lib)
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
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
