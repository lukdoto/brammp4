import { describe, expect, it } from 'vitest'
import { ProgressTracker, type SavedProgress } from '../../src/main/player/tracker'

function make() {
  const saved: SavedProgress[] = []
  let clock = 0
  const tracker = new ProgressTracker({ save: (p) => saved.push(p), now: () => clock })
  return { tracker, saved, tick: (ms: number) => (clock += ms) }
}

describe('ProgressTracker', () => {
  it('antes de armar nada é gravado (retomar nunca sobrescreve o ponto salvo com ~0)', () => {
    const { tracker, saved, tick } = make()
    tracker.onTimePos(0)
    tick(10000)
    tracker.onTimePos(0.4)
    tracker.onPause(true)
    tracker.flush()
    tracker.onEnd('quit')
    expect(saved).toEqual([])
  })

  it('depois de armar grava logo a primeira posição, e a cada 5 s', () => {
    const { tracker, saved, tick } = make()
    tracker.arm()
    tracker.onTimePos(1829)
    expect(saved.map((s) => s.positionS)).toEqual([1829]) // o ponto retomado, nunca 0
    tick(4999)
    tracker.onTimePos(1834)
    expect(saved).toHaveLength(1)
    tick(1)
    tracker.onTimePos(1835)
    expect(saved.map((s) => s.positionS)).toEqual([1829, 1835])
  })

  it('pausar grava na hora; repetir a mesma posição não grava de novo', () => {
    const { tracker, saved, tick } = make()
    tracker.arm()
    tracker.onTimePos(100)
    tick(1000)
    tracker.onTimePos(103)
    tracker.onPause(false)
    expect(saved).toHaveLength(1)
    tracker.onPause(true)
    expect(saved.map((s) => s.positionS)).toEqual([100, 103])
    tracker.onPause(true)
    tracker.flush()
    expect(saved).toHaveLength(2)
  })

  it('valores inválidos de posição e duração são ignorados', () => {
    const { tracker, saved } = make()
    tracker.arm()
    tracker.onTimePos(null)
    tracker.onTimePos(Number.NaN)
    tracker.onTimePos(-3)
    tracker.onTimePos('10')
    tracker.onDuration(0)
    tracker.onDuration('x')
    tracker.flush()
    expect(saved).toEqual([])
    expect(tracker.positionS).toBeUndefined()
  })

  it('inclui a duração depois que ela é conhecida e marca assistido pela regra', () => {
    const { tracker, saved, tick } = make()
    tracker.arm()
    tracker.onTimePos(500)
    expect(saved[0]).toEqual({ positionS: 500, watched: false })
    tracker.onDuration(1380)
    tick(5000)
    tracker.onTimePos(1300)
    expect(saved[1]).toEqual({ positionS: 1300, durationS: 1380, watched: true })
  })

  it('fim por eof: vai até a duração e conta como assistido', () => {
    const { tracker, saved } = make()
    tracker.arm()
    tracker.onDuration(1380)
    tracker.onTimePos(1370)
    tracker.onEnd('eof')
    expect(saved.at(-1)).toEqual({ positionS: 1380, durationS: 1380, watched: true })
  })

  it('fim por quit/stop/error: grava a última posição, sem forçar o fim', () => {
    for (const reason of ['quit', 'stop', 'error']) {
      const { tracker, saved } = make()
      tracker.arm()
      tracker.onDuration(1380)
      tracker.onTimePos(600)
      tracker.onEnd(reason)
      expect(saved.at(-1)).toEqual({ positionS: 600, durationS: 1380, watched: false })
    }
  })

  it('arm descarta a posição lida antes de armar (flush não grava ~0)', () => {
    const { tracker, saved } = make()
    tracker.onTimePos(0.4)
    tracker.arm()
    tracker.flush()
    expect(saved).toEqual([])
  })

  it('pausar ou sair logo depois de armar, sem posição nova, não grava a posição antiga', () => {
    const { tracker, saved } = make()
    tracker.onTimePos(0.4)
    tracker.arm()
    tracker.onPause(true)
    tracker.onEnd('quit')
    expect(saved).toEqual([])
  })

  it('a primeira posição gravada depois de armar é a nova, nunca a de antes', () => {
    const { tracker, saved } = make()
    tracker.onTimePos(0.4)
    tracker.arm()
    tracker.onTimePos(1829)
    expect(saved.map((s) => s.positionS)).toEqual([1829])
  })

  it('se save lança, a próxima gravação idêntica não é suprimida como duplicada', () => {
    const saved: SavedProgress[] = []
    let fail = true
    const tracker = new ProgressTracker({
      save: (p) => {
        if (fail) {
          fail = false
          throw new Error('disco ocupado')
        }
        saved.push(p)
      },
      now: () => 0
    })
    tracker.arm()
    expect(() => tracker.onTimePos(100)).toThrow('disco ocupado')
    expect(() => tracker.flush()).not.toThrow()
    expect(saved.map((s) => s.positionS)).toEqual([100])
  })

  it('flush grava a última posição conhecida mesmo dentro dos 5 s', () => {
    const { tracker, saved, tick } = make()
    tracker.arm()
    tracker.onTimePos(100)
    tick(1000)
    tracker.onTimePos(101)
    expect(saved).toHaveLength(1)
    tracker.flush()
    expect(saved.at(-1)?.positionS).toBe(101)
  })
})
