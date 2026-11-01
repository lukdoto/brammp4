import type { AssignResult, SetKeyResult, TmdbCandidate } from '../../shared/types'
import type { AssignResult as ServiceAssignResult } from './service'
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
