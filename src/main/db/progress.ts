import { randomUUID } from 'node:crypto'
import type { ContinueCard, ProgressView } from '../../shared/types'
import { nextAvailable, type OrderedItem } from '../../shared/rules'
import type { Db } from './database'

const nowIso = () => new Date().toISOString()

export interface SaveProgressInput {
  itemKey: string
  positionS: number
  durationS?: number
  watched: boolean
  /** só para testes e para a mescla do backup (M4); o padrão é agora */
  updatedAt?: string
}

export function getDeviceId(db: Db): string {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'device_id'`).get() as unknown as { value: string } | undefined
  if (row) return row.value
  const id = randomUUID()
  db.prepare(`INSERT INTO settings (key, value) VALUES ('device_id', ?)`).run(id)
  return id
}

export function saveProgress(db: Db, p: SaveProgressInput): void {
  db.prepare(
    `INSERT INTO progress (item_key, position_s, duration_s, watched, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_key) DO UPDATE SET position_s = excluded.position_s,
       duration_s = COALESCE(excluded.duration_s, progress.duration_s), watched = excluded.watched,
       updated_at = excluded.updated_at, device_id = excluded.device_id`
  ).run(p.itemKey, p.positionS, p.durationS ?? null, p.watched ? 1 : 0, p.updatedAt ?? nowIso(), getDeviceId(db))
}

export function getProgress(db: Db, itemKey: string): ProgressView | undefined {
  const r = db.prepare('SELECT position_s, duration_s, watched, updated_at FROM progress WHERE item_key = ?').get(itemKey) as unknown as
    | { position_s: number; duration_s: number | null; watched: number; updated_at: string }
    | undefined
  if (!r) return undefined
  return {
    positionS: r.position_s,
    ...(r.duration_s !== null ? { durationS: r.duration_s } : {}),
    watched: r.watched === 1,
    updatedAt: r.updated_at
  }
}

/** subLang 'off' = legenda desligada. */
export type Prefs = { audioLang?: string; subLang?: string }

export function getPrefs(db: Db, titleId: number): Prefs {
  const r = db.prepare('SELECT audio_lang, sub_lang FROM prefs WHERE title_id = ?').get(titleId) as unknown as
    | { audio_lang: string | null; sub_lang: string | null }
    | undefined
  const out: Prefs = {}
  if (r?.audio_lang) out.audioLang = r.audio_lang
  if (r?.sub_lang) out.subLang = r.sub_lang
  return out
}

/** Campo ausente mantém o valor que já estava gravado. */
export function setPrefs(db: Db, titleId: number, p: Prefs): void {
  db.prepare(
    `INSERT INTO prefs (title_id, audio_lang, sub_lang) VALUES (?, ?, ?)
     ON CONFLICT(title_id) DO UPDATE SET audio_lang = COALESCE(excluded.audio_lang, prefs.audio_lang),
       sub_lang = COALESCE(excluded.sub_lang, prefs.sub_lang)`
  ).run(titleId, p.audioLang ?? null, p.subLang ?? null)
}

interface ProgressRow {
  title_id: number
  kind: 'series' | 'movie'
  title_name: string
  item_key: string
  season: number | null
  episode: number | null
  item_name: string | null
  position_s: number
  duration_s: number | null
  watched: number
  file_duration: number | null
}

interface TitleItemRow {
  key: string
  season: number | null
  episode: number | null
  name: string | null
  available: number
}

export function listContinueWatching(db: Db): ContinueCard[] {
  const rows = db.prepare(
    `SELECT t.id AS title_id, t.kind, t.name AS title_name, i.key AS item_key, i.season, i.episode, i.name AS item_name,
            p.position_s, p.duration_s, p.watched,
            (SELECT MAX(f.duration_s) FROM files f WHERE f.item_key = i.key AND f.missing = 0) AS file_duration
     FROM progress p
     JOIN items i ON i.key = p.item_key
     JOIN titles t ON t.id = i.title_id
     WHERE EXISTS (SELECT 1 FROM files f WHERE f.item_key = i.key AND f.missing = 0)
     ORDER BY p.updated_at DESC, p.rowid DESC`
  ).all() as unknown as ProgressRow[]
  const itemsStmt = db.prepare(
    `SELECT i.key, i.season, i.episode, i.name,
            EXISTS (SELECT 1 FROM files f JOIN libraries l ON l.id = f.library_id
                    WHERE f.item_key = i.key AND f.missing = 0 AND l.status = 'online') AS available
     FROM items i
     WHERE i.title_id = ? AND EXISTS (SELECT 1 FROM files f WHERE f.item_key = i.key AND f.missing = 0)`
  )
  const seen = new Set<number>()
  const cards: ContinueCard[] = []
  for (const r of rows) {
    if (seen.has(r.title_id)) continue
    seen.add(r.title_id)
    const items = (itemsStmt.all(r.title_id) as unknown as TitleItemRow[]).map((x) => ({
      key: x.key,
      season: x.season,
      episode: x.episode,
      name: x.name,
      available: x.available === 1
    }))
    const base = { titleId: r.title_id, titleName: r.title_name, kind: r.kind }
    if (r.watched !== 1) {
      const duration = r.duration_s ?? r.file_duration ?? undefined
      cards.push({
        ...base,
        itemKey: r.item_key,
        season: r.season,
        episode: r.episode,
        ...(r.item_name ? { episodeName: r.item_name } : {}),
        positionS: r.position_s,
        ...(duration !== undefined ? { durationS: duration } : {}),
        available: items.find((x) => x.key === r.item_key)?.available ?? false
      })
      continue
    }
    if (r.kind !== 'series') continue
    const next = nextAvailable<OrderedItem & { name: string | null }>(items, r.item_key)
    if (!next) continue
    cards.push({
      ...base,
      itemKey: next.key,
      season: next.season,
      episode: next.episode,
      ...(next.name ? { episodeName: next.name } : {}),
      positionS: 0,
      available: true
    })
  }
  return cards
}
