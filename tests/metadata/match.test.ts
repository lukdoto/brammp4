import { describe, expect, it } from 'vitest'
import { pickBest } from '../../src/main/metadata/match'
import type { TmdbTitle } from '../../src/main/metadata/tmdb'

const t = (id: number, name: string, year?: number): TmdbTitle => ({ id, name, year })

describe('pickBest', () => {
  it('prefere nome igual (sem acento/caixa) com o mesmo ano', () => {
    const r = [t(1, 'Amélie', 2020), t(2, 'AMELIE', 2001), t(3, 'Amelie', 2001)]
    expect(pickBest(r, 'amélie', 2001)?.id).toBe(2)
  })

  it('sem ano usa o primeiro com nome igual', () => {
    const r = [t(1, 'Outro'), t(2, 'Dark', 2017), t(3, 'Dark', 2020)]
    expect(pickBest(r, 'dark')?.id).toBe(2)
  })

  it('com ano sem nenhum nome+ano igual ainda usa o primeiro nome igual', () => {
    const r = [t(1, 'Outro', 1999), t(2, 'Dark', 2017)]
    expect(pickBest(r, 'Dark', 1999)?.id).toBe(2)
  })

  it('sem nome igual cai no primeiro resultado (spec seção 9)', () => {
    const r = [t(7, 'Algo Parecido'), t(8, 'Outra Coisa')]
    expect(pickBest(r, 'Nada Igual', 2010)?.id).toBe(7)
  })

  it('lista vazia devolve undefined', () => {
    expect(pickBest([], 'x')).toBeUndefined()
  })
})
