export interface TmdbTitle {
  id: number
  name: string
  year?: number
  overview?: string
  posterPath?: string
  backdropPath?: string
}

export interface TmdbEpisode {
  season: number
  episode: number
  name?: string
  overview?: string
}

export type TmdbErrorCode = 'invalid-key' | 'network' | 'rate-limit' | 'bad-response'

const MESSAGES: Record<TmdbErrorCode, string> = {
  'invalid-key': 'Chave do TMDB inválida',
  network: 'Falha de rede ao consultar o TMDB',
  'rate-limit': 'Limite de requisições do TMDB atingido',
  'bad-response': 'Resposta inesperada do TMDB'
}

export class TmdbError extends Error {
  readonly code: TmdbErrorCode
  constructor(code: TmdbErrorCode) {
    super(MESSAGES[code])
    this.name = 'TmdbError'
    this.code = code
  }
}

export interface TmdbClient {
  validate(): Promise<void>
  search(kind: 'series' | 'movie', query: string, year?: number): Promise<TmdbTitle[]>
  details(kind: 'series' | 'movie', id: number): Promise<TmdbTitle>
  season(tvId: number, season: number): Promise<TmdbEpisode[]>
}

const BASE = 'https://api.themoviedb.org/3'
const LANGUAGE = 'pt-BR'
const MAX_RETRY_MS = 30_000

export function authFor(key: string): { query?: Record<string, string>; headers?: Record<string, string> } {
  return key.startsWith('eyJ') ? { headers: { Authorization: `Bearer ${key}` } } : { query: { api_key: key } }
}

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

function yearOf(v: unknown): number | undefined {
  const s = str(v)
  const m = s ? /^(\d{4})/.exec(s) : null
  return m ? Number(m[1]) : undefined
}

function toTitle(raw: unknown, kind: 'series' | 'movie'): TmdbTitle {
  if (!isObj(raw) || typeof raw.id !== 'number') throw new TmdbError('bad-response')
  const name = str(kind === 'series' ? raw.name : raw.title)
  if (!name) throw new TmdbError('bad-response')
  return {
    id: raw.id,
    name,
    year: yearOf(kind === 'series' ? raw.first_air_date : raw.release_date),
    overview: str(raw.overview),
    posterPath: str(raw.poster_path),
    backdropPath: str(raw.backdrop_path)
  }
}

export function createTmdbClient(opts: {
  key: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}): TmdbClient {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const auth = authFor(opts.key)

  async function attempt(path: string, params: Record<string, string>): Promise<Response> {
    const url = new URL(BASE + path)
    for (const [k, v] of Object.entries({ ...params, ...auth.query })) url.searchParams.set(k, v)
    try {
      return await doFetch(url.toString(), {
        headers: { Accept: 'application/json', ...auth.headers },
        signal: AbortSignal.timeout(15000)
      })
    } catch {
      // descarta a causa: a mensagem original pode conter a URL (com a chave)
      throw new TmdbError('network')
    }
  }

  async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    let res = await attempt(path, params)
    if (res.status === 429) {
      const secs = Number(res.headers.get('Retry-After'))
      const ms = Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, MAX_RETRY_MS) : 1000
      await sleep(ms)
      res = await attempt(path, params)
      if (res.status === 429) throw new TmdbError('rate-limit')
    }
    if (res.status === 401) throw new TmdbError('invalid-key')
    if (!res.ok) throw new TmdbError('bad-response')
    try {
      return await res.json()
    } catch {
      throw new TmdbError('bad-response')
    }
  }

  const seg = (kind: 'series' | 'movie') => (kind === 'series' ? 'tv' : 'movie')

  return {
    async validate() {
      await get('/authentication')
    },
    async search(kind, query, year) {
      const params: Record<string, string> = { query, language: LANGUAGE, include_adult: 'false' }
      if (year !== undefined) params[kind === 'series' ? 'first_air_date_year' : 'year'] = String(year)
      const body = await get(`/search/${seg(kind)}`, params)
      if (!isObj(body) || !Array.isArray(body.results)) throw new TmdbError('bad-response')
      return body.results.map((r) => toTitle(r, kind))
    },
    async details(kind, id) {
      return toTitle(await get(`/${seg(kind)}/${id}`, { language: LANGUAGE }), kind)
    },
    async season(tvId, season) {
      const body = await get(`/tv/${tvId}/season/${season}`, { language: LANGUAGE })
      if (!isObj(body) || !Array.isArray(body.episodes)) throw new TmdbError('bad-response')
      return body.episodes.map((e): TmdbEpisode => {
        if (!isObj(e) || typeof e.episode_number !== 'number') throw new TmdbError('bad-response')
        return {
          season: typeof e.season_number === 'number' ? e.season_number : season,
          episode: e.episode_number,
          name: str(e.name),
          overview: str(e.overview)
        }
      })
    }
  }
}
