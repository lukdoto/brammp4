import type { ParsedVideo, ReclassifyTarget } from '../../shared/types'
import { slugify } from '../parser/keys'
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

/** true se gravou; false se o título sumiu ou o automático foi barrado por um vínculo manual. */
export function applyTitleMatch(db: Db, titleId: number, m: TitleMatch): boolean {
  return tx(db, () => {
    const cur = db.prepare('SELECT tmdb_id, match_source FROM titles WHERE id = ?').get(titleId) as
      | { tmdb_id: number | null; match_source: string | null }
      | undefined
    if (!cur) return false
    // Review Focus 3: o automático nunca mexe num vínculo manual.
    if (m.source === 'auto' && cur.match_source === 'manual') return false
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
    return true
  })
}

export function markChecked(db: Db, titleId: number, nowIso: string): void {
  db.prepare('UPDATE titles SET tmdb_checked_at = ? WHERE id = ? AND tmdb_id IS NULL').run(nowIso, titleId)
}

export function listSeasonsNeedingEpisodes(db: Db, titleId: number): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT season FROM items WHERE title_id = ? AND season IS NOT NULL AND tmdb_name IS NULL ORDER BY season`
    )
    .all(titleId) as { season: number }[]
  return rows.map((r) => r.season)
}

/**
 * Só grava se o título ainda estiver vinculado a `expectedTmdbId` (o vínculo pode ter mudado
 * durante a consulta ao TMDB). Devolve false quando descartou os episódios.
 */
export function applyEpisodes(
  db: Db,
  titleId: number,
  season: number,
  eps: { episode: number; name?: string; overview?: string }[],
  expectedTmdbId: number
): boolean {
  const upd = db.prepare(
    `UPDATE items SET tmdb_name = COALESCE(?, tmdb_name), overview = COALESCE(?, overview)
     WHERE title_id = ? AND season = ? AND episode = ?`
  )
  return tx(db, () => {
    const t = db.prepare('SELECT tmdb_id FROM titles WHERE id = ?').get(titleId) as { tmdb_id: number | null } | undefined
    if (!t || t.tmdb_id !== expectedTmdbId) return false
    for (const e of eps) upd.run(e.name ?? null, e.overview ?? null, titleId, season, e.episode)
    return true
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

/**
 * Esquece pôster/fundo cujo arquivo sumiu do cache (apagado à mão, pasta limpa): assim
 * `listMissingImages` volta a incluir o título e a imagem é baixada de novo. Devolve os ids que mudaram.
 */
export function clearMissingImageFiles(db: Db, exists: (file: string) => boolean): number[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.poster_cache, t.backdrop_cache FROM titles t
       WHERE t.tmdb_id IS NOT NULL AND (t.poster_cache IS NOT NULL OR t.backdrop_cache IS NOT NULL) AND ${HAS_FILE}`
    )
    .all() as { id: number; poster_cache: string | null; backdrop_cache: string | null }[]
  const clear = db.prepare(
    `UPDATE titles SET poster_cache = CASE WHEN ? THEN NULL ELSE poster_cache END,
       backdrop_cache = CASE WHEN ? THEN NULL ELSE backdrop_cache END WHERE id = ?`
  )
  const ids: number[] = []
  for (const r of rows) {
    const poster = r.poster_cache !== null && !exists(r.poster_cache)
    const backdrop = r.backdrop_cache !== null && !exists(r.backdrop_cache)
    if (!poster && !backdrop) continue
    clear.run(poster ? 1 : 0, backdrop ? 1 : 0, r.id)
    ids.push(r.id)
  }
  return ids
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

export const UNMATCHED_REASON = 'nome não reconhecido'

/** Vídeos que o parser não classificou (legendas órfãs ficam de fora), em ordem estável. */
export function listUnmatched(db: Db): { libraryId: string; libraryLabel: string; relPath: string; reason: string }[] {
  const rows = db
    .prepare(
      `SELECT u.library_id, l.label, u.rel_path, u.reason FROM unmatched u JOIN libraries l ON l.id = u.library_id
       WHERE u.reason = ? ORDER BY l.label, u.library_id, u.rel_path`
    )
    .all(UNMATCHED_REASON) as { library_id: string; label: string; rel_path: string; reason: string }[]
  return rows.map((r) => ({ libraryId: r.library_id, libraryLabel: r.label, relPath: r.rel_path, reason: r.reason }))
}

/**
 * Episódio atribuído a uma série que já existe (escolhida pelo id): o nome mostrado pode ser o do
 * TMDB, que não reproduz a `local_key` (ela vem do nome original do arquivo). Troca o nome da série
 * pelo slug da `local_key` existente (`slugify` é idempotente), para a varredura cair no mesmo título.
 * Filme, id desconhecido ou que não é série: devolve o alvo como veio.
 */
export function targetForExistingSeries(db: Db, target: ReclassifyTarget, titleId: number | undefined): ReclassifyTarget {
  if (target.kind !== 'episode' || titleId === undefined) return target
  const row = db.prepare(`SELECT local_key FROM titles WHERE id = ? AND kind = 'series'`).get(titleId) as { local_key: string } | undefined
  if (!row || !row.local_key.startsWith('series:')) return target
  const slug = row.local_key.slice('series:'.length)
  if (slug === '' || slugify(target.series) === slug) return target
  return { ...target, series: slug }
}

export function setAssignment(db: Db, libraryId: string, relPath: string, target: ReclassifyTarget): void {
  db.prepare(
    `INSERT INTO assignments (library_id, rel_path, target) VALUES (?, ?, ?)
     ON CONFLICT(library_id, rel_path) DO UPDATE SET target = excluded.target`
  ).run(libraryId, relPath, JSON.stringify(target))
}

function isTarget(v: unknown): v is ReclassifyTarget {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  if (t.kind === 'movie') return typeof t.title === 'string' && t.title.trim() !== '' && (t.year === undefined || Number.isInteger(t.year))
  if (t.kind === 'episode') {
    return typeof t.series === 'string' && t.series.trim() !== '' && Number.isInteger(t.season) && Number.isInteger(t.episode)
  }
  return false
}

/** Linhas corrompidas são ignoradas: uma atribuição ruim não pode travar a varredura. */
export function listAssignments(db: Db, libraryId: string): Map<string, ReclassifyTarget> {
  const rows = db.prepare('SELECT rel_path, target FROM assignments WHERE library_id = ?').all(libraryId) as {
    rel_path: string
    target: string
  }[]
  const out = new Map<string, ReclassifyTarget>()
  for (const r of rows) {
    try {
      const t: unknown = JSON.parse(r.target)
      if (isTarget(t)) out.set(r.rel_path, t)
    } catch {
      /* ignora */
    }
  }
  return out
}

export function reclassifyToParsed(t: ReclassifyTarget): ParsedVideo {
  if (t.kind === 'movie') return { kind: 'movie', title: t.title, ...(t.year === undefined ? {} : { year: t.year }) }
  return { kind: 'episode', seriesName: t.series, season: t.season, episodes: [t.episode] }
}
