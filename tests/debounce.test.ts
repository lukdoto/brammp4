import { afterEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '../src/main/debounce'

afterEach(() => vi.useRealTimers())

describe('debounce', () => {
  it('junta chamadas próximas em uma só', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 500, 2000)
    d.call()
    vi.advanceTimersByTime(300)
    d.call()
    vi.advanceTimersByTime(499)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('chamadas contínuas ainda disparam a cada maxWait', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 500, 2000)
    for (let t = 0; t < 4500; t += 100) {
      d.call()
      vi.advanceTimersByTime(100)
    }
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel descarta o disparo pendente', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 500, 2000)
    d.call()
    d.cancel()
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
  })
})
