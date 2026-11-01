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
    expect(client.season).toHaveBeenCalledTimes(1) // só a série "Dark": o fakeClient devolve o mesmo resultado de search para a série e para o filme, e temporadas só existem para séries
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

  it('busca com bad-response num título não impede identificar os seguintes', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { db, titleId } = seedSeries()
    const dune = seedMovie(db, 'Dune', 2021)
    const search = vi.fn(async (kind: string) => {
      if (kind === 'series') throw new TmdbError('bad-response')
      return [{ id: 438631, name: 'Duna', year: 2021 }]
    })
    const { svc } = make(db, fakeClient({ search }), fakeImages(), { retryMs: 1000 })
    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(titleRow(db, dune.titleId).tmdb_id).toBe(438631)
    // sem marcar verificado: na próxima execução do app tenta de novo
    expect(titleRow(db, titleId).tmdb_checked_at).toBeNull()
    expect(titleRow(db, titleId).tmdb_id).toBeNull()
    // na mesma execução não repete o título problemático
    await vi.advanceTimersByTimeAsync(5000)
    await svc.sync()
    expect(search.mock.calls.filter((c) => c[0] === 'series')).toHaveLength(1)
    svc.stop()
  })

  it('sync pedido durante uma rodada roda de novo ao terminar', async () => {
    const { db } = seedSeries()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const search = vi.fn(async (kind: string) => {
      if (kind === 'series') await gate
      return kind === 'series' ? [dark] : [{ id: 438631, name: 'Duna', year: 2021 }]
    })
    const { svc } = make(db, fakeClient({ search }))
    const first = svc.sync()
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    const dune = seedMovie(db, 'Dune', 2021) // chegou pelo scan no meio da rodada
    const second = svc.sync()
    release()
    await Promise.all([first, second])
    expect(titleRow(db, dune.titleId).tmdb_id).toBe(438631)
    expect(svc.status().syncing).toBe(false)
  })

  it('chave apagada no meio da rodada: nenhuma requisição nova com a chave antiga', async () => {
    const { db, titleId } = seedSeries()
    seedMovie(db, 'Dune', 2021)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const client = fakeClient({
      search: vi.fn(async () => {
        await gate
        return [dark]
      })
    })
    let current: TmdbClient | null = client
    const svc = new MetadataService({ db, client: () => current, images: fakeImages(), now: () => NOW, onChange: vi.fn() })
    const syncing = svc.sync()
    await vi.waitFor(() => expect(client.search).toHaveBeenCalledTimes(1))
    current = null
    svc.keyChanged()
    release()
    await syncing
    expect(client.search).toHaveBeenCalledTimes(1)
    expect(client.season).not.toHaveBeenCalled()
    expect(client.details).not.toHaveBeenCalled()
    expect(titleRow(db, titleId).tmdb_checked_at).toBeNull()
  })

  it('chave trocada no meio da rodada: continua com a chave nova', async () => {
    const { db } = seedSeries()
    const dune = seedMovie(db, 'Dune', 2021)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const old = fakeClient({
      search: vi.fn(async () => {
        await gate
        return [dark]
      })
    })
    const fresh = fakeClient({ search: vi.fn(async () => [{ id: 438631, name: 'Duna', year: 2021 }]) })
    let current: TmdbClient = old
    const svc = new MetadataService({ db, client: () => current, images: fakeImages(), now: () => NOW, onChange: vi.fn() })
    const syncing = svc.sync()
    await vi.waitFor(() => expect(old.search).toHaveBeenCalledTimes(1))
    current = fresh
    svc.keyChanged()
    release()
    await syncing
    expect(old.search).toHaveBeenCalledTimes(1)
    expect(old.season).not.toHaveBeenCalled()
    expect(fresh.search).toHaveBeenCalledWith('movie', 'Dune', 2021)
    expect(titleRow(db, dune.titleId).tmdb_id).toBe(438631)
  })

  it('sync depois de stop() não faz nada', async () => {
    const { db } = seedSeries()
    const client = fakeClient()
    const { svc } = make(db, client)
    svc.stop()
    await svc.sync()
    expect(client.search).not.toHaveBeenCalled()
  })

  it('stop() no meio da rodada não faz novas requisições', async () => {
    const { db } = seedSeries()
    seedMovie(db, 'Dune', 2021)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const client = fakeClient({
      search: vi.fn(async () => {
        await gate
        return [dark]
      })
    })
    const { svc } = make(db, client)
    svc.start()
    await vi.waitFor(() => expect(client.search).toHaveBeenCalledTimes(1))
    svc.stop()
    release()
    await vi.waitFor(() => expect(svc.status().syncing).toBe(false))
    expect(client.search).toHaveBeenCalledTimes(1)
    expect(client.season).not.toHaveBeenCalled()
  })

  it('arquivo de imagem apagado do cache é baixado de novo', async () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 70523, name: 'Dark', posterFile: 'w342-velho.jpg', backdropFile: 'w780-b.jpg', source: 'auto' })
    const images = fakeImages()
    const client = fakeClient()
    const svc = new MetadataService({
      db,
      client: () => client,
      images,
      now: () => NOW,
      onChange: vi.fn(),
      imageExists: (f) => f !== 'w342-velho.jpg'
    })
    await svc.sync()
    expect(client.details).toHaveBeenCalledWith('series', 70523)
    expect(titleRow(db, titleId)).toMatchObject({ poster_cache: 'w342-p.jpg', backdrop_cache: 'w780-b.jpg' })
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

describe('corrida assign x sync', () => {
  const manual: TmdbTitle = { id: 999, name: 'Outra', year: 2020 }
  const deferred = <T,>() => {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
  }
  const seasonFor = vi.fn(async (id: number, season: number) =>
    id === 999 ? [{ season, episode: 1, name: 'Piloto', overview: 'manual' }] : [{ season, episode: 1, name: 'Errado' }, { season, episode: 2, name: 'Errado2', overview: 'errado' }]
  )

  it('assign durante o search do sync: episódios e vínculo ficam do id manual', async () => {
    const { db, titleId } = seedSeries()
    const gate = deferred<TmdbTitle[]>()
    const client = fakeClient({ search: vi.fn(() => gate.promise), details: vi.fn(async () => manual), season: seasonFor })
    const { svc } = make(db, client)
    const syncing = svc.sync()
    await vi.waitFor(() => expect(client.search).toHaveBeenCalled())
    expect(await svc.assign(titleId, 999)).toBe('ok')
    gate.resolve([dark])
    await syncing
    expect(titleRow(db, titleId)).toMatchObject({ tmdb_id: 999, match_source: 'manual', name: 'Outra' })
    expect(client.season).not.toHaveBeenCalledWith(70523, expect.anything())
    expect(db.prepare(`SELECT tmdb_name, overview FROM items WHERE key = 'local:dark:S01E01'`).get()).toMatchObject({ tmdb_name: 'Piloto', overview: 'manual' })
    expect(db.prepare(`SELECT tmdb_name, overview FROM items WHERE key = 'local:dark:S01E02'`).get()).toMatchObject({ tmdb_name: null, overview: null })
  })

  it('assign durante o download de imagem do sync: o automático não grava nada', async () => {
    const { db, titleId } = seedSeries()
    const gate = deferred<string | undefined>()
    const images = fakeImages()
    images.ensure.mockImplementationOnce(() => gate.promise)
    const client = fakeClient({ details: vi.fn(async () => manual), season: seasonFor })
    const { svc } = make(db, client, images)
    const syncing = svc.sync()
    await vi.waitFor(() => expect(images.ensure).toHaveBeenCalled())
    expect(await svc.assign(titleId, 999)).toBe('ok')
    gate.resolve('w342-p.jpg')
    await syncing
    expect(titleRow(db, titleId)).toMatchObject({ tmdb_id: 999, match_source: 'manual', name: 'Outra' })
    expect(client.season).not.toHaveBeenCalledWith(70523, expect.anything())
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E02'`).get()).toMatchObject({ tmdb_name: null })
  })

  it('troca de vínculo no meio de um season(): episódios do id antigo são descartados', async () => {
    const { db, titleId } = seedSeries()
    const gate = deferred<{ season: number; episode: number; name?: string; overview?: string }[]>()
    const season = vi.fn((id: number, s: number) => (id === 70523 ? gate.promise : seasonFor(id, s)))
    const client = fakeClient({ details: vi.fn(async () => manual), season })
    const { svc } = make(db, client)
    const syncing = svc.sync()
    await vi.waitFor(() => expect(season).toHaveBeenCalledWith(70523, 1))
    expect(await svc.assign(titleId, 999)).toBe('ok')
    gate.resolve([{ season: 1, episode: 1, name: 'Errado' }, { season: 1, episode: 2, name: 'Errado2', overview: 'errado' }])
    await syncing
    expect(titleRow(db, titleId)).toMatchObject({ tmdb_id: 999, match_source: 'manual' })
    expect(db.prepare(`SELECT tmdb_name, overview FROM items WHERE key = 'local:dark:S01E01'`).get()).toMatchObject({ tmdb_name: 'Piloto', overview: 'manual' })
    expect(db.prepare(`SELECT tmdb_name, overview FROM items WHERE key = 'local:dark:S01E02'`).get()).toMatchObject({ tmdb_name: null, overview: null })
  })

  it('troca de vínculo no meio de um season() de série já vinculada (syncLinkedSeries)', async () => {
    const { db, titleId } = seedSeries()
    meta.applyTitleMatch(db, titleId, { tmdbId: 70523, name: 'Dark', posterFile: 'w342-p.jpg', backdropFile: 'w780-b.jpg', source: 'auto' })
    const gate = deferred<{ season: number; episode: number; name?: string }[]>()
    const season = vi.fn((id: number, s: number) => (id === 70523 ? gate.promise : seasonFor(id, s)))
    const client = fakeClient({ details: vi.fn(async () => manual), season })
    const { svc } = make(db, client)
    const syncing = svc.sync()
    await vi.waitFor(() => expect(season).toHaveBeenCalledWith(70523, 1))
    expect(await svc.assign(titleId, 999)).toBe('ok')
    gate.resolve([{ season: 1, episode: 2, name: 'Errado2' }])
    await syncing
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E02'`).get()).toMatchObject({ tmdb_name: null })
    expect(db.prepare(`SELECT tmdb_name FROM items WHERE key = 'local:dark:S01E01'`).get()).toMatchObject({ tmdb_name: 'Piloto' })
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
