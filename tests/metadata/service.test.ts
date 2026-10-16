import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetadataService } from '../../src/main/metadata/service'
import { TmdbError, type TmdbClient, type TmdbTitle } from '../../src/main/metadata/tmdb'
import type { ImageCache } from '../../src/main/metadata/images'
import * as meta from '../../src/main/db/metadata'
import { seedMovie, seedSeries } from '../helpers/seed'

const NOW = new Date('2026-10-16T12:00:00.000Z')

const dark: TmdbTitle = { id: 70523, name: 'Dark', year: 2017, overview: 'Sinopse', posterPath: '/p.jpg', backdropPath: '/b.jpg' }

function fakeClient(over: Partial<TmdbClient> = {}): TmdbClient & { [K in keyof TmdbClient]: ReturnType<typeof vi.fn> } {
  return {
    validate: vi.fn(async () => undefined),
    search: vi.fn(async () => [dark]),
    details: vi.fn(async () => dark),
    season: vi.fn(async (_id: number, season: number) => [
      { season, episode: 1, name: 'Segredos', overview: 'o1' },
      { season, episode: 2, name: 'Mentiras' },
      { season, episode: 3, name: 'Passado' }
    ]),
    ...over
  } as never
}

function fakeImages(fail = false): ImageCache & { ensure: ReturnType<typeof vi.fn> } {
  return {
    ensure: vi.fn(async (size: string, p: string) => (fail ? undefined : `${size}-${p.slice(1)}`))
  } as never
}

function make(db: ReturnType<typeof seedSeries>['db'], client: TmdbClient | null, images: ImageCache = fakeImages(), extra: { retryMs?: number } = {}) {
  const onChange = vi.fn()
  const svc = new MetadataService({ db, client: () => client, images, now: () => NOW, onChange, ...extra })
  return { svc, onChange }
}

const titleRow = (db: ReturnType<typeof seedSeries>['db'], id: number) => db.prepare('SELECT * FROM titles WHERE id = ?').get(id) as Record<string, unknown>

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sync', () => {
  it('vincula série, grava pôster e fundo, busca episódios e chama onChange', async () => {
    const { db, titleId } = seedSeries()
    const client = fakeClient()
    const { svc, onChange } = make(db, client)
    await svc.sync()
    expect(client.search).toHaveBeenCalledWith('series', 'Dark', undefined)
    expect(titleRow(db, titleId)).toMatchObject({
      tmdb_id: 70523, match_source: 'auto', overview: 'Sinopse', poster_cache: 'w342-p.jpg', backdrop_cache: 'w780-b.jpg', year: 2017
    })
    expect(client.season).toHaveBeenCalledWith(70523, 1)
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E02'`).get()).toMatchObject({ tmdb_name: 'Mentiras' })
    expect(onChange).toHaveBeenCalled()
    expect(svc.status()).toEqual({ hasKey: true, syncing: false, pending: 0 })
  })

  it('vincula filme sem buscar temporadas e repassa o ano', async () => {
    const { db } = seedSeries()
    const dune = seedMovie(db, 'Dune', 2021)
    const client = fakeClient({ search: vi.fn(async () => [{ id: 438631, name: 'Duna', year: 2021 }]) })
    const { svc } = make(db, client)
    await svc.sync()
    expect(client.search).toHaveBeenCalledWith('movie', 'Dune', 2021)
    expect(titleRow(db, dune.titleId)).toMatchObject({ tmdb_id: 438631, name: 'Duna', poster_cache: null })
    expect(client.season).toHaveBeenCalledTimes(1) // só a série "Dark" (resultado do search falso)
  })

  it('sem chave (client() null): não faz nada e status.hasKey false', async () => {
    const { db, titleId } = seedSeries()
    const { svc, onChange } = make(db, null)
    await svc.sync()
    expect(svc.status()).toEqual({ hasKey: false, syncing: false, pending: 1 })
    expect(titleRow(db, titleId).tmdb_id).toBeNull()
    expect(titleRow(db, titleId).tmdb_checked_at).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rede caindo: não marca verificado e tenta na próxima rodada', async () => {
    const { db, titleId } = seedSeries()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const search = vi.fn().mockRejectedValueOnce(new TmdbError('network')).mockResolvedValue([dark])
    const { svc } = make(db, fakeClient({ search }))
    await expect(svc.sync()).resolves.toBeUndefined()
    expect(titleRow(db, titleId).tmdb_checked_at).toBeNull()
    expect(titleRow(db, titleId).tmdb_id).toBeNull()
    expect(spy).toHaveBeenCalled()
    await svc.sync()
    expect(titleRow(db, titleId).tmdb_id).toBe(70523)
  })

  it('rede caindo: reagenda a nova rodada após retryMs (timer falso)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { db, titleId } = seedSeries()
    const search = vi.fn().mockRejectedValueOnce(new TmdbError('network')).mockResolvedValue([dark])
    const { svc } = make(db, fakeClient({ search }), fakeImages(), { retryMs: 1000 })
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(titleRow(db, titleId).tmdb_id).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(titleRow(db, titleId).tmdb_id).toBe(70523)
    svc.stop()
  })

  it('stop() cancela o timer pendente', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { db } = seedSeries()
    const search = vi.fn().mockRejectedValue(new TmdbError('network'))
    const { svc } = make(db, fakeClient({ search }), fakeImages(), { retryMs: 1000 })
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(search).toHaveBeenCalledTimes(1)
    svc.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('rate-limit também encerra a rodada sem marcar verificado', async () => {
    const { db, titleId } = seedSeries()
    seedMovie(db)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const search = vi.fn().mockRejectedValue(new TmdbError('rate-limit'))
    const { svc } = make(db, fakeClient({ search }))
    await svc.sync()
    expect(search).toHaveBeenCalledTimes(1)
    expect(titleRow(db, titleId).tmdb_checked_at).toBeNull()
  })

  it('sem resultados: marca verificado e não repete na mesma semana', async () => {
    const { db, titleId } = seedSeries()
    const search = vi.fn(async () => [])
    const { svc } = make(db, fakeClient({ search }))
    await svc.sync()
    expect(titleRow(db, titleId).tmdb_checked_at).toBe(NOW.toISOString())
    expect(titleRow(db, titleId).tmdb_id).toBeNull()
    await svc.sync()
    expect(search).toHaveBeenCalledTimes(1)
    expect(svc.status().pending).toBe(0)
  })

  it('invalid-key encerra a rodada sem lançar, sem marcar e sem reagendar até novo sync()', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { db, titleId } = seedSeries()
    seedMovie(db)
    const search = vi.fn().mockRejectedValueOnce(new TmdbError('invalid-key')).mockResolvedValue([dark])
    const { svc } = make(db, fakeClient({ search }), fakeImages(), { retryMs: 1000 })
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(search).toHaveBeenCalledTimes(1)
    expect(titleRow(db, titleId).tmdb_checked_at).toBeNull()
    expect(spy).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(search).toHaveBeenCalledTimes(1)
    await svc.sync() // chave corrigida: chamada explícita retoma
    expect(titleRow(db, titleId).tmdb_id).toBe(70523)
    svc.stop()
  })

  it('sync concorrente roda uma vez', async () => {
    const { db } = seedSeries()
    const client = fakeClient()
    const { svc } = make(db, client)
    const a = svc.sync()
    const b = svc.sync()
    expect(a).toBe(b)
    await Promise.all([a, b])
    expect(client.search).toHaveBeenCalledTimes(1)
    await svc.sync()
    expect(svc.status().syncing).toBe(false)
  })

  it('imagem que falha não impede gravar sinopse e é refeita depois', async () => {
    const { db, titleId } = seedSeries()
    const failing = fakeImages(true)
    const client = fakeClient()
    const { svc } = make(db, client, failing)
    await svc.sync()
    expect(titleRow(db, titleId)).toMatchObject({ tmdb_id: 70523, overview: 'Sinopse', poster_cache: null, backdrop_cache: null })

    failing.ensure.mockImplementation(async (size: string, p: string) => `${size}-${p.slice(1)}`)
    const { svc: svc2 } = make(db, client, failing)
    await svc2.sync()
    expect(client.details).toHaveBeenCalledWith('series', 70523)
    expect(titleRow(db, titleId)).toMatchObject({ poster_cache: 'w342-p.jpg', backdrop_cache: 'w780-b.jpg' })
  })

  it('séries vinculadas ganham nomes de episódios novos em rodadas seguintes', async () => {
    const { db, titleId } = seedSeries()
    const client = fakeClient({ season: vi.fn().mockRejectedValueOnce(new TmdbError('bad-response')).mockImplementation(async () => [{ season: 1, episode: 1, name: 'X' }]) })
    const { svc } = make(db, client)
    await svc.sync()
    expect(meta.listSeasonsNeedingEpisodes(db, titleId)).toEqual([1])
    // mesma execução do app: uma tentativa por temporada
    await svc.sync()
    expect(client.season).toHaveBeenCalledTimes(1)
    // novo serviço = nova execução do app
    const { svc: svc2 } = make(db, client)
    await svc2.sync()
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E01'`).get()).toMatchObject({ tmdb_name: 'X' })
  })

  it('não vaza a chave: erros desconhecidos são logados só pelo nome', async () => {
    const { db } = seedSeries()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const search = vi.fn().mockRejectedValue(new Error('https://api.themoviedb.org/3/x?api_key=SEGREDO'))
    const { svc } = make(db, fakeClient({ search }))
    await expect(svc.sync()).resolves.toBeUndefined()
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SEGREDO')
  })
})

describe('assign', () => {
  it('assign manual troca o vínculo, vira manual e o automático nunca mais mexe', async () => {
    const { db, titleId } = seedSeries()
    const client = fakeClient()
    const { svc, onChange } = make(db, client)
    await svc.sync()
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E01'`).get()).toMatchObject({ tmdb_name: 'Segredos' })

    const other: TmdbTitle = { id: 999, name: 'Outra', year: 2020, posterPath: '/o.jpg' }
    client.details.mockResolvedValue(other)
    client.season.mockResolvedValue([{ season: 1, episode: 1, name: 'Piloto' }])
    onChange.mockClear()
    expect(await svc.assign(titleId, 999)).toBe('ok')
    expect(titleRow(db, titleId)).toMatchObject({ tmdb_id: 999, match_source: 'manual', name: 'Outra', poster_cache: 'w342-o.jpg', overview: null })
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E01'`).get()).toMatchObject({ tmdb_name: 'Piloto' })
    // episódios do vínculo anterior sumiram
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E02'`).get()).toMatchObject({ tmdb_name: null })
    expect(onChange).toHaveBeenCalled()

    client.search.mockClear()
    await svc.sync()
    expect(client.search).not.toHaveBeenCalled()
    expect(titleRow(db, titleId)).toMatchObject({ tmdb_id: 999, match_source: 'manual' })
  })

  it('assign de série com tmdbId de filme (details 404) devolve not-found', async () => {
    const { db, titleId } = seedSeries()
    const client = fakeClient({ details: vi.fn().mockRejectedValue(new TmdbError('bad-response')) })
    const { svc } = make(db, client)
    expect(await svc.assign(titleId, 438631)).toBe('not-found')
    expect(titleRow(db, titleId).tmdb_id).toBeNull()
  })

  it('assign para título filme usa kind movie e não busca temporadas', async () => {
    const { db } = seedSeries()
    const dune = seedMovie(db)
    const client = fakeClient({ details: vi.fn(async () => ({ id: 438631, name: 'Duna', year: 2021 })) })
    const { svc } = make(db, client)
    expect(await svc.assign(dune.titleId, 438631)).toBe('ok')
    expect(client.details).toHaveBeenCalledWith('movie', 438631)
    expect(client.season).not.toHaveBeenCalled()
  })

  it('assign sem chave devolve no-key', async () => {
    const { db, titleId } = seedSeries()
    const { svc } = make(db, null)
    expect(await svc.assign(titleId, 1)).toBe('no-key')
  })

  it('assign de título inexistente devolve not-found', async () => {
    const { db } = seedSeries()
    const { svc } = make(db, fakeClient())
    expect(await svc.assign(12345, 1)).toBe('not-found')
  })

  it('assign propaga falha de rede e de chave sem alterar o título', async () => {
    const { db, titleId } = seedSeries()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const details = vi.fn().mockRejectedValueOnce(new TmdbError('network')).mockRejectedValueOnce(new TmdbError('invalid-key'))
    const { svc } = make(db, fakeClient({ details }))
    expect(await svc.assign(titleId, 1)).toBe('network')
    expect(await svc.assign(titleId, 1)).toBe('invalid-key')
    expect(titleRow(db, titleId).tmdb_id).toBeNull()
  })

  it('assign com erro de episódios ainda devolve ok (melhor esforço)', async () => {
    const { db, titleId } = seedSeries()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { svc } = make(db, fakeClient({ season: vi.fn().mockRejectedValue(new TmdbError('network')) }))
    expect(await svc.assign(titleId, 70523)).toBe('ok')
    expect(titleRow(db, titleId).tmdb_id).toBe(70523)
  })
})

describe('search / status', () => {
  it('search rejeita query vazia', async () => {
    const { db } = seedSeries()
    const client = fakeClient()
    const { svc } = make(db, client)
    await expect(svc.search('series', '   ')).rejects.toBeInstanceOf(Error)
    expect(client.search).not.toHaveBeenCalled()
  })

  it('search sem chave rejeita e com chave repassa a consulta aparada', async () => {
    const { db } = seedSeries()
    const none = make(db, null).svc
    await expect(none.search('movie', 'dune')).rejects.toBeInstanceOf(Error)
    const client = fakeClient()
    const { svc } = make(db, client)
    expect(await svc.search('movie', '  dune ', 2021)).toEqual([dark])
    expect(client.search).toHaveBeenCalledWith('movie', 'dune', 2021)
  })

  it('status.pending conta os pendentes', () => {
    const { db } = seedSeries()
    seedMovie(db)
    const { svc } = make(db, fakeClient())
    expect(svc.status().pending).toBe(2)
  })
})
