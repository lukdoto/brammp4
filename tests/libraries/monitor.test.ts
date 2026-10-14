import { describe, it, expect } from 'vitest'
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
})
