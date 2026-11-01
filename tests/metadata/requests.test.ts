import { describe, expect, it } from 'vitest'
import { parseAssignTmdbRequest, parseReclassifyRequest, parseSearchRequest } from '../../src/main/metadata/requests'

const notObjects = [null, undefined, 'x', 42, true, [], () => 1]

describe('parseSearchRequest', () => {
  it('aceita pedido válido, com trim e ano opcional', () => {
    expect(parseSearchRequest({ kind: 'series', query: '  Dark ' })).toEqual({ kind: 'series', query: 'Dark' })
    expect(parseSearchRequest({ kind: 'movie', query: 'Dune', year: 2021, extra: 1 })).toEqual({ kind: 'movie', query: 'Dune', year: 2021 })
  })
  it('rejeita kind, query e ano inválidos', () => {
    expect(parseSearchRequest({ kind: 'tv', query: 'a' })).toBeNull()
    expect(parseSearchRequest({ query: 'a' })).toBeNull()
    for (const q of [undefined, 5, '', '   ', 'a'.repeat(101), {}]) expect(parseSearchRequest({ kind: 'movie', query: q })).toBeNull()
    expect(parseSearchRequest({ kind: 'movie', query: 'a'.repeat(100) })).not.toBeNull()
    for (const y of [1869, 2201, NaN, 2000.5, '2000', Infinity, null]) expect(parseSearchRequest({ kind: 'movie', query: 'a', year: y })).toBeNull()
    expect(parseSearchRequest({ kind: 'movie', query: 'a', year: 1870 })).toMatchObject({ year: 1870 })
    expect(parseSearchRequest({ kind: 'movie', query: 'a', year: 2200 })).toMatchObject({ year: 2200 })
  })
  it('rejeita o que não é objeto', () => {
    for (const r of notObjects) expect(parseSearchRequest(r)).toBeNull()
  })
})

describe('parseAssignTmdbRequest', () => {
  it('aceita inteiros positivos e ignora campos extras', () => {
    expect(parseAssignTmdbRequest({ titleId: 3, tmdbId: 70523, x: 1 })).toEqual({ titleId: 3, tmdbId: 70523 })
  })
  it('rejeita valores inválidos em cada campo', () => {
    for (const v of [0, -1, NaN, 1.5, '3', null, undefined, Infinity, {}]) {
      expect(parseAssignTmdbRequest({ titleId: v, tmdbId: 1 })).toBeNull()
      expect(parseAssignTmdbRequest({ titleId: 1, tmdbId: v })).toBeNull()
    }
  })
  it('rejeita o que não é objeto', () => {
    for (const r of notObjects) expect(parseAssignTmdbRequest(r)).toBeNull()
  })
})

describe('parseReclassifyRequest', () => {
  const ep = { libraryId: 'lib1', relPath: 'a/b.mkv', target: { kind: 'episode', series: ' Dark ', season: 2, episode: 5 } }
  it('aceita episódio e filme, com trim', () => {
    expect(parseReclassifyRequest(ep)).toEqual({
      libraryId: 'lib1', relPath: 'a/b.mkv', target: { kind: 'episode', series: 'Dark', season: 2, episode: 5 }
    })
    expect(parseReclassifyRequest({ ...ep, target: { kind: 'movie', title: ' Dune ', year: 2021, z: 1 } })).toEqual({
      libraryId: 'lib1', relPath: 'a/b.mkv', target: { kind: 'movie', title: 'Dune', year: 2021 }
    })
    expect(parseReclassifyRequest({ ...ep, target: { kind: 'movie', title: 'Dune' } })!.target).toEqual({ kind: 'movie', title: 'Dune' })
    expect(parseReclassifyRequest({ ...ep, target: { ...ep.target, season: 0 } })).not.toBeNull()
  })
  it('rejeita libraryId e relPath inválidos', () => {
    for (const v of [undefined, 5, '', '  ', 'a'.repeat(501), {}]) {
      expect(parseReclassifyRequest({ ...ep, libraryId: v })).toBeNull()
      expect(parseReclassifyRequest({ ...ep, relPath: v })).toBeNull()
    }
    expect(parseReclassifyRequest({ ...ep, relPath: 'a'.repeat(500) })).not.toBeNull()
  })
  it('não apara relPath nem libraryId: o caminho é a chave do arquivo e precisa chegar como veio', () => {
    expect(parseReclassifyRequest({ ...ep, relPath: ' Série/ep 1.mkv ', libraryId: ' lib1' })).toMatchObject({
      libraryId: ' lib1', relPath: ' Série/ep 1.mkv '
    })
  })
  it('titleId opcional: inteiro positivo ou recusa o pedido', () => {
    expect(parseReclassifyRequest({ ...ep, titleId: 7 })).toMatchObject({ titleId: 7 })
    expect(parseReclassifyRequest(ep)).not.toHaveProperty('titleId')
    for (const v of [0, -1, 1.5, '7', null, NaN, Infinity]) expect(parseReclassifyRequest({ ...ep, titleId: v })).toBeNull()
  })
  it('rejeita alvo inválido', () => {
    for (const t of [...notObjects, { kind: 'x' }, {}]) expect(parseReclassifyRequest({ ...ep, target: t })).toBeNull()
    for (const s of [undefined, 3, '', '   ', 'a'.repeat(201)]) {
      expect(parseReclassifyRequest({ ...ep, target: { ...ep.target, series: s } })).toBeNull()
      expect(parseReclassifyRequest({ ...ep, target: { kind: 'movie', title: s } })).toBeNull()
    }
    for (const s of [-1, 201, NaN, 1.5, '2', null, Infinity]) expect(parseReclassifyRequest({ ...ep, target: { ...ep.target, season: s } })).toBeNull()
    for (const e of [0, -1, 10000, NaN, 1.5, '2', undefined]) expect(parseReclassifyRequest({ ...ep, target: { ...ep.target, episode: e } })).toBeNull()
    for (const y of [1869, 2201, NaN, 1.5, '2000', null]) expect(parseReclassifyRequest({ ...ep, target: { kind: 'movie', title: 'a', year: y } })).toBeNull()
    expect(parseReclassifyRequest({ ...ep, target: { ...ep.target, season: 200, episode: 9999 } })).not.toBeNull()
  })
  it('rejeita o que não é objeto', () => {
    for (const r of notObjects) expect(parseReclassifyRequest(r)).toBeNull()
  })
})
