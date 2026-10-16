import { EventEmitter } from 'node:events'
import net from 'node:net'

export interface MpvMessage {
  event?: string
  name?: string
  data?: unknown
  request_id?: number
  error?: string
  [k: string]: unknown
}

export interface ConnectOptions {
  /** tentativas de conexão enquanto o mpv ainda não criou o pipe (padrão 100) */
  retries?: number
  /** pausa entre tentativas, em ms (padrão 50) */
  delayMs?: number
  /** devolva true para parar de tentar (ex.: o processo do mpv já terminou) */
  shouldAbort?: () => boolean
  /** tempo máximo de espera por uma resposta, em ms (padrão 5000) */
  commandTimeoutMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Cliente do JSON IPC do mpv (um objeto JSON por linha). Eventos: 'property' (name, data),
 * 'event' (mensagem) e 'close'. O cliente nasce parado: registre os handlers e só então chame start(),
 * assim nenhum evento enviado logo na conexão se perde.
 */
export class MpvClient extends EventEmitter {
  private buf = ''
  private nextRequestId = 1
  private nextObserveId = 1
  private started = false
  private closed = false
  private readonly pending = new Map<number, Pending>()

  private constructor(
    private readonly socket: net.Socket,
    private readonly commandTimeoutMs: number
  ) {
    super()
    socket.on('close', () => this.onClose())
    socket.on('error', () => {
      /* o 'close' que vem em seguida trata */
    })
  }

  static async connect(pipePath: string, opts: ConnectOptions = {}): Promise<MpvClient> {
    const retries = opts.retries ?? 100
    const delay = opts.delayMs ?? 50
    let lastErr: unknown
    for (let i = 0; i < retries; i++) {
      if (opts.shouldAbort?.()) break
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.createConnection(pipePath)
          s.once('connect', () => {
            s.removeListener('error', reject)
            resolve(s)
          })
          s.once('error', reject)
        })
        return new MpvClient(socket, opts.commandTimeoutMs ?? 5000)
      } catch (e) {
        lastErr = e
        await sleep(delay)
      }
    }
    throw new Error('não foi possível conectar ao mpv' + (lastErr instanceof Error ? `: ${lastErr.message}` : ''))
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => this.onData(chunk))
  }

  command(...args: unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('mpv desconectado'))
    const id = this.nextRequestId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('mpv não respondeu'))
      }, this.commandTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.write(JSON.stringify({ command: args, request_id: id }) + '\n')
    })
  }

  async observe(name: string): Promise<void> {
    await this.command('observe_property', this.nextObserveId++, name)
  }

  getProperty(name: string): Promise<unknown> {
    return this.command('get_property', name)
  }

  setProperty(name: string, value: unknown): Promise<unknown> {
    return this.command('set_property', name, value)
  }

  close(): void {
    this.socket.destroy()
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let msg: MpvMessage
      try {
        msg = JSON.parse(line) as MpvMessage
      } catch {
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: MpvMessage): void {
    if (typeof msg.request_id === 'number') {
      const p = this.pending.get(msg.request_id)
      if (!p) return
      this.pending.delete(msg.request_id)
      clearTimeout(p.timer)
      if (msg.error === 'success') p.resolve(msg.data)
      else p.reject(new Error(String(msg.error)))
      return
    }
    if (msg.event === 'property-change' && typeof msg.name === 'string') this.emit('property', msg.name, msg.data)
    if (typeof msg.event === 'string') this.emit('event', msg)
  }

  private onClose(): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('mpv desconectado'))
    }
    this.pending.clear()
    this.emit('close')
  }
}
