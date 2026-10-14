import { describe, it, expect } from 'vitest'
import { slugify, titleOf, itemsOf, episodeCode, episodeCodesOf } from '../../src/main/parser/keys'

describe('keys', () => {
  it('slugify remove acentos e mantém letras não latinas', () => {
    expect(slugify('La Casa de Papel')).toBe('la-casa-de-papel')
    expect(slugify('Pokémon: A Série!')).toBe('pokemon-a-serie')
    expect(slugify('進撃の巨人')).toBe('進撃の巨人')
  })
  it('episodeCode com zero à esquerda', () => expect(episodeCode(1, 3)).toBe('S01E03'))
  it('chaves de episódio duplo', () => {
    const p = { kind: 'episode' as const, seriesName: 'Dark', season: 1, episodes: [1, 2] }
    expect(titleOf(p)).toEqual({ kind: 'series', localKey: 'series:dark', name: 'Dark', year: undefined })
    expect(itemsOf(p)).toEqual([
      { key: 'local:dark:S01E01', season: 1, episode: 1 },
      { key: 'local:dark:S01E02', season: 1, episode: 2 }
    ])
    expect(episodeCodesOf(p)).toEqual(['S01E01', 'S01E02'])
  })
  it('chave de filme inclui ano quando existe', () => {
    expect(itemsOf({ kind: 'movie', title: 'Interestelar', year: 2014 })).toEqual([{ key: 'local:interestelar-2014', season: null, episode: null }])
    expect(titleOf({ kind: 'movie', title: 'Interestelar' }).localKey).toBe('movie:interestelar')
  })
})
