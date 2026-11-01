import { describe, expect, it } from 'vitest'
import * as meta from '../../src/main/db/metadata'
import * as repo from '../../src/main/db/repo'
import * as progress from '../../src/main/db/progress'
import { getPlayOptions } from '../../src/main/player/options'
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

describe('nomes do TMDB nas outras telas', () => {
  it('continuar assistindo e opções de reprodução mostram o nome do episódio do TMDB (e a capa)', () => {
    const { db, titleId, keys } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 70523, name: 'Dark', posterFile: 'w342-p.jpg', source: 'auto' })
    meta.applyEpisodes(db, titleId, 1, [{ episode: 1, name: 'Segredos' }, { episode: 2, name: 'Mentiras' }], 70523)
    progress.saveProgress(db, { itemKey: keys[0]!, positionS: 100, watched: false })
    expect(progress.listContinueWatching(db)[0]).toMatchObject({ itemKey: keys[0], episodeName: 'Segredos', posterFile: 'w342-p.jpg' })
    progress.saveProgress(db, { itemKey: keys[0]!, positionS: 1380, watched: true })
    expect(progress.listContinueWatching(db)[0]).toMatchObject({ itemKey: keys[1], episodeName: 'Mentiras' })
    expect(getPlayOptions(db, keys[1]!)).toMatchObject({ episodeName: 'Mentiras' })
    expect(getPlayOptions(db, keys[2]!)).not.toHaveProperty('episodeName')
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

  it('clearMissingImageFiles esquece só o arquivo que sumiu e o título volta para listMissingImages', () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 5, name: 'Dark', posterFile: 'w342-a.jpg', backdropFile: 'w780-a.jpg', source: 'auto' })
    expect(meta.clearMissingImageFiles(db, () => true)).toEqual([])
    expect(meta.listMissingImages(db)).toEqual([])
    expect(meta.clearMissingImageFiles(db, (f) => f !== 'w342-a.jpg')).toEqual([titleId])
    expect(db.prepare('SELECT poster_cache, backdrop_cache FROM titles WHERE id = ?').get(titleId)).toMatchObject({ poster_cache: null, backdrop_cache: 'w780-a.jpg' })
    expect(meta.listMissingImages(db)).toEqual([{ id: titleId, kind: 'series', tmdbId: 5 }])
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

describe('atribuições e não identificados', () => {
  const epTarget = { kind: 'episode', series: 'Dark', season: 2, episode: 5 } as const

  it('setAssignment grava, substitui por (biblioteca, caminho) e listAssignments devolve o mapa', () => {
    const { db } = seedSeries()
    meta.setAssignment(db, 'lib1', 'x/a.mkv', epTarget)
    meta.setAssignment(db, 'lib1', 'x/b.mkv', { kind: 'movie', title: 'Dune', year: 2021 })
    meta.setAssignment(db, 'lib1', 'x/a.mkv', { kind: 'movie', title: 'Outro' })
    const m = meta.listAssignments(db, 'lib1')
    expect(m.size).toBe(2)
    expect(m.get('x/a.mkv')).toEqual({ kind: 'movie', title: 'Outro' })
    expect(m.get('x/b.mkv')).toEqual({ kind: 'movie', title: 'Dune', year: 2021 })
    expect(meta.listAssignments(db, 'outra').size).toBe(0)
  })

  it('listAssignments ignora linha corrompida', () => {
    const { db } = seedSeries()
    db.prepare('INSERT INTO assignments (library_id, rel_path, target) VALUES (?, ?, ?)').run('lib1', 'ruim.mkv', '{nao-json')
    db.prepare('INSERT INTO assignments (library_id, rel_path, target) VALUES (?, ?, ?)').run('lib1', 'ruim2.mkv', '{"kind":"x"}')
    meta.setAssignment(db, 'lib1', 'ok.mkv', epTarget)
    expect([...meta.listAssignments(db, 'lib1').keys()]).toEqual(['ok.mkv'])
  })

  it('a chave primária é (library_id, rel_path): mesmo caminho em outra biblioteca coexiste', () => {
    const { db } = seedSeries()
    repo.upsertLibrary(db, { id: 'lib2', label: 'HD 2', rootPath: 'F:\\' })
    meta.setAssignment(db, 'lib1', 'x.mkv', epTarget)
    meta.setAssignment(db, 'lib2', 'x.mkv', { kind: 'movie', title: 'Heat' })
    meta.setAssignment(db, 'lib1', 'x.mkv', { kind: 'movie', title: 'Dune' })
    const n = db.prepare('SELECT COUNT(*) AS n FROM assignments').get() as { n: number }
    expect(n.n).toBe(2)
    expect(meta.listAssignments(db, 'lib2').get('x.mkv')).toEqual({ kind: 'movie', title: 'Heat' })
  })

  it('ON DELETE CASCADE: apagar a biblioteca apaga as atribuições', () => {
    const { db } = seedSeries()
    repo.upsertLibrary(db, { id: 'lib2', label: 'HD 2', rootPath: 'F:\\' })
    meta.setAssignment(db, 'lib1', 'x.mkv', epTarget)
    meta.setAssignment(db, 'lib2', 'y.mkv', epTarget)
    db.prepare('DELETE FROM libraries WHERE id = ?').run('lib1')
    expect(meta.listAssignments(db, 'lib1').size).toBe(0)
    expect(meta.listAssignments(db, 'lib2').size).toBe(1)
  })

  it('listUnmatched devolve só "nome não reconhecido", com rótulo da biblioteca, ordenado', () => {
    const { db } = seedSeries()
    repo.upsertLibrary(db, { id: 'lib2', label: 'Backup', rootPath: 'F:\\' })
    repo.replaceUnmatched(db, 'lib1', [
      { relPath: 'b.mkv', reason: 'nome não reconhecido' },
      { relPath: 'a.mkv', reason: 'nome não reconhecido' },
      { relPath: 'l.srt', reason: 'legenda sem vídeo correspondente' }
    ])
    repo.replaceUnmatched(db, 'lib2', [{ relPath: 'c.mkv', reason: 'nome não reconhecido' }])
    expect(meta.listUnmatched(db)).toEqual([
      { libraryId: 'lib2', libraryLabel: 'Backup', relPath: 'c.mkv', reason: 'nome não reconhecido' },
      { libraryId: 'lib1', libraryLabel: 'HD Séries', relPath: 'a.mkv', reason: 'nome não reconhecido' },
      { libraryId: 'lib1', libraryLabel: 'HD Séries', relPath: 'b.mkv', reason: 'nome não reconhecido' }
    ])
  })

  it('reclassifyToParsed converte filme e episódio', () => {
    expect(meta.reclassifyToParsed({ kind: 'movie', title: 'Dune', year: 2021 })).toEqual({ kind: 'movie', title: 'Dune', year: 2021 })
    expect(meta.reclassifyToParsed({ kind: 'movie', title: 'Dune' })).toEqual({ kind: 'movie', title: 'Dune' })
    expect(meta.reclassifyToParsed(epTarget)).toEqual({ kind: 'episode', seriesName: 'Dark', season: 2, episodes: [5] })
  })
})
