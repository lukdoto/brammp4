import { describe, it, expect, vi } from 'vitest'
import { LibraryMonitor } from '../../src/main/libraries/monitor'
import type { Resolved } from '../../src/main/libraries/resolve'
import type { LibraryStatus } from '../../src/shared/types'

describe('LibraryMonitor.tick', () => {
  it('avisa só quando status ou endereço mudam', async () => {
    const libs = [
      { id: 'a', rootPath: 'E:\\S', status: 'offline' as LibraryStatus },
      { id: 'b', rootPath: 'F:\\F', status: 'online' as LibraryStatus },
      { id: 'c', rootPath: 'G:\\X', status: 'online' as LibraryStatus }
    ]
    const results: Record<string, Resolved> = {
      a: { status: 'online', rootPath: 'E:\\S' },
      b: { status: 'online', rootPath: 'F:\\F' },
      c: { status: 'online', rootPath: 'H:\\X' }
    }
    const changes: [string, Resolved][] = []
    const m = new LibraryMonitor({ intervalMs: 3000, list: () => libs, resolve: async (l) => results[l.id]!, onChange: (id, r) => changes.push([id, r]) })
    await m.tick()
    expect(changes).toEqual([['a', results.a], ['c', results.c]])
  })

  it('uma biblioteca que falha não interrompe as demais', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const libs = [
      { id: 'a', rootPath: 'E:\\S', status: 'online' as LibraryStatus },
      { id: 'b', rootPath: 'F:\\F', status: 'offline' as LibraryStatus }
    ]
    const changes: [string, Resolved][] = []
    const m = new LibraryMonitor({
      intervalMs: 3000,
      list: () => libs,
      resolve: async (l) => {
        if (l.id === 'a') throw new Error('boom')
        return { status: 'online', rootPath: 'F:\\F' }
      },
      onChange: (id, r) => changes.push([id, r])
    })
    await m.tick()
    expect(changes).toEqual([['b', { status: 'online', rootPath: 'F:\\F' }]])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('não chama onChange depois de stop() durante uma verificação pendente', async () => {
    let release!: (r: Resolved) => void
    const pending = new Promise<Resolved>((res) => { release = res })
    const changes: [string, Resolved][] = []
    const m = new LibraryMonitor({
      intervalMs: 3000,
      list: () => [{ id: 'a', rootPath: 'E:\\S', status: 'offline' as LibraryStatus }],
      resolve: () => pending,
      onChange: (id, r) => changes.push([id, r])
    })
    const t = m.tick()
    m.stop()
    release({ status: 'online', rootPath: 'E:\\S' })
    await t
    expect(changes).toEqual([])
  })

  it('reporta a transição online -> offline', async () => {
    const changes: [string, Resolved][] = []
    const m = new LibraryMonitor({
      intervalMs: 3000,
      list: () => [{ id: 'a', rootPath: 'E:\\S', status: 'online' as LibraryStatus }],
      resolve: async () => ({ status: 'offline' }),
      onChange: (id, r) => changes.push([id, r])
    })
    await m.tick()
    expect(changes).toEqual([['a', { status: 'offline' }]])
  })
})
