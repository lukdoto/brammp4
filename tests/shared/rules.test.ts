import { describe, it, expect } from 'vitest'
import { isWatched, nextAvailable, resumeStart, type OrderedItem } from '../../src/shared/rules'

describe('isWatched', () => {
  it('90% ou mais conta como assistido', () => {
    expect(isWatched(3078, 3420)).toBe(true)
    expect(isWatched(3077, 3420)).toBe(false)
  })
  it('faltando menos de 2 min conta, mas só depois da metade', () => {
    expect(isWatched(481, 600)).toBe(true) // faltam 119 s
    expect(isWatched(479, 600)).toBe(false) // faltam 121 s
    expect(isWatched(10, 100)).toBe(false) // clipe curto não nasce assistido
    expect(isWatched(60, 100)).toBe(true)
  })
  it('sem duração conhecida nunca é assistido', () => {
    expect(isWatched(5000, undefined)).toBe(false)
    expect(isWatched(5000, 0)).toBe(false)
    expect(isWatched(5000, Number.NaN)).toBe(false)
  })
})

describe('resumeStart', () => {
  it('menos de 30 s recomeça do zero', () => {
    expect(resumeStart(undefined, false)).toBe(0)
    expect(resumeStart(10, false)).toBe(0)
    expect(resumeStart(29.9, false)).toBe(0)
  })
  it('volta 5 s a partir de 30 s', () => {
    expect(resumeStart(30, false)).toBe(25)
    expect(resumeStart(1834, false)).toBe(1829)
  })
  it('assistido recomeça do zero', () => {
    expect(resumeStart(1834, true)).toBe(0)
  })
})

describe('nextAvailable', () => {
  const it3: OrderedItem[] = [
    { key: 'e1', season: 1, episode: 1, available: true },
    { key: 'e2', season: 1, episode: 2, available: false },
    { key: 'e3', season: 1, episode: 3, available: true },
    { key: 's2e1', season: 2, episode: 1, available: true }
  ]
  it('pula episódios indisponíveis', () => {
    expect(nextAvailable(it3, 'e1')?.key).toBe('e3')
  })
  it('passa para a próxima temporada', () => {
    expect(nextAvailable(it3, 'e3')?.key).toBe('s2e1')
  })
  it('não há próximo depois do último ou para chave desconhecida', () => {
    expect(nextAvailable(it3, 's2e1')).toBeUndefined()
    expect(nextAvailable(it3, 'nao-existe')).toBeUndefined()
  })
  it('ordena por temporada e episódio mesmo com a lista embaralhada; filmes (sem temporada) ficam por último', () => {
    const mixed: OrderedItem[] = [
      { key: 'filme', season: null, episode: null, available: true },
      { key: 's1e2', season: 1, episode: 2, available: true },
      { key: 's1e1', season: 1, episode: 1, available: true }
    ]
    expect(nextAvailable(mixed, 's1e1')?.key).toBe('s1e2')
    expect(nextAvailable(mixed, 's1e2')?.key).toBe('filme')
  })
})
