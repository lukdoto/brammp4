import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let counter = 0
export function uniquePipePath(): string {
  const name = `brammp4-test-${process.pid}-${Date.now()}-${counter++}`
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`)
}

/** Servidor que fala o JSON IPC do mpv o suficiente para os testes. */
export class FakeMpv {
  readonly path: string
  readonly props = new Map<string, unknown>()
  readonly commands: unknown[][] = []
  /** comandos a que o servidor não responde (para testar o tempo limite) */
  readonly silentCommands = new Set<string>()
  private readonly server: net.Server
  private readonly sockets = new Set<net.Socket>()
  private readonly observed = new Set<string>()
  readonly ready: Promise<void>

  constructor(path: string = uniquePipePath()) {
    this.path = path
    this.server = net.createServer((s) => this.onConnection(s))
    this.ready = new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(path, () => resolve())
    })
  }

  static async start(path?: string): Promise<FakeMpv> {
    const m = new FakeMpv(path)
    await m.ready
    return m
  }

  private onConnection(s: net.Socket): void {
    this.sockets.add(s)
    s.setEncoding('utf8')
    let buf = ''
    s.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.trim()) this.handle(s, JSON.parse(line) as { command: unknown[]; request_id: number })
      }
    })
    s.on('close', () => this.sockets.delete(s))
    s.on('error', () => {})
  }

  private handle(s: net.Socket, msg: { command: unknown[]; request_id: number }): void {
    const [name, ...rest] = msg.command as [string, ...unknown[]]
    this.commands.push(msg.command)
    if (this.silentCommands.has(name)) return
    const reply = (error: string, data?: unknown) => s.write(JSON.stringify({ error, data, request_id: msg.request_id }) + '\n')
    switch (name) {
      case 'observe_property': {
        const prop = String(rest[1])
        this.observed.add(prop)
        reply('success')
        if (this.props.has(prop)) this.broadcast({ event: 'property-change', id: rest[0], name: prop, data: this.props.get(prop) })
        return
      }
      case 'get_property': {
        const p = String(rest[0])
        if (this.props.has(p)) reply('success', this.props.get(p))
        else reply('property unavailable')
        return
      }
      case 'set_property':
        this.setProp(String(rest[0]), rest[1])
        reply('success')
        return
      case 'quit':
        reply('success')
        this.emitEvent({ event: 'end-file', reason: 'quit' })
        return
      default:
        reply('success')
    }
  }

  private broadcast(obj: unknown): void {
    const line = JSON.stringify(obj) + '\n'
    for (const s of this.sockets) s.write(line)
  }

  emitEvent(ev: Record<string, unknown>): void {
    this.broadcast(ev)
  }

  /** Muda uma propriedade; se alguém a observa, manda o property-change. */
  setProp(name: string, value: unknown): void {
    this.props.set(name, value)
    if (this.observed.has(name)) this.broadcast({ event: 'property-change', id: 1, name, data: value })
  }

  /** conexões que o servidor já registrou (o connect do cliente resolve antes disso) */
  get clientCount(): number {
    return this.sockets.size
  }

  dropClients(): void {
    for (const s of this.sockets) s.destroy()
  }

  async close(): Promise<void> {
    this.dropClients()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}
