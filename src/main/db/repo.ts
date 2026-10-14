import type { Catalog, FileView, ItemView, LibraryStatus, LibraryView, ProbeResult, ProbeTrack, TitleCard, TitleDetail } from '../../shared/types'
import type { Db } from './database'

const now = () => new Date().toISOString()
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v)

export function upsertLibrary(db: Db, lib: { id: string; label: string; rootPath: string }): void {
  db.prepare(
    `INSERT INTO libraries (id, label, root_path, status, last_seen_at) VALUES (?, ?, ?, 'online', ?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, root_path = excluded.root_path,
       status = 'online', last_seen_at = excluded.last_seen_at`
  ).run(lib.id, lib.label, lib.rootPath, now())
}

export function setLibraryStatus(db: Db, id: string, status: LibraryStatus, rootPath?: string): void {
  if (rootPath) db.prepare('UPDATE libraries SET root_path = ? WHERE id = ?').run(rootPath, id)
  if (status === 'online') db.prepare(`UPDATE libraries SET status = 'online', last_seen_at = ? WHERE id = ?`).run(now(), id)
  else db.prepare(`UPDATE libraries SET status = 'offline' WHERE id = ?`).run(id)
}

export function setAllLibrariesOffline(db: Db): void {
  db.exec(`UPDATE libraries SET status = 'offline'`)
}

export function listLibraries(db: Db): LibraryView[] {
  const rows = db.prepare('SELECT id, label, root_path, status, last_scan_at FROM libraries ORDER BY label').all() as {
    id: string; label: string; root_path: string; status: LibraryStatus; last_scan_at: string | null
  }[]
  return rows.map((r) => ({ id: r.id, label: r.label, rootPath: r.root_path, status: r.status, lastScanAt: opt(r.last_scan_at) }))
}

export function setLastScan(db: Db, id: string): void {
  db.prepare('UPDATE libraries SET last_scan_at = ? WHERE id = ?').run(now(), id)
}

export function upsertTitle(db: Db, t: { kind: 'series' | 'movie'; localKey: string; name: string; year?: number }): number {
  db.prepare('INSERT INTO titles (kind, local_key, name, year) VALUES (?, ?, ?, ?) ON CONFLICT(local_key) DO NOTHING').run(
    t.kind, t.localKey, t.name, t.year ?? null
  )
  return (db.prepare('SELECT id FROM titles WHERE local_key = ?').get(t.localKey) as { id: number }).id
}

export function upsertItem(db: Db, i: { key: string; titleId: number; season: number | null; episode: number | null }): void {
  db.prepare('INSERT INTO items (key, title_id, season, episode) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING').run(
    i.key, i.titleId, i.season, i.episode
  )
}

export interface FileRow { id: number; itemKey: string; relPath: string; size: number; mtimeMs: number; probedAt: string | null }

export function listLibraryFiles(db: Db, libraryId: string): FileRow[] {
  const rows = db.prepare('SELECT id, item_key, rel_path, size, mtime_ms, probed_at FROM files WHERE library_id = ?').all(libraryId) as {
    id: number; item_key: string; rel_path: string; size: number; mtime_ms: number; probed_at: string | null
  }[]
  return rows.map((r) => ({ id: r.id, itemKey: r.item_key, relPath: r.rel_path, size: r.size, mtimeMs: r.mtime_ms, probedAt: r.probed_at }))
}

export function upsertFile(
  db: Db,
  f: { itemKey: string; libraryId: string; relPath: string; size: number; mtimeMs: number; probe?: ProbeResult | null }
): number {
  db.prepare(
    `INSERT INTO files (item_key, library_id, rel_path, size, mtime_ms) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(library_id, rel_path, item_key) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, missing = 0`
  ).run(f.itemKey, f.libraryId, f.relPath, f.size, f.mtimeMs)
  const { id } = db.prepare('SELECT id FROM files WHERE library_id = ? AND rel_path = ? AND item_key = ?').get(
    f.libraryId, f.relPath, f.itemKey
  ) as { id: number }
  if (f.probe !== undefined) {
    const p = f.probe
    db.prepare('UPDATE files SET duration_s = ?, width = ?, height = ?, video_codec = ?, probed_at = ? WHERE id = ?').run(
      p?.durationS ?? null, p?.width ?? null, p?.height ?? null, p?.videoCodec ?? null, now(), id
    )
  }
  return id
}

export function replaceEmbeddedTracks(db: Db, fileId: number, tracks: ProbeTrack[]): void {
  db.prepare(`DELETE FROM tracks WHERE file_id = ? AND source = 'embedded'`).run(fileId)
  const ins = db.prepare(
    `INSERT INTO tracks (file_id, source, type, stream_index, type_index, codec, lang, title, is_default, is_forced)
     VALUES (?, 'embedded', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const t of tracks) {
    ins.run(fileId, t.type, t.streamIndex, t.typeIndex, t.codec, t.lang ?? null, t.title ?? null, t.isDefault ? 1 : 0, t.isForced ? 1 : 0)
  }
}

export interface ExternalSub { relPath: string; lang?: string; forced: boolean; sdh: boolean; codec: string }

export function replaceExternalSubs(db: Db, fileId: number, subs: ExternalSub[]): void {
  db.prepare(`DELETE FROM tracks WHERE file_id = ? AND source = 'external'`).run(fileId)
  const ins = db.prepare(
    `INSERT INTO tracks (file_id, source, type, codec, lang, is_forced, is_sdh, external_path) VALUES (?, 'external', 'sub', ?, ?, ?, ?, ?)`
  )
  for (const s of subs) ins.run(fileId, s.codec, s.lang ?? null, s.forced ? 1 : 0, s.sdh ? 1 : 0, s.relPath)
}

export function markMissing(db: Db, libraryId: string, seenFileIds: Set<number>): void {
  db.prepare('UPDATE files SET missing = 1 WHERE library_id = ?').run(libraryId)
  const back = db.prepare('UPDATE files SET missing = 0 WHERE id = ?')
  for (const id of seenFileIds) back.run(id)
}

export function replaceUnmatched(db: Db, libraryId: string, entries: { relPath: string; reason: string }[]): void {
  db.prepare('DELETE FROM unmatched WHERE library_id = ?').run(libraryId)
  const ins = db.prepare('INSERT OR REPLACE INTO unmatched (library_id, rel_path, reason) VALUES (?, ?, ?)')
  for (const e of entries) ins.run(libraryId, e.relPath, e.reason)
}

export function librarySummary(db: Db, libraryId: string) {
  const count = (sql: string) => (db.prepare(sql).get(libraryId) as { n: number }).n
  const base = `FROM titles t JOIN items i ON i.title_id = t.id JOIN files f ON f.item_key = i.key WHERE f.library_id = ? AND f.missing = 0`
  return {
    series: count(`SELECT COUNT(DISTINCT t.id) AS n ${base} AND t.kind = 'series'`),
    movies: count(`SELECT COUNT(DISTINCT t.id) AS n ${base} AND t.kind = 'movie'`),
    episodes: count(`SELECT COUNT(DISTINCT i.key) AS n ${base} AND t.kind = 'series'`),
    subtitles: count(
      `SELECT COUNT(DISTINCT tr.external_path) AS n FROM tracks tr JOIN files f ON f.id = tr.file_id
       WHERE f.library_id = ? AND f.missing = 0 AND tr.source = 'external'`
    ),
    unmatched: count('SELECT COUNT(*) AS n FROM unmatched WHERE library_id = ?')
  }
}

interface CatalogRow { id: number; kind: 'series' | 'movie'; name: string; year: number | null; label: string; status: LibraryStatus; missing: number }

export function getCatalog(db: Db): Catalog {
  const rows = db.prepare(
    `SELECT t.id, t.kind, t.name, t.year, l.label, l.status, f.missing
     FROM titles t JOIN items i ON i.title_id = t.id JOIN files f ON f.item_key = i.key JOIN libraries l ON l.id = f.library_id`
  ).all() as unknown as CatalogRow[]
  const cards = new Map<number, TitleCard & { visible: boolean }>()
  for (const r of rows) {
    const c = cards.get(r.id) ?? { id: r.id, kind: r.kind, name: r.name, year: opt(r.year), available: false, offlineLabels: [], visible: false }
    if (r.status === 'online' && r.missing === 0) c.available = true
    if (r.status === 'offline' && !c.offlineLabels.includes(r.label)) c.offlineLabels.push(r.label)
    if (r.status === 'offline' || r.missing === 0) c.visible = true
    cards.set(r.id, c)
  }
  const list = [...cards.values()]
    .filter((c) => c.visible)
    .map(({ visible: _v, ...c }) => c)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return { series: list.filter((c) => c.kind === 'series'), movies: list.filter((c) => c.kind === 'movie') }
}

export function getTitleDetail(db: Db, id: number): TitleDetail | null {
  const t = db.prepare('SELECT id, kind, name, year FROM titles WHERE id = ?').get(id) as unknown as
    | { id: number; kind: 'series' | 'movie'; name: string; year: number | null }
    | undefined
  if (!t) return null
  const items = db.prepare('SELECT key, season, episode FROM items WHERE title_id = ? ORDER BY season, episode').all(id) as {
    key: string; season: number | null; episode: number | null
  }[]
  const files = db.prepare(
    `SELECT f.id, f.item_key, f.rel_path, f.height, f.video_codec, f.missing, l.label, l.status,
       (SELECT COUNT(*) FROM tracks tr WHERE tr.file_id = f.id AND tr.type = 'audio') AS audio_count,
       (SELECT COUNT(*) FROM tracks tr WHERE tr.file_id = f.id AND tr.type = 'sub') AS sub_count
     FROM files f JOIN libraries l ON l.id = f.library_id JOIN items i ON i.key = f.item_key
     WHERE i.title_id = ? AND (f.missing = 0 OR l.status = 'offline')
     ORDER BY f.height DESC`
  ).all(id) as {
    id: number; item_key: string; rel_path: string; height: number | null; video_codec: string | null; missing: number
    label: string; status: LibraryStatus; audio_count: number; sub_count: number
  }[]
  const byItem = new Map<string, FileView[]>()
  for (const f of files) {
    const view: FileView = {
      id: f.id, relPath: f.rel_path, libraryLabel: f.label, available: f.status === 'online' && f.missing === 0,
      height: opt(f.height), videoCodec: opt(f.video_codec), audioCount: f.audio_count, subCount: f.sub_count
    }
    byItem.set(f.item_key, [...(byItem.get(f.item_key) ?? []), view])
  }
  const itemViews: ItemView[] = items
    .filter((i) => byItem.has(i.key))
    .map((i) => ({ key: i.key, season: i.season, episode: i.episode, files: byItem.get(i.key)! }))
  return { id: t.id, kind: t.kind, name: t.name, year: opt(t.year), items: itemViews }
}
