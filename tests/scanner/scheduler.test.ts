import { describe, it, expect } from 'vitest'
import { createScanScheduler } from '../../src/main/scanner/scheduler'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createScanScheduler', () => {
  it('chamada durante a execução dispara exatamente uma nova execução ao terminar', async () => {
    const gates = [deferred(), deferred(), deferred()]
    let runs = 0
    const scan = createScanScheduler(async () => {
      await gates[runs++]!.promise
      return runs
    })
    const first = scan('a')
    await tick()
    const second = scan('a')
    expect(second).toBe(first)
    expect(runs).toBe(1)
    gates[0]!.resolve()
    await first
    await tick()
    expect(runs).toBe(2)
    gates[1]!.resolve()
    await tick()
    expect(runs).toBe(2)
  })

  it('várias chamadas durante a execução colapsam em uma só repetição', async () => {
    const gates = [deferred(), deferred()]
    let runs = 0
    const scan = createScanScheduler(async () => {
      await gates[runs++]!.promise
    })
    const first = scan('a')
    scan('a')
    scan('a')
    scan('a')
    gates[0]!.resolve()
    await first
    await tick()
    gates[1]!.resolve()
    await tick()
    expect(runs).toBe(2)
  })

  it('sem chamada durante a execução não repete, e bibliotecas são independentes', async () => {
    const calls: string[] = []
    const scan = createScanScheduler(async (id) => {
      calls.push(id)
    })
    await scan('a')
    await scan('b')
    await tick()
    expect(calls).toEqual(['a', 'b'])
    await scan('a')
    expect(calls).toEqual(['a', 'b', 'a'])
  })
})
