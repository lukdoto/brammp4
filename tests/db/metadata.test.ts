import { describe, expect, it } from 'vitest'
import * as meta from '../../src/main/db/metadata'
import * as repo from '../../src/main/db/repo'
import * as progress from '../../src/main/db/progress'
import { seedMovie, seedSeries } from '../helpers/seed'

const NOW = '2026-10-16T12:00:00.000Z'
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString()

describe('listPendingTitles', () => {
  it('ignora títulos vinculados, manuais e já verificados há menos de 7 dias', () => {
    const { db, titleId } = seedSeries()
    const dune = seedMovie(db, 'Dune', 2021)
    const heat = seedMovie(db, 'Heat', 1995)
    const old = seedMovie(db, 'Old', 1990)
    expect(meta.listPendingTitles(db, NOW, 7).map((t) => t.id)).toEqual([titleId, dune.titleId, heat.titleId, old.titleId])

    meta.applyTitleMatch(db, dune.titleId, { tmdbId: 1, name: 'Duna', source: 'auto' })
    meta.applyTitleMatch(db, heat.titleId, { tmdbId: 2, name: 'Heat', source: 'manual' })
    meta.markChecked(db, titleId, ago(2))
    meta.markChecked(db, old.titleId, ago(8))
    const pending = meta.listPendingTitles(db, NOW, 7)
    expect(pending).toEqual([{ id: old.titleId, kind: 'movie', name: 'Old', year: 1990 }])
  })

  it('ignora título cujos arquivos estão todos missing', () => {
    const { db, titleId } = seedSeries()
    expect(meta.listPendingTitles(db, NOW, 7)).toHaveLength(1)
    repo.markMissing(db, 'lib1', new Set())
    expect(meta.listPendingTitles(db, NOW, 7)).toEqual([])
    expect(meta.countPending(db)).toBe(0)
    expect(titleId).toBeGreaterThan(0)
  })

  it('devolve kind, nome e ano (ausente vira undefined)', () => {
    const { db, titleId } = seedSeries()
    expect(meta.listPendingTitles(db, NOW, 7)).toEqual([{ id: titleId, kind: 'series', name: 'Dark' }])
  })
})

describe('applyTitleMatch', () => {
  it('grava e atualiza name/year', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, {
      tmdbId: 70523, name: 'Dark', year: 2017, overview: 'Sinopse', posterFile: 'w342-a.jpg', backdropFile: 'w780-b.jpg', source: 'auto'
    })
    const row = db.prepare('SELECT * FROM titles WHERE id = ?').get(titleId) as Record<string, unknown>
    expect(row).toMatchObject({
      tmdb_id: 70523, name: 'Dark', year: 2017, overview: 'Sinopse', poster_cache: 'w342-a.jpg', backdrop_cache: 'w780-b.jpg', match_source: 'auto'
    })
    expect(row.tmdb_checked_at).toBeNull()
    expect(meta.getTitleForAssign(db, titleId)).toEqual({ kind: 'series', tmdbId: 70523, matchSource: 'auto' })
  })

  it('com tmdbId diferente apaga tmdb_name e overview dos itens', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 1, name: 'A', source: 'auto' })
    meta.applyEpisodes(db, titleId, 1, [{ episode: 1, name: 'Segredos', overview: 'x' }], 1)
    meta.applyTitleMatch(db, titleId, { tmdbId: 2, name: 'B', source: 'manual' })
    const rows = db.prepare('SELECT tmdb_name, overview FROM items WHERE title_id = ?').all(titleId)
    expect(rows.every((r) => r.tmdb_name === null && r.overview === null)).toBe(true)
    expect(meta.listSeasonsNeedingEpisodes(db, titleId)).toEqual([1])
  })

  it('com o mesmo tmdbId preserva os nomes dos episódios e as imagens já gravadas', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 1, name: 'A', posterFile: 'w342-a.jpg', source: 'auto' })
    meta.applyEpisodes(db, titleId, 1, [{ episode: 1, name: 'Segredos', overview: 'x' }], 1)
    meta.applyTitleMatch(db, titleId, { tmdbId: 1, name: 'A', source: 'manual' })
    const item = db.prepare(`SELECT tmdb_name, overview FROM items WHERE key = 'local:dark:S01E01'`).get()
    expect(item).toMatchObject({ tmdb_name: 'Segredos', overview: 'x' })
    const t = db.prepare('SELECT poster_cache, match_source FROM titles WHERE id = ?').get(titleId)
    expect(t).toMatchObject({ poster_cache: 'w342-a.jpg', match_source: 'manual' })
  })

  it('ao trocar o vínculo, imagens do vínculo anterior somem', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 1, name: 'A', posterFile: 'w342-a.jpg', backdropFile: 'w780-a.jpg', overview: 'velha', source: 'auto' })
    meta.applyTitleMatch(db, titleId, { tmdbId: 2, name: 'B', source: 'manual' })
    expect(db.prepare('SELECT poster_cache, backdrop_cache, overview FROM titles WHERE id = ?').get(titleId)).toMatchObject({
      poster_cache: null, backdrop_cache: null, overview: null
    })
  })

  it('o automático nunca sobrescreve um vínculo manual', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 1, name: 'Manual', source: 'manual' })
    meta.applyTitleMatch(db, titleId, { tmdbId: 2, name: 'Auto', source: 'auto' })
    expect(meta.getTitleForAssign(db, titleId)).toEqual({ kind: 'series', tmdbId: 1, matchSource: 'manual' })
    expect(db.prepare('SELECT name FROM titles WHERE id = ?').get(titleId)).toMatchObject({ name: 'Manual' })
  })

  it('chave do item e progresso permanecem após vincular', () => {
    const { db, titleId, keys } = seedSeries()
    progress.saveProgress(db, { itemKey: keys[0]!, positionS: 120, durationS: 1380, watched: false })
    meta.applyTitleMatch(db, titleId, { tmdbId: 1, name: 'A', source: 'auto' })
    meta.applyTitleMatch(db, titleId, { tmdbId: 2, name: 'B', source: 'manual' })
    expect(db.prepare('SELECT key FROM items ORDER BY key').all().map((r) => r.key)).toEqual(keys)
    expect(db.prepare('SELECT position_s FROM progress WHERE item_key = ?').get(keys[0]!)).toMatchObject({ position_s: 120 })
  })
})

describe('markChecked / countPending', () => {
  it('markChecked grava o instante e tira o título da lista', () => {
    const { db, titleId } = seedSeries()
    expect(meta.countPending(db)).toBe(1)
    meta.markChecked(db, titleId, NOW)
    expect(meta.countPending(db)).toBe(0)
    expect(db.prepare('SELECT tmdb_checked_at FROM titles WHERE id = ?').get(titleId)).toMatchObject({ tmdb_checked_at: NOW })
  })
})

describe('episódios', () => {
  it('applyEpisodes não cria itens novos', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 7, name: 'Dark', source: 'auto' })
    meta.applyEpisodes(db, titleId, 1, [
      { episode: 1, name: 'Segredos' },
      { episode: 9, name: 'Inexistente' }
    ], 7)
    expect((db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n).toBe(3)
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E01'`).get()).toMatchObject({ tmdb_name: 'Segredos' })
    expect(meta.listSeasonsNeedingEpisodes(db, titleId)).toEqual([1])
    meta.applyEpisodes(db, titleId, 1, [{ episode: 2, name: 'b' }, { episode: 3, name: 'c' }], 7)
    expect(meta.listSeasonsNeedingEpisodes(db, titleId)).toEqual([])
  })

  it('o scanner (upsertItem) depois de applyEpisodes não apaga tmdb_name nem o progresso', () => {
    const { db, titleId, keys } = seedSeries()
    progress.saveProgress(db, { itemKey: keys[0]!, positionS: 77, durationS: 1380, watched: false })
    meta.applyTitleMatch(db, titleId, { tmdbId: 7, name: 'Dark', source: 'auto' })
    meta.applyEpisodes(db, titleId, 1, [{ episode: 1, name: 'Segredos', overview: 'sinopse' }], 7)
    repo.upsertItem(db, { key: keys[0]!, titleId, season: 1, episode: 1 })
    repo.upsertItem(db, { key: keys[0]!, titleId, season: 1, episode: 1, name: 'Nome do arquivo' })
    expect(db.prepare('SELECT tmdb_name, overview FROM items WHERE key = ?').get(keys[0]!)).toMatchObject({
      tmdb_name: 'Segredos', overview: 'sinopse'
    })
    expect(db.prepare('SELECT position_s FROM progress WHERE item_key = ?').get(keys[0]!)).toMatchObject({ position_s: 77 })
  })
})

describe('guardas de corrida', () => {
  it('applyEpisodes descarta quando o tmdbId esperado não é mais o do título', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 2, name: 'B', source: 'manual' })
    expect(meta.applyEpisodes(db, titleId, 1, [{ episode: 1, name: 'Errado', overview: 'x' }], 1)).toBe(false)
    expect(db.prepare(`SELECT tmdb_name, overview FROM items WHERE key = 'local:dark:S01E01'`).get()).toMatchObject({ tmdb_name: null, overview: null })
  })

  it('applyTitleMatch devolve false quando o automático é barrado pelo manual e true quando grava', () => {
    const { db, titleId } = seedSeries()
    expect(meta.applyTitleMatch(db, titleId, { tmdbId: 1, name: 'M', source: 'manual' })).toBe(true)
    expect(meta.applyTitleMatch(db, titleId, { tmdbId: 2, name: 'A', source: 'auto' })).toBe(false)
    expect(meta.applyTitleMatch(db, 9999, { tmdbId: 2, name: 'A', source: 'auto' })).toBe(false)
  })

  it('markChecked não toca título já vinculado', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 1, name: 'M', source: 'manual' })
    meta.markChecked(db, titleId, NOW)
    expect(db.prepare('SELECT tmdb_checked_at FROM titles WHERE id = ?').get(titleId)).toMatchObject({ tmdb_checked_at: null })
  })
})

describe('listMissingImages / applyTitleImages', () => {
  it('lista vinculados sem pôster ou sem fundo e preenche sem mexer no vínculo', () => {
    const { db, titleId } = seedSeries()
    expect(meta.listMissingImages(db)).toEqual([])
    meta.applyTitleMatch(db, titleId, { tmdbId: 5, name: 'Dark', source: 'manual' })
    expect(meta.listMissingImages(db)).toEqual([{ id: titleId, kind: 'series', tmdbId: 5 }])
    meta.applyTitleImages(db, titleId, { posterFile: 'w342-a.jpg', backdropFile: 'w780-a.jpg' })
    expect(meta.listMissingImages(db)).toEqual([])
    expect(meta.getTitleForAssign(db, titleId)).toMatchObject({ tmdbId: 5, matchSource: 'manual' })
  })

  it('listLinkedSeries devolve só séries vinculadas com arquivo disponível', () => {
    const { db, titleId } = seedSeries()
    const movie = seedMovie(db)
    meta.applyTitleMatch(db, titleId, { tmdbId: 5, name: 'Dark', source: 'auto' })
    meta.applyTitleMatch(db, movie.titleId, { tmdbId: 6, name: 'Dune', source: 'auto' })
    expect(meta.listLinkedSeries(db)).toEqual([{ id: titleId, tmdbId: 5 }])
  })
})

describe('getTitleForAssign', () => {
  it('devolve undefined para id inexistente e campos opcionais ausentes para não vinculado', () => {
    const { db, titleId } = seedSeries()
    expect(meta.getTitleForAssign(db, 999)).toBeUndefined()
    expect(meta.getTitleForAssign(db, titleId)).toEqual({ kind: 'series' })
  })
})
