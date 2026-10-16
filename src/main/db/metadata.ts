import type { Db } from './database'
import { tx } from './database'

const DAY_MS = 86_400_000

/** Título tem ao menos um arquivo que não está marcado como ausente. */
const HAS_FILE = `EXISTS (SELECT 1 FROM items i JOIN files f ON f.item_key = i.key WHERE i.title_id = t.id AND f.missing = 0)`

export interface PendingTitle {
  id: number
  kind: 'series' | 'movie'
  name: string
  year?: number
}

export function listPendingTitles(db: Db, nowIso: string, retryAfterDays: number): PendingTitle[] {
  const cutoff = new Date(Date.parse(nowIso) - retryAfterDays * DAY_MS).toISOString()
  const rows = db
    .prepare(
      `SELECT t.id, t.kind, t.name, t.year FROM titles t
       WHERE t.tmdb_id IS NULL AND t.match_source IS NULL
         AND (t.tmdb_checked_at IS NULL OR t.tmdb_checked_at < ?)
         AND ${HAS_FILE}
       ORDER BY t.id`
    )
    .all(cutoff) as { id: number; kind: 'series' | 'movie'; name: string; year: number | null }[]
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, ...(r.year === null ? {} : { year: r.year }) }))
}

/** Títulos ainda não verificados (nunca consultados) e sem vínculo. */
export function countPending(db: Db): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM titles t
       WHERE t.tmdb_id IS NULL AND t.match_source IS NULL AND t.tmdb_checked_at IS NULL AND ${HAS_FILE}`
    )
    .get() as { n: number }
  return r.n
}

export interface TitleMatch {
  tmdbId: number
  name: string
  year?: number
  overview?: string
  posterFile?: string
  backdropFile?: string
  source: 'auto' | 'manual'
}

export function applyTitleMatch(db: Db, titleId: number, m: TitleMatch): void {
  tx(db, () => {
    const cur = db.prepare('SELECT tmdb_id, match_source FROM titles WHERE id = ?').get(titleId) as
      | { tmdb_id: number | null; match_source: string | null }
      | undefined
    if (!cur) return
    // Review Focus 3: o automático nunca mexe num vínculo manual.
    if (m.source === 'auto' && cur.match_source === 'manual') return
    const changed = cur.tmdb_id !== m.tmdbId
    const matchedAt = new Date().toISOString()
    if (changed) {
      // Outro vínculo: imagens, sinopse e episódios do anterior não valem mais.
      db.prepare(
        `UPDATE titles SET tmdb_id = ?, name = ?, year = ?, overview = ?, poster_cache = ?, backdrop_cache = ?,
           match_source = ?, matched_at = ?, tmdb_checked_at = NULL WHERE id = ?`
      ).run(m.tmdbId, m.name, m.year ?? null, m.overview ?? null, m.posterFile ?? null, m.backdropFile ?? null, m.source, matchedAt, titleId)
      db.prepare('UPDATE items SET tmdb_name = NULL, overview = NULL WHERE title_id = ?').run(titleId)
    } else {
      db.prepare(
        `UPDATE titles SET name = ?, year = COALESCE(?, year), overview = COALESCE(?, overview),
           poster_cache = COALESCE(?, poster_cache), backdrop_cache = COALESCE(?, backdrop_cache),
           match_source = ?, matched_at = ?, tmdb_checked_at = NULL WHERE id = ?`
      ).run(m.name, m.year ?? null, m.overview ?? null, m.posterFile ?? null, m.backdropFile ?? null, m.source, matchedAt, titleId)
    }
  })
}

export function markChecked(db: Db, titleId: number, nowIso: string): void {
  db.prepare('UPDATE titles SET tmdb_checked_at = ? WHERE id = ?').run(nowIso, titleId)
}

export function listSeasonsNeedingEpisodes(db: Db, titleId: number): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT season FROM items WHERE title_id = ? AND season IS NOT NULL AND tmdb_name IS NULL ORDER BY season`
    )
    .all(titleId) as { season: number }[]
  return rows.map((r) => r.season)
}

export function applyEpisodes(
  db: Db,
  titleId: number,
  season: number,
  eps: { episode: number; name?: string; overview?: string }[]
): void {
  const upd = db.prepare(
    `UPDATE items SET tmdb_name = COALESCE(?, tmdb_name), overview = COALESCE(?, overview)
     WHERE title_id = ? AND season = ? AND episode = ?`
  )
  tx(db, () => {
    for (const e of eps) upd.run(e.name ?? null, e.overview ?? null, titleId, season, e.episode)
  })
}

export function getTitleForAssign(
  db: Db,
  id: number
): { kind: 'series' | 'movie'; tmdbId?: number; matchSource?: 'auto' | 'manual' } | undefined {
  const r = db.prepare('SELECT kind, tmdb_id, match_source FROM titles WHERE id = ?').get(id) as
    | { kind: 'series' | 'movie'; tmdb_id: number | null; match_source: 'auto' | 'manual' | null }
    | undefined
  if (!r) return undefined
  return {
    kind: r.kind,
    ...(r.tmdb_id === null ? {} : { tmdbId: r.tmdb_id }),
    ...(r.match_source === null ? {} : { matchSource: r.match_source })
  }
}

/** Títulos vinculados que ainda não têm pôster ou fundo em cache (a baixa falhou antes). */
export function listMissingImages(db: Db): { id: number; kind: 'series' | 'movie'; tmdbId: number }[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.kind, t.tmdb_id FROM titles t
       WHERE t.tmdb_id IS NOT NULL AND (t.poster_cache IS NULL OR t.backdrop_cache IS NULL) AND ${HAS_FILE}
       ORDER BY t.id`
    )
    .all() as { id: number; kind: 'series' | 'movie'; tmdb_id: number }[]
  return rows.map((r) => ({ id: r.id, kind: r.kind, tmdbId: r.tmdb_id }))
}

/** Preenche só o que falta; não altera vínculo nem origem. */
export function applyTitleImages(
  db: Db,
  titleId: number,
  img: { overview?: string; posterFile?: string; backdropFile?: string }
): void {
  db.prepare(
    `UPDATE titles SET overview = COALESCE(overview, ?), poster_cache = COALESCE(poster_cache, ?),
       backdrop_cache = COALESCE(backdrop_cache, ?) WHERE id = ?`
  ).run(img.overview ?? null, img.posterFile ?? null, img.backdropFile ?? null, titleId)
}

/** Séries vinculadas com arquivo disponível (para completar nomes de episódios novos). */
export function listLinkedSeries(db: Db): { id: number; tmdbId: number }[] {
  const rows = db
    .prepare(`SELECT t.id, t.tmdb_id FROM titles t WHERE t.kind = 'series' AND t.tmdb_id IS NOT NULL AND ${HAS_FILE} ORDER BY t.id`)
    .all() as { id: number; tmdb_id: number }[]
  return rows.map((r) => ({ id: r.id, tmdbId: r.tmdb_id }))
}
