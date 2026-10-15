import type { ParsedVideo } from '../../shared/types'

export const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.webm'])

const IGNORED_DIR = /^(extras?|featurettes?|samples?|behind the scenes|bonus|trailers?)$/i
const SYSTEM_DIR = /^(\$RECYCLE\.BIN|System Volume Information)$/i
const SAMPLE_FILE = /(^|[ ._-])sample([ ._-]|$)/i
const SEASON_DIR = /^(?:season|temporada|s)[ ._-]*0*(\d{1,2})$/i
export const SXE = /(?<![a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})((?:[ ._-]?e\d{1,3})*)/i
const NXN = /(?<![a-z0-9])(\d{1,2})x(\d{1,3})(?![a-z0-9])/i
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
  const end = q > 0 ? q : s.length
  const maxYear = new Date().getFullYear() + 1
  let year: number | undefined
  let cut = end
  let after: number | undefined
  for (const m of s.matchAll(YEAR)) {
    const idx = (m.index ?? 0) + m[0].indexOf(m[1]!)
    const y = Number(m[1])
    if (idx <= 0 || y > maxYear) continue
    if (idx < end) {
      year = y
      cut = idx
    } else after = y
  }
  // ano depois do token de qualidade (Movie.Dual.Audio.2015) só vale se não houver ano antes dele
  if (year === undefined) year = after
  s = s.slice(0, cut)
  s = s.replace(/[\s([{-]+$/, '').replace(/^[\s-]+/, '').trim()
  return year === undefined ? { name: s } : { name: s, year }
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Pastas que só agrupam títulos; nunca são o nome da série. */
const CONTAINER_DIRS = new Set([
  'series', 'serie', 'filmes', 'filme', 'movies', 'movie', 'films', 'anime', 'animes',
  'desenhos', 'cartoons', 'tv', 'shows', 'documentarios', 'novelas'
])
const isContainer = (dir: string) => CONTAINER_DIRS.has(plain(dir))

// Formas soltas de temporada: só valem para pastas ABAIXO da pasta do título.
const LOOSE_LEADING = /^(\d{1,2})[ ._)-]+(?=\p{L})/u
const LOOSE_WORD = /^(?:livro|book|parte|part|volume|vol|temp)[ ._-]*(\d{1,2}|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)(?![\p{L}\p{N}])/u
const NUMBER_WORDS: Record<string, number> = { um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 }

function seasonOfDir(dir: string, loose: boolean): number | undefined {
  const strict = dir.match(SEASON_DIR)
  if (strict) return Number(strict[1])
  if (!loose) return undefined
  const lead = dir.match(LOOSE_LEADING)
  if (lead) return Number(lead[1])
  const word = plain(dir).match(LOOSE_WORD)
  if (word) return NUMBER_WORDS[word[1]!] ?? Number(word[1])
  return undefined
}

/** Índice da pasta do título: a primeira que não é contêiner, desde que não seja uma pasta de temporada estrita. */
function titleDirIndex(dirs: string[]): number | undefined {
  const i = dirs.findIndex((d) => !isContainer(d))
  if (i < 0 || SEASON_DIR.test(dirs[i]!)) return undefined
  return i
}

/** Nome da pasta do título; tira um "S01"/"Season 1" final de pasta de release (Dark.S01.1080p). */
function cleanTitleDir(dir: string): { name: string; year?: number } {
  const c = cleanName(dir)
  const name = c.name.replace(/\s+(?:s\d{1,2}|season \d{1,2}|temporada \d{1,2})$/i, '').trim()
  return c.year === undefined ? { name } : { name, year: c.year }
}

const WORD_EP = /(?<![a-z0-9])(?:epis[oó]dio|episode|cap[ií]tulo|ep|cap)[ ._-]*0*(\d{1,3})(?![0-9])/i

/** Forma de anime "Nome - NN": sem [grupos], pontos e sublinhados viram espaço, número no fim do nome. */
function animeForm(file: string): { name: string; episode: number; season?: number } | null {
  const s = file.replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  const m = s.match(/^(.+?)\s+-\s+(\d{2,3})(?:v\d+)?$/)
  if (!m) return null
  let name = m[1]!.replace(/^[\s-]+/, '').trim()
  if (!name) return null
  const out: { name: string; episode: number; season?: number } = { name, episode: Number(m[2]) }
  const trailing = name.match(/^(.*\S)\s+([2-9])$/)
  if (trailing) {
    name = trailing[1]!
    out.name = name
    out.season = Number(trailing[2])
  }
  return out
}

function episode(name: { name: string; year?: number }, season: number, episodes: number[], episodeTitle?: string): ParsedVideo | null {
  if (!name.name) return null
  const p: ParsedVideo = { kind: 'episode', seriesName: name.name, season, episodes }
  if (name.year !== undefined) p.year = name.year
  if (episodeTitle) p.episodeTitle = episodeTitle
  return p
}

export function parseVideoPath(relPath: string): ParsedVideo | null {
  const parts = splitPath(relPath)
  const file = stripExt(parts[parts.length - 1] ?? '')
  const dirs = parts.slice(0, -1)
  const titleIdx = titleDirIndex(dirs)
  const inSeasonDir = dirs.length > 0 && SEASON_DIR.test(dirs[dirs.length - 1]!)

  // Temporada pelas pastas: a mais próxima do arquivo, abaixo da pasta do título.
  let folderSeason: number | undefined
  for (let i = dirs.length - 1; i >= (titleIdx === undefined ? 0 : titleIdx + 1); i--) {
    folderSeason = seasonOfDir(dirs[i]!, titleIdx !== undefined)
    if (folderSeason !== undefined) break
  }
  // Sem informação de temporada, vale 1 desde que haja pasta de título.
  const impliedSeason = folderSeason ?? (titleIdx !== undefined ? 1 : undefined)

  // Nome da série: a pasta do título; sem ela, o texto antes do código do episódio.
  const seriesName = (prefix: string): { name: string; year?: number } => {
    const fromPrefix = cleanName(prefix)
    if (titleIdx === undefined) return fromPrefix
    const dir = cleanTitleDir(dirs[titleIdx]!)
    if (dir.name && dir.year === undefined && fromPrefix.year !== undefined) dir.year = fromPrefix.year
    return dir
  }

  const sxe = file.match(SXE)
  if (sxe) {
    const eps = [Number(sxe[2]), ...[...(sxe[3] ?? '').matchAll(/e(\d{1,3})/gi)].map((m) => Number(m[1]))]
    return episode(seriesName(file.slice(0, sxe.index)), Number(sxe[1]), eps)
  }

  const nxn = file.match(NXN)
  if (nxn) return episode(seriesName(file.slice(0, nxn.index)), Number(nxn[1]), [Number(nxn[2])])

  const word = file.match(WORD_EP)
  if (word && impliedSeason !== undefined) {
    const rest = file.slice(word.index! + word[0].length)
    const title = rest.match(/^\s*[-–]\s*(\S.*)$/)?.[1]?.trim()
    return episode(seriesName(file.slice(0, word.index)), impliedSeason, [Number(word[1])], title)
  }

  const anime = animeForm(file)
  if (anime) {
    const season = anime.season ?? impliedSeason
    if (season !== undefined) return episode(seriesName(anime.name), season, [anime.episode])
  }

  if (inSeasonDir) {
    const ep = file.match(LEADING_EP)
    if (!ep) return null
    return episode(seriesName(''), folderSeason!, [Number(ep[1])])
  }

  let named = cleanName(file)
  if (!named.name) named = cleanName(dirs[dirs.length - 1] ?? '')
  if (!named.name) return null
  const year = named.year ?? (dirs.length ? cleanName(dirs[dirs.length - 1]!).year : undefined)
  return year === undefined ? { kind: 'movie', title: named.name } : { kind: 'movie', title: named.name, year }
}
