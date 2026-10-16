import { EventEmitter } from 'node:events'

/** Faz o papel do processo do mpv: kill() encerra, exitNow() simula o usuário fechando o player. */
export class FakeChild extends EventEmitter {
  killed = false
  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('exit', null))
    return true
  }
  exitNow(code = 0): void {
    this.emit('exit', code)
  }
}
