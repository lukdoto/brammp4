import type { AudioOption, FileOption, PlayOptions, SubOption } from '../../shared/types'
import { resumeStart } from '../../shared/rules'
import type { Db } from '../db/database'
import { getPrefs, getProgress } from '../db/progress'
import { defaultSelection } from './tracks'

interface FileRow {
  id: number
  height: number | null
  video_codec: string | null
  label: string
  status: 'online' | 'offline'
}

interface TrackRow {
  file_id: number
  source: 'embedded' | 'external'
  type: 'audio' | 'sub'
  type_index: number | null
  codec: string | null
  lang: string | null
  title: string | null
  is_default: number
  is_forced: number
  is_sdh: number
  external_path: string | null
}

function optionsFromTracks(rows: TrackRow[]): { audio: AudioOption[]; subs: SubOption[] } {
  const audio: AudioOption[] = []
  const embedded: SubOption[] = []
  const external: SubOption[] = []
  for (const r of rows) {
    const common = { ...(r.lang ? { lang: r.lang } : {}), ...(r.title ? { title: r.title } : {}), codec: r.codec ?? 'desconhecido' }
    if (r.type === 'audio') audio.push({ typeIndex: r.type_index ?? 0, ...common, isDefault: r.is_default === 1 })
    else if (r.source === 'embedded')
      embedded.push({ source: 'embedded', typeIndex: r.type_index ?? 0, ...common, isDefault: r.is_default === 1, isForced: r.is_forced === 1, isSdh: false })
    else
      external.push({ source: 'external', externalPath: r.external_path ?? '', ...common, isDefault: false, isForced: r.is_forced === 1, isSdh: r.is_sdh === 1 })
  }
  audio.sort((a, b) => a.typeIndex - b.typeIndex)
  embedded.sort((a, b) => (a.typeIndex ?? 0) - (b.typeIndex ?? 0))
  return { audio, subs: [...embedded, ...external] }
}

/** Arquivos (versões) do item que ainda existem, online primeiro e depois a maior resolução. */
export function buildFileOptions(db: Db, itemKey: string, titleId: number): FileOption[] {
  const files = db.prepare(
    `SELECT f.id, f.height, f.video_codec, l.label, l.status
     FROM files f JOIN libraries l ON l.id = f.library_id
     WHERE f.item_key = ? AND f.missing = 0
     ORDER BY (l.status = 'online') DESC, f.height DESC, f.id`
  ).all(itemKey) as unknown as FileRow[]
  if (files.length === 0) return []
  const marks = files.map(() => '?').join(',')
  const tracks = db.prepare(
    `SELECT file_id, source, type, type_index, codec, lang, title, is_default, is_forced, is_sdh, external_path
     FROM tracks WHERE file_id IN (${marks}) ORDER BY id`
  ).all(...files.map((f) => f.id)) as unknown as TrackRow[]
  const prefs = getPrefs(db, titleId)
  return files.map((f) => {
    const { audio, subs } = optionsFromTracks(tracks.filter((t) => t.file_id === f.id))
    return {
      fileId: f.id,
      libraryLabel: f.label,
      ...(f.height !== null ? { height: f.height } : {}),
      ...(f.video_codec !== null ? { videoCodec: f.video_codec } : {}),
      available: f.status === 'online',
      audio,
      subs,
      defaults: defaultSelection(audio, subs, prefs)
    }
  })
}

export function getPlayOptions(db: Db, itemKey: string): PlayOptions | null {
  const item = db.prepare(
    `SELECT i.season, i.episode, i.name, i.title_id, t.name AS title_name, t.kind
     FROM items i JOIN titles t ON t.id = i.title_id WHERE i.key = ?`
  ).get(itemKey) as unknown as
    | { season: number | null; episode: number | null; name: string | null; title_id: number; title_name: string; kind: 'series' | 'movie' }
    | undefined
  if (!item) return null
  const files = buildFileOptions(db, itemKey, item.title_id)
  if (files.length === 0) return null
  const progress = getProgress(db, itemKey)
  return {
    itemKey,
    titleId: item.title_id,
    titleName: item.title_name,
    kind: item.kind,
    season: item.season,
    episode: item.episode,
    ...(item.name ? { episodeName: item.name } : {}),
    files,
    defaultFileId: files.find((f) => f.available)?.fileId ?? null,
    ...(progress ? { progress } : {}),
    resumeFromS: resumeStart(progress?.positionS, progress?.watched ?? false)
  }
}
