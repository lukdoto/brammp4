import type { ReclassifyTarget } from '../../shared/types'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** String aparada com 1..max caracteres; qualquer outra coisa vira null. */
function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length >= 1 && s.length <= max ? s : null
}

/** Identificador (caminho, id): valida vazio e tamanho mas devolve exatamente o que veio. */
function ident(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  return v.trim().length >= 1 && v.length <= max ? v : null
}

function int(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null
}

const YEAR_MIN = 1870
const YEAR_MAX = 2200

export function parseSearchRequest(raw: unknown): { kind: 'series' | 'movie'; query: string; year?: number } | null {
  if (!isObj(raw)) return null
  const { kind } = raw
  if (kind !== 'series' && kind !== 'movie') return null
  const query = str(raw.query, 100)
  if (query === null) return null
  if (raw.year === undefined) return { kind, query }
  const year = int(raw.year, YEAR_MIN, YEAR_MAX)
  return year === null ? null : { kind, query, year }
}

export function parseAssignTmdbRequest(raw: unknown): { titleId: number; tmdbId: number } | null {
  if (!isObj(raw)) return null
  const titleId = int(raw.titleId, 1, Number.MAX_SAFE_INTEGER)
  const tmdbId = int(raw.tmdbId, 1, Number.MAX_SAFE_INTEGER)
  return titleId === null || tmdbId === null ? null : { titleId, tmdbId }
}

export interface ReclassifyRequest {
  libraryId: string
  relPath: string
  target: ReclassifyTarget
  /** Série existente escolhida na lista (para reaproveitar o título já identificado). */
  titleId?: number
}

function parseTarget(t: Obj): ReclassifyTarget | null {
  if (t.kind === 'movie') {
    const title = str(t.title, 200)
    if (title === null) return null
    if (t.year === undefined) return { kind: 'movie', title }
    const year = int(t.year, YEAR_MIN, YEAR_MAX)
    return year === null ? null : { kind: 'movie', title, year }
  }
  if (t.kind === 'episode') {
    const series = str(t.series, 200)
    const season = int(t.season, 0, 200)
    const episode = int(t.episode, 1, 9999)
    if (series === null || season === null || episode === null) return null
    return { kind: 'episode', series, season, episode }
  }
  return null
}

export function parseReclassifyRequest(raw: unknown): ReclassifyRequest | null {
  if (!isObj(raw)) return null
  const libraryId = ident(raw.libraryId, 500)
  const relPath = ident(raw.relPath, 500)
  if (libraryId === null || relPath === null || !isObj(raw.target)) return null
  const target = parseTarget(raw.target)
  if (target === null) return null
  if (raw.titleId === undefined) return { libraryId, relPath, target }
  const titleId = int(raw.titleId, 1, Number.MAX_SAFE_INTEGER)
  return titleId === null ? null : { libraryId, relPath, target, titleId }
}
