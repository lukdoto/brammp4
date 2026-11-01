import type { AssignResult, SetKeyResult, TmdbCandidate, TmdbSearchError, TmdbSearchResult } from '../../shared/types'
import { parseSearchRequest } from './requests'
import { NoKeyError, type AssignResult as ServiceAssignResult } from './service'
import { TmdbError, type TmdbTitle } from './tmdb'

/** Traduz a falha da validação da chave para o que o renderer pode ver; nunca devolve a mensagem original. */
export function setKeyError(e: unknown): Extract<SetKeyResult, { ok: false }> {
  if (e instanceof TmdbError && e.code === 'invalid-key') return { ok: false, error: 'invalid-key' }
  return { ok: false, error: 'network' }
}

export function toAssignResult(r: ServiceAssignResult): AssignResult {
  return r === 'ok' ? { ok: true } : { ok: false, error: r }
}

export function toCandidate(t: TmdbTitle): TmdbCandidate {
  const c: TmdbCandidate = { tmdbId: t.id, name: t.name }
  if (t.year !== undefined) c.year = t.year
  if (t.overview !== undefined) c.overview = t.overview.length > 240 ? t.overview.slice(0, 237) + '...' : t.overview
  return c
}

/** Código que o renderer mostra; nunca a mensagem original (poderia conter a URL com a chave). */
export function searchErrorOf(e: unknown): TmdbSearchError {
  if (e instanceof NoKeyError) return 'no-key'
  if (e instanceof TmdbError) return e.code
  return 'network'
}

/** Handler de `tmdb:search`: valida o pedido e diferencia "sem resultados" de falha. */
export async function runTmdbSearch(
  raw: unknown,
  search: (kind: 'series' | 'movie', query: string, year?: number) => Promise<TmdbTitle[]>
): Promise<TmdbSearchResult> {
  const req = parseSearchRequest(raw)
  if (!req) return { ok: false, error: 'invalid' }
  try {
    return { ok: true, results: (await search(req.kind, req.query, req.year)).map(toCandidate) }
  } catch (e) {
    const error = searchErrorOf(e)
    console.error('[metadata] busca manual falhou:', error === 'network' && !(e instanceof TmdbError) ? (e instanceof Error ? e.name : 'erro') : error)
    return { ok: false, error }
  }
}
