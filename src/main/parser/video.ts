import type { ParsedVideo } from '../../shared/types'
import { slugify } from './keys'

export const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.webm'])

const IGNORED_DIR = /^(extras?|featurettes?|samples?|behind the scenes|bonus|trailers?)$/i
const SYSTEM_DIR = /^(\$RECYCLE\.BIN|System Volume Information)$/i
const SAMPLE_FILE = /(^|[ ._-])sample([ ._-]|$)/i
const SEASON_DIR = /^(?:season|temporada|s)[ ._-]*0*(\d{1,2})$/i
export const SXE = /(?<![a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})((?:[ ._-]?e\d{1,3})*)/i
const NXN = /(?<![a-z0-9])(\d{1,2})x(\d{1,3})(?![a-z0-9])/i
const LEADING_EP = /^(?:e|ep|episode|epis[oó]dio|cap[ií]tulo)?[ ._-]*0*(\d{1,3})(?![0-9])/i
const QUALITY =
  /(?<![a-z0-9])(\d{3,4}x\d{3,4}|2160p|1080p|720p|576p|480p|4k|uhd|x ?26[45]|h ?26[45]|hevc|avc|web ?dl|webrip|blu ?ray|brrip|bdrip|hdtv|dvdrip|hdrip|remux|dual|dublado|legendado|nacional|proper|repack|10bit|hdr)(?![a-z0-9])/i
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

/** Pastas que só agrupam títulos (ou só dizem qualidade/ano/idioma); nunca são o nome da série. */
const CONTAINER_DIRS = new Set([
  'series', 'serie', 'filmes', 'filme', 'movies', 'movie', 'films', 'anime', 'animes',
  'desenhos', 'cartoons', 'tv', 'shows', 'documentarios', 'novelas',
  'tv shows', 'series completas', 'downloads', 'completo', 'complete'
])
const QUALITY_DIR = /^(2160p|1080p|720p|480p|4k|uhd|hdr|\d{4}|dublado|legendado|dual|nacional)$/
const isContainer = (dir: string) => CONTAINER_DIRS.has(plain(dir)) || QUALITY_DIR.test(plain(dir))
const hasTag = (s: string) => /\[[^\]]*\]/.test(s)

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

/** Nome da pasta do título; tira um "S01"/"Season 1" final de pasta de release (Dark.S01.1080p). */
function cleanTitleDir(dir: string): { name: string; year?: number } {
  const c = cleanName(dir)
  const name = c.name.replace(/\s+(?:s\d{1,2}|season \d{1,2}|temporada \d{1,2})$/i, '').trim()
  return c.year === undefined ? { name } : { name, year: c.year }
}

/**
 * Pasta do título: (a) a pasta mais funda, fora temporadas e contêineres, cujo nome (sem [tags]) tem o mesmo slug do
 * prefixo do arquivo; (b) senão a primeira pasta que não é contêiner, desde que não seja pasta de temporada estrita.
 */
function titleDirIndex(dirs: string[], prefix: string): number | undefined {
  const slug = slugify(cleanName(prefix).name)
  if (slug) {
    for (let i = dirs.length - 1; i >= 0; i--) {
      const d = dirs[i]!
      if (SEASON_DIR.test(d) || isContainer(d) || hasTag(d)) continue
      if (slugify(cleanTitleDir(d).name) === slug) return i
    }
  }
  const i = dirs.findIndex((d) => !isContainer(d))
  if (i < 0 || SEASON_DIR.test(dirs[i]!)) return undefined
  return i
}

const WORD_EP = /^(?:epis[oó]dio|episode|cap[ií]tulo|ep|cap)[ ._-]*0*(\d{1,3})(?![0-9])/i

/** Título do episódio: sem [grupos] nem qualidade no fim; parênteses ficam. */
function episodeTitleOf(rest: string): string | undefined {
  let t = rest.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
  const q = t.search(QUALITY)
  if (q >= 0) t = t.slice(0, q)
  t = t.replace(/[\s._-]+$/, '').trim()
  return t || undefined
}

interface AnimeParts { full: string; base: string; episode: number; digits: number; trailing?: number }

/** Forma de anime "Nome - NN": sem [grupos] e sem (qualidade), pontos e sublinhados viram espaço, número no fim. */
function animeForm(file: string): AnimeParts | null {
  const s = file
    .replace(/\([^)]*\)/g, (g) => (QUALITY.test(g) ? ' ' : g))
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = s.match(/^(.+?)\s+-\s+(\d{2,3})(?:v\d+)?$/)
  if (!m) return null
  const full = m[1]!.replace(/^[\s-]+/, '').trim()
  if (!full) return null
  const out: AnimeParts = { full, base: full, episode: Number(m[2]), digits: m[2]!.length }
  const t = full.match(/^(.*\S)\s+([2-9])$/)
  if (t) {
    out.base = t[1]!
    out.trailing = Number(t[2])
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

  // Contexto de pastas para um dado prefixo (texto do arquivo antes do marcador de episódio).
  const ctx = (prefix: string) => {
    const titleIdx = titleDirIndex(dirs, prefix)
    // temporada pelas pastas: a mais próxima do arquivo, abaixo da pasta do título
    let folderSeason: number | undefined
    for (let i = dirs.length - 1; i >= (titleIdx === undefined ? 0 : titleIdx + 1); i--) {
      folderSeason = seasonOfDir(dirs[i]!, titleIdx !== undefined)
      if (folderSeason !== undefined) break
    }
    // sem informação de temporada, vale 1 desde que haja pasta de título
    const impliedSeason = folderSeason ?? (titleIdx !== undefined ? 1 : undefined)
    let name: { name: string; year?: number } = cleanName(prefix)
    let fromFolder = false
    if (titleIdx !== undefined) {
      const dir = cleanTitleDir(dirs[titleIdx]!)
      if (dir.name) {
        if (dir.year === undefined && name.year !== undefined) dir.year = name.year
        name = dir
        fromFolder = true
      }
    }
    return { titleIdx, folderSeason, impliedSeason, name, fromFolder }
  }

  const sxe = file.match(SXE)
  if (sxe) {
    const eps = [Number(sxe[2]), ...[...(sxe[3] ?? '').matchAll(/e(\d{1,3})/gi)].map((m) => Number(m[1]))]
    const r = episode(ctx(file.slice(0, sxe.index)).name, Number(sxe[1]), eps)
    if (r) return r
  }

  const nxn = file.match(NXN)
  if (nxn) {
    const c = ctx(file.slice(0, nxn.index))
    if (nxn[2]!.length > 1 || c.titleIdx !== undefined) {
      const r = episode(c.name, Number(nxn[1]), [Number(nxn[2])])
      if (r) return r
    }
  }

  // "episódio N - Título": só no começo do nome e sem ano entre parênteses depois (senão é filme)
  const cleaned = file.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
  const word = cleaned.match(WORD_EP)
  if (word) {
    const rest = cleaned.slice(word[0].length)
    const c = ctx('')
    if (c.impliedSeason !== undefined && !/\((?:19|20)\d{2}\)/.test(rest)) {
      const title = rest.match(/^\s*[-–]\s*(\S.*)$/)?.[1]
      const r = episode(c.name, c.impliedSeason, [Number(word[1])], title === undefined ? undefined : episodeTitleOf(title))
      if (r) return r
    }
  }

  const anime = animeForm(file)
  if (anime) {
    const c0 = ctx(anime.full)
    // sem tag de release, pasta de temporada ou 3 dígitos, "Nome - 01" é filme
    if (hasTag(file) || c0.folderSeason !== undefined || anime.digits === 3) {
      let c = c0
      let season = c0.impliedSeason
      if (anime.trailing !== undefined) {
        const keep =
          (c0.fromFolder && new RegExp(`(?<!\\d)${anime.trailing}$`).test(c0.name.name)) || c0.folderSeason !== undefined
        if (!keep) {
          c = ctx(anime.base)
          season = anime.trailing
        }
      }
      if (season !== undefined) {
        const r = episode(c.name, season, [anime.episode])
        if (r) return r
      }
    }
  }

  // número solto na pasta de temporada (estrita ou solta): "05 - Nome.mkv"
  const c = ctx('')
  const lastIdx = dirs.length - 1
  const lastSeason = lastIdx >= 0 ? seasonOfDir(dirs[lastIdx]!, c.titleIdx !== undefined && lastIdx > c.titleIdx) : undefined
  if (lastSeason !== undefined) {
    const strict = SEASON_DIR.test(dirs[lastIdx]!)
    const ep = file.match(LEADING_EP)
    if (ep) {
      const r = episode(c.name, lastSeason, [Number(ep[1])])
      if (r || strict) return r
    } else if (strict) return null
  }

  let named = cleanName(file)
  if (!named.name) named = cleanName(dirs[dirs.length - 1] ?? '')
  if (!named.name) return null
  const year = named.year ?? (dirs.length ? cleanName(dirs[dirs.length - 1]!).year : undefined)
  return year === undefined ? { kind: 'movie', title: named.name } : { kind: 'movie', title: named.name, year }
}
