import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/main/db/database'
import * as repo from '../../src/main/db/repo'

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  repo.upsertLibrary(db, { id: 'lib1', label: 'HD Séries', rootPath: 'E:\\Videos\\Series' })
})

function addEpisode(code: string, relPath: string, libraryId = 'lib1') {
  const titleId = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark' })
  const key = `local:dark:${code}`
  repo.upsertItem(db, { key, titleId, season: Number(code.slice(1, 3)), episode: Number(code.slice(4)) })
  return repo.upsertFile(db, { itemKey: key, libraryId, relPath, size: 100, mtimeMs: 1, probe: { height: 1080, videoCodec: 'hevc', tracks: [] } })
}

describe('repo', () => {
  it('migra e lista bibliotecas', () => {
    expect(repo.listLibraries(db)).toEqual([
      { id: 'lib1', label: 'HD Séries', rootPath: 'E:\\Videos\\Series', status: 'online', lastScanAt: undefined }
    ])
  })

  it('upsertTitle é idempotente pela chave local', () => {
    const a = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark' })
    const b = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'dark' })
    expect(a).toBe(b)
  })

  it('upsertItem: nome novo vence, nome vazio mantém o antigo', () => {
    const titleId = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark' })
    const key = 'local:dark:S01E01'
    repo.upsertItem(db, { key, titleId, season: 1, episode: 1 })
    repo.upsertFile(db, { itemKey: key, libraryId: 'lib1', relPath: 'Dark/e1.mkv', size: 1, mtimeMs: 1 })
    const nameOf = () => repo.getTitleDetail(db, titleId)!.items[0]!.name
    expect(nameOf()).toBeUndefined()
    repo.upsertItem(db, { key, titleId, season: 1, episode: 1, name: 'Segredos' })
    expect(nameOf()).toBe('Segredos')
    repo.upsertItem(db, { key, titleId, season: 1, episode: 1 })
    expect(nameOf()).toBe('Segredos')
    repo.upsertItem(db, { key, titleId, season: 1, episode: 1, name: 'Outro' })
    expect(nameOf()).toBe('Outro')
  })

  it('upsertTitle renomeia e completa o ano, exceto título já casado (tmdb_id)', () => {
    const id = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'DARK' })
    repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark', year: 2017 })
    repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark' })
    const row = () => db.prepare('SELECT name, year FROM titles WHERE id = ?').get(id) as { name: string; year: number | null }
    expect(row()).toEqual({ name: 'Dark', year: 2017 })
    db.prepare('UPDATE titles SET tmdb_id = 1 WHERE id = ?').run(id)
    repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'OUTRO', year: 1999 })
    expect(row()).toEqual({ name: 'Dark', year: 2017 })
  })

  it('upsertFile com probe undefined preserva os dados lidos antes', () => {
    const id = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    const again = repo.upsertFile(db, { itemKey: 'local:dark:S01E01', libraryId: 'lib1', relPath: 'Dark/S1/e1.mkv', size: 100, mtimeMs: 1 })
    expect(again).toBe(id)
    expect(repo.listLibraryFiles(db, 'lib1')[0]!.probedAt).not.toBeNull()
    expect(repo.getTitleDetail(db, repo.getCatalog(db).series[0]!.id)!.items[0]!.files[0]!.height).toBe(1080)
  })

  it('catálogo, detalhe e contagem de faixas', () => {
    const f1 = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    addEpisode('S01E02', 'Dark/S1/e2.mkv')
    repo.replaceEmbeddedTracks(db, f1, [
      { type: 'audio', streamIndex: 1, typeIndex: 1, codec: 'aac', lang: 'por', isDefault: true, isForced: false }
    ])
    repo.replaceExternalSubs(db, f1, [{ relPath: 'Dark/S1/e1.pt-BR.srt', lang: 'por', forced: false, sdh: false, codec: 'srt' }])
    const cat = repo.getCatalog(db)
    expect(cat.series).toEqual([{ id: expect.any(Number), kind: 'series', name: 'Dark', year: undefined, available: true, offlineLabels: [] }])
    const detail = repo.getTitleDetail(db, cat.series[0]!.id)!
    expect(detail.items.map((i) => [i.season, i.episode])).toEqual([[1, 1], [1, 2]])
    expect(detail.items[0]!.files[0]).toMatchObject({ audioCount: 1, subCount: 1, libraryLabel: 'HD Séries', available: true })
  })

  it('biblioteca offline: título continua visível, indisponível, com o apelido', () => {
    addEpisode('S01E01', 'Dark/S1/e1.mkv')
    repo.setLibraryStatus(db, 'lib1', 'offline')
    expect(repo.getCatalog(db).series[0]).toMatchObject({ available: false, offlineLabels: ['HD Séries'] })
  })

  it('markMissing esconde arquivos não vistos e mostra de novo quando voltam', () => {
    const f1 = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    const f2 = addEpisode('S01E02', 'Dark/S1/e2.mkv')
    repo.markMissing(db, 'lib1', new Set([f1]))
    expect(repo.getTitleDetail(db, repo.getCatalog(db).series[0]!.id)!.items).toHaveLength(1)
    repo.markMissing(db, 'lib1', new Set([f1, f2]))
    expect(repo.getTitleDetail(db, repo.getCatalog(db).series[0]!.id)!.items).toHaveLength(2)
  })

  it('biblioteca offline não ressuscita arquivo marcado como sumido', () => {
    const f1 = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    addEpisode('S01E02', 'Dark/S1/e2.mkv')
    repo.markMissing(db, 'lib1', new Set([f1]))
    repo.setLibraryStatus(db, 'lib1', 'offline')
    const cat = repo.getCatalog(db)
    expect(cat.series[0]).toMatchObject({ available: false, offlineLabels: ['HD Séries'] })
    expect(repo.getTitleDetail(db, cat.series[0]!.id)!.items.map((i) => i.episode)).toEqual([1])
    repo.markMissing(db, 'lib1', new Set())
    repo.setLibraryStatus(db, 'lib1', 'offline')
    expect(repo.getCatalog(db).series).toEqual([])
  })

  it('biblioteca offline com arquivo presente: aparece apagado com o apelido', () => {
    addEpisode('S01E01', 'Dark/S1/e1.mkv')
    repo.setLibraryStatus(db, 'lib1', 'offline')
    const cat = repo.getCatalog(db)
    expect(cat.series[0]).toMatchObject({ available: false, offlineLabels: ['HD Séries'] })
    expect(repo.getTitleDetail(db, cat.series[0]!.id)!.items[0]!.files[0]).toMatchObject({ available: false })
  })

  it('apelido de biblioteca offline só aparece se ela ainda tem arquivo do título', () => {
    repo.upsertLibrary(db, { id: 'lib2', label: 'HD Antigo', rootPath: 'F:\\Series' })
    addEpisode('S01E01', 'Dark/e1.mkv', 'lib1')
    const gone = addEpisode('S01E01', 'Dark/e1.mkv', 'lib2')
    repo.markMissing(db, 'lib2', new Set())
    expect(gone).toBeGreaterThan(0)
    repo.setLibraryStatus(db, 'lib1', 'offline')
    repo.setLibraryStatus(db, 'lib2', 'offline')
    expect(repo.getCatalog(db).series[0]!.offlineLabels).toEqual(['HD Séries'])
  })

  it('setLibraryStatus atualiza o endereço quando a letra muda', () => {
    repo.setLibraryStatus(db, 'lib1', 'online', 'F:\\Videos\\Series')
    expect(repo.listLibraries(db)[0]!.rootPath).toBe('F:\\Videos\\Series')
  })

  it('resumo da biblioteca', () => {
    const f1 = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    repo.replaceExternalSubs(db, f1, [{ relPath: 'Dark/S1/e1.srt', forced: false, sdh: false, codec: 'srt' }])
    repo.replaceUnmatched(db, 'lib1', [{ relPath: 'x.mkv', reason: 'nome não reconhecido' }])
    expect(repo.librarySummary(db, 'lib1')).toEqual({ series: 1, movies: 0, episodes: 1, subtitles: 1, unmatched: 1 })
  })
})
