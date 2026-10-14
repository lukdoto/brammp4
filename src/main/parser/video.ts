import type { ParsedVideo } from '../../shared/types'

export const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.webm'])

const IGNORED_DIR = /^(extras?|featurettes?|samples?|behind the scenes|bonus|trailers?)$/i
const SYSTEM_DIR = /^(\$RECYCLE\.BIN|System Volume Information)$/i
const SAMPLE_FILE = /(^|[ ._-])sample([ ._-]|$)/i
const SEASON_DIR = /^(?:season|temporada|s)[ ._-]*0*(\d{1,2})$/i
export const SXE = /(?<![a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})((?:[ ._-]?e\d{1,3})*)/i
const NXN = /(?<![a-z0-9])(\d{1,2})x(\d{2,3})(?![a-z0-9])/i
const LEADING_EP = /^(?:e|ep|episode|epis[oó]dio|cap[ií]tulo)?[ ._-]*0*(\d{1,3})(?![0-9])/i
const QUALITY =
  /(?<![a-z0-9])(2160p|1080p|720p|576p|480p|4k|uhd|x ?26[45]|h ?26[45]|hevc|avc|web ?dl|webrip|blu ?ray|brrip|bdrip|hdtv|dvdrip|hdrip|remux|dual|dublado|legendado|nacional|proper|repack|10bit|hdr)(?![a-z0-9])/i
const YEAR = /(?:^|[ ([-])((?:19|20)\d{2})(?=$|[ )\]-])/g

export function extOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i).toLowerCase()
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? name : name.slice(0, i)
}

export function splitPath(relPath: string): string[] {
  return relPath.split(/[\\/]/).filter(Boolean)
}

export function isIgnored(relPath: string): boolean {
  const parts = splitPath(relPath)
  if (parts.some((p) => p.startsWith('.') || SYSTEM_DIR.test(p))) return true
  if (parts.slice(0, -1).some((d) => IGNORED_DIR.test(d))) return true
  const last = parts[parts.length - 1] ?? ''
  if (IGNORED_DIR.test(last) && extOf(last) === '') return true
  return SAMPLE_FILE.test(stripExt(last))
}

export function cleanName(raw: string): { name: string; year?: number } {
  let s = raw.replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  const q = s.search(QUALITY)
  if (q > 0) s = s.slice(0, q)
  const maxYear = new Date().getFullYear() + 1
  let year: number | undefined
  let cut = -1
  for (const m of s.matchAll(YEAR)) {
    const idx = (m.index ?? 0) + m[0].indexOf(m[1]!)
    const y = Number(m[1])
    if (idx > 0 && y <= maxYear) {
      year = y
      cut = idx
    }
  }
  if (cut > 0) s = s.slice(0, cut)
  s = s.replace(/[\s([{-]+$/, '').replace(/^[\s-]+/, '').trim()
  return year === undefined ? { name: s } : { name: s, year }
}

function nearestSeriesDir(dirs: string[]): string | undefined {
  for (let i = dirs.length - 1; i >= 0; i--) if (!SEASON_DIR.test(dirs[i]!)) return dirs[i]
  return undefined
}

function episode(name: { name: string; year?: number }, season: number, episodes: number[]): ParsedVideo | null {
  if (!name.name) return null
  const p: ParsedVideo = { kind: 'episode', seriesName: name.name, season, episodes }
  if (name.year !== undefined) p.year = name.year
  return p
}

export function parseVideoPath(relPath: string): ParsedVideo | null {
  const parts = splitPath(relPath)
  const file = stripExt(parts[parts.length - 1] ?? '')
  const dirs = parts.slice(0, -1)
  const inSeasonDir = dirs.length > 0 && SEASON_DIR.test(dirs[dirs.length - 1]!)

  // Regra de nome da série: dentro de pasta de temporada, usa a pasta acima dela;
  // fora, usa o texto antes do código do episódio ou, se vazio, a pasta mais próxima.
  const seriesName = (prefix: string) => {
    if (inSeasonDir) {
      const dir = nearestSeriesDir(dirs)
      if (dir) return cleanName(dir)
    }
    const fromPrefix = cleanName(prefix)
    if (fromPrefix.name) return fromPrefix
    const dir = nearestSeriesDir(dirs)
    return dir ? cleanName(dir) : { name: '' }
  }

  const sxe = file.match(SXE)
  if (sxe) {
    const eps = [Number(sxe[2]), ...[...(sxe[3] ?? '').matchAll(/e(\d{1,3})/gi)].map((m) => Number(m[1]))]
    return episode(seriesName(file.slice(0, sxe.index)), Number(sxe[1]), eps)
  }

  const nxn = file.match(NXN)
  if (nxn) return episode(seriesName(file.slice(0, nxn.index)), Number(nxn[1]), [Number(nxn[2])])

  if (inSeasonDir) {
    const season = Number(dirs[dirs.length - 1]!.match(SEASON_DIR)![1])
    const ep = file.match(LEADING_EP)
    if (!ep) return null
    return episode(seriesName(''), season, [Number(ep[1])])
  }

  let named = cleanName(file)
  if (!named.name) named = cleanName(dirs[dirs.length - 1] ?? '')
  if (!named.name) return null
  const year = named.year ?? (dirs.length ? cleanName(dirs[dirs.length - 1]!).year : undefined)
  return year === undefined ? { kind: 'movie', title: named.name } : { kind: 'movie', title: named.name, year }
}
