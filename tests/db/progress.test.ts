import { describe, it, expect } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { getDeviceId, getPrefs, getProgress, listContinueWatching, saveProgress, setPrefs } from '../../src/main/db/progress'
import { seedMovie, seedSeries } from '../helpers/seed'

describe('progresso', () => {
  it('grava e relê; a duração antiga é mantida quando a nova não vem', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, durationS: 1380, watched: false })
    saveProgress(db, { itemKey: keys[0]!, positionS: 200, watched: false })
    expect(getProgress(db, keys[0]!)).toMatchObject({ positionS: 200, durationS: 1380, watched: false })
    expect(getProgress(db, 'inexistente')).toBeUndefined()
  })

  it('o id do aparelho é gerado uma vez e fica estável', () => {
    const { db } = seedSeries()
    const a = getDeviceId(db)
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(getDeviceId(db)).toBe(a)
  })

  it('preferências: campo ausente mantém o valor antigo; "off" é guardado', () => {
    const { db, titleId } = seedSeries()
    expect(getPrefs(db, titleId)).toEqual({})
    setPrefs(db, titleId, { audioLang: 'jpn' })
    setPrefs(db, titleId, { subLang: 'por' })
    expect(getPrefs(db, titleId)).toEqual({ audioLang: 'jpn', subLang: 'por' })
    setPrefs(db, titleId, { subLang: 'off' })
    expect(getPrefs(db, titleId)).toEqual({ audioLang: 'jpn', subLang: 'off' })
  })
})

describe('listContinueWatching', () => {
  it('um card por título, com o item atualizado mais recentemente', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, durationS: 1380, watched: false, updatedAt: '2026-10-01T10:00:00.000Z' })
    saveProgress(db, { itemKey: keys[1]!, positionS: 400, durationS: 1380, watched: false, updatedAt: '2026-10-02T10:00:00.000Z' })
    const cards = listContinueWatching(db)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ titleName: 'Dark', itemKey: keys[1], season: 1, episode: 2, positionS: 400, durationS: 1380, available: true })
  })

  it('item assistido mostra o próximo episódio, sem progresso', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 1370, durationS: 1380, watched: true })
    const cards = listContinueWatching(db)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ itemKey: keys[1], episode: 2, positionS: 0 })
  })

  it('o próximo episódio pula os que não têm arquivo (ausentes)', () => {
    const { db, keys, fileIds } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 1370, durationS: 1380, watched: true })
    repo.markMissing(db, 'lib1', new Set([fileIds[0]!, fileIds[2]!])) // E02 sumiu do disco
    expect(listContinueWatching(db)[0]).toMatchObject({ itemKey: keys[2], episode: 3 })
  })

  it('assistiu o último episódio: o título sai da fileira', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[2]!, positionS: 1370, durationS: 1380, watched: true })
    expect(listContinueWatching(db)).toEqual([])
  })

  it('filme: aparece enquanto não terminou e some depois de assistido', () => {
    const { db } = seedSeries()
    const m = seedMovie(db)
    saveProgress(db, { itemKey: m.key, positionS: 3000, durationS: 9000, watched: false })
    expect(listContinueWatching(db).map((c) => [c.kind, c.titleName, c.positionS])).toEqual([['movie', 'Dune', 3000]])
    saveProgress(db, { itemKey: m.key, positionS: 8900, durationS: 9000, watched: true })
    expect(listContinueWatching(db)).toEqual([])
  })

  it('biblioteca offline: o card continua, marcado como indisponível', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, durationS: 1380, watched: false })
    repo.setLibraryStatus(db, 'lib1', 'offline')
    expect(listContinueWatching(db)[0]).toMatchObject({ itemKey: keys[0], available: false })
  })

  it('item cujos arquivos foram todos removidos não aparece', () => {
    const { db, keys, fileIds } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, durationS: 1380, watched: false })
    repo.markMissing(db, 'lib1', new Set([fileIds[1]!, fileIds[2]!]))
    expect(listContinueWatching(db)).toEqual([])
  })

  it('sem duração gravada, usa a duração lida do arquivo', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, watched: false })
    expect(listContinueWatching(db)[0]?.durationS).toBe(1380)
  })
})
