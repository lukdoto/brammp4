import { describe, expect, it } from 'vitest'
import { createTmdbClient, TmdbError } from '../../src/main/metadata/tmdb'

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; throws?: Error; raw?: string }

function fake(replies: Reply[]) {
  const calls: { url: URL; headers: Record<string, string> }[] = []
  const sleeps: number[] = []
  const fetchFn = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: new URL(String(input)), headers: { ...(init?.headers ?? {}) } })
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]
    if (r.throws) throw r.throws
    const text = r.raw ?? JSON.stringify(r.body ?? {})
    return new Response(text, { status: r.status ?? 200, headers: r.headers })
  }) as unknown as typeof fetch
  const sleep = async (ms: number) => {
    sleeps.push(ms)
  }
  return { calls, sleeps, fetchFn, sleep }
}

const KEY = 'abc123secretkey'

function client(replies: Reply[], key = KEY) {
  const f = fake(replies)
  return { ...f, c: createTmdbClient({ key, fetch: f.fetchFn, sleep: f.sleep }) }
}

describe('createTmdbClient', () => {
  it('search de série usa /3/search/tv, language=pt-BR, include_adult=false, first_air_date_year', async () => {
    const { c, calls } = client([{ body: { results: [] } }])
    await c.search('series', 'Dark', 2017)
    const u = calls[0].url
    expect(u.origin + u.pathname).toBe('https://api.themoviedb.org/3/search/tv')
    expect(u.searchParams.get('query')).toBe('Dark')
    expect(u.searchParams.get('language')).toBe('pt-BR')
    expect(u.searchParams.get('include_adult')).toBe('false')
    expect(u.searchParams.get('first_air_date_year')).toBe('2017')
  })

  it('search de filme usa /3/search/movie e year', async () => {
    const { c, calls } = client([{ body: { results: [] } }])
    await c.search('movie', 'Matrix', 1999)
    const u = calls[0].url
    expect(u.pathname).toBe('/3/search/movie')
    expect(u.searchParams.get('year')).toBe('1999')
    expect(u.searchParams.has('first_air_date_year')).toBe(false)
  })

  it('chave v3 vai em api_key; token eyJ vai em Authorization Bearer e não na URL', async () => {
    const v3 = client([{ body: { results: [] } }])
    await v3.c.search('movie', 'x')
    expect(v3.calls[0].url.searchParams.get('api_key')).toBe(KEY)
    expect(v3.calls[0].headers.Authorization).toBeUndefined()

    const token = 'eyJhbGciOi.payload.sig'
    const v4 = client([{ body: { results: [] } }], token)
    await v4.c.search('movie', 'x')
    expect(v4.calls[0].url.toString()).not.toContain(token)
    expect(v4.calls[0].url.searchParams.has('api_key')).toBe(false)
    expect(v4.calls[0].headers.Authorization).toBe(`Bearer ${token}`)
  })

  it('normaliza ano de first_air_date/release_date e ignora data vazia', async () => {
    const tv = client([{ body: { results: [{ id: 1, name: 'A', first_air_date: '2017-12-01' }, { id: 2, name: 'B', first_air_date: '' }] } }])
    const r = await tv.c.search('series', 'a')
    expect(r[0]).toMatchObject({ id: 1, name: 'A', year: 2017 })
    expect(r[1].year).toBeUndefined()

    const mv = client([{ body: { results: [{ id: 3, title: 'M', release_date: '1999-03-31' }, { id: 4, title: 'N' }] } }])
    const m = await mv.c.search('movie', 'm')
    expect(m[0]).toMatchObject({ id: 3, name: 'M', year: 1999 })
    expect(m[1].year).toBeUndefined()
  })

  it('poster_path e overview nulos viram undefined', async () => {
    const { c } = client([{ body: { results: [{ id: 1, name: 'A', poster_path: null, backdrop_path: null, overview: null }] } }])
    const [t] = await c.search('series', 'a')
    expect(t.posterPath).toBeUndefined()
    expect(t.backdropPath).toBeUndefined()
    expect(t.overview).toBeUndefined()
  })

  it('mantém poster, fundo e sinopse quando existem', async () => {
    const { c } = client([{ body: { id: 9, title: 'F', poster_path: '/p.jpg', backdrop_path: '/b.jpg', overview: 'Sinopse', release_date: '2001-01-01' } }])
    const t = await c.details('movie', 9)
    expect(t).toEqual({ id: 9, name: 'F', year: 2001, overview: 'Sinopse', posterPath: '/p.jpg', backdropPath: '/b.jpg' })
  })

  it('details usa /3/tv/{id} e /3/movie/{id} com language=pt-BR', async () => {
    const { c, calls } = client([{ body: { id: 5, name: 'S' } }, { body: { id: 6, title: 'F' } }])
    await c.details('series', 5)
    expect(calls[0].url.pathname).toBe('/3/tv/5')
    expect(calls[0].url.searchParams.get('language')).toBe('pt-BR')
    await c.details('movie', 6)
    expect(calls[1].url.pathname).toBe('/3/movie/6')
  })

  it('results vazio devolve []', async () => {
    const { c } = client([{ body: { results: [] } }])
    expect(await c.search('series', 'nada')).toEqual([])
  })

  it('401 vira TmdbError invalid-key', async () => {
    const { c } = client([{ status: 401, body: { status_code: 7 } }])
    await expect(c.search('series', 'x')).rejects.toMatchObject({ name: 'TmdbError', code: 'invalid-key' })
  })

  it('fetch que lança vira TmdbError network', async () => {
    const { c } = client([{ throws: new Error('boom') }])
    const err = await c.search('series', 'x').catch((e) => e)
    expect(err).toBeInstanceOf(TmdbError)
    expect(err.code).toBe('network')
  })

  it('JSON inesperado vira bad-response', async () => {
    const a = client([{ raw: '<html>oops</html>' }])
    await expect(a.c.search('series', 'x')).rejects.toMatchObject({ code: 'bad-response' })
    const b = client([{ body: { semResults: true } }])
    await expect(b.c.search('series', 'x')).rejects.toMatchObject({ code: 'bad-response' })
    const c2 = client([{ status: 500, body: {} }])
    await expect(c2.c.search('series', 'x')).rejects.toMatchObject({ code: 'bad-response' })
  })

  it('429 espera Retry-After (máx 30 s, via sleep injetado) e repete uma vez; segundo 429 vira rate-limit', async () => {
    const ok = client([{ status: 429, headers: { 'Retry-After': '2' } }, { body: { results: [] } }])
    expect(await ok.c.search('series', 'x')).toEqual([])
    expect(ok.sleeps).toEqual([2000])
    expect(ok.calls).toHaveLength(2)

    const capped = client([{ status: 429, headers: { 'Retry-After': '120' } }, { status: 429, headers: { 'Retry-After': '1' } }])
    await expect(capped.c.search('series', 'x')).rejects.toMatchObject({ code: 'rate-limit' })
    expect(capped.sleeps).toEqual([30000])
    expect(capped.calls).toHaveLength(2)
  })

  it('season devolve episódios com número, nome e sinopse', async () => {
    const { c, calls } = client([
      { body: { episodes: [{ season_number: 1, episode_number: 1, name: 'Segredos', overview: 'Algo' }, { season_number: 1, episode_number: 2, name: '', overview: null }] } }
    ])
    const eps = await c.season(70523, 1)
    expect(calls[0].url.pathname).toBe('/3/tv/70523/season/1')
    expect(calls[0].url.searchParams.get('language')).toBe('pt-BR')
    expect(eps).toEqual([
      { season: 1, episode: 1, name: 'Segredos', overview: 'Algo' },
      { season: 1, episode: 2, name: undefined, overview: undefined }
    ])
  })

  it('validate usa /3/authentication e 401 vira invalid-key', async () => {
    const ok = client([{ body: { success: true } }])
    await ok.c.validate()
    expect(ok.calls[0].url.pathname).toBe('/3/authentication')

    const bad = client([{ status: 401, body: {} }])
    await expect(bad.c.validate()).rejects.toMatchObject({ code: 'invalid-key' })
  })

  it('a mensagem de TmdbError nunca contém a chave', async () => {
    const cases: Reply[] = [
      { status: 401 },
      { throws: new Error(`failed https://api.themoviedb.org/3/x?api_key=${KEY}`) },
      { raw: 'nope' },
      { status: 429 },
      { status: 500 }
    ]
    for (const r of cases) {
      const { c } = client([r])
      const err = await c.search('series', 'x').catch((e) => e)
      expect(err).toBeInstanceOf(TmdbError)
      expect(String(err.message)).not.toContain(KEY)
      expect(String(err.stack ?? '')).not.toContain(KEY)
      expect(JSON.stringify(err)).not.toContain(KEY)
    }
  })
})
