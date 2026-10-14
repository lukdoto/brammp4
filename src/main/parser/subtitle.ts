import { splitPath, stripExt, SXE } from './video'
import { episodeCode } from './keys'

// .sub de texto (MicroDVD) é raro e ambíguo com o .sub do VobSub; usamos o .idx.
export const SUB_EXTS = new Set(['.srt', '.ass', '.ssa', '.vtt', '.idx'])

const LANGS: Record<string, string> = {
  'pt-br': 'por', ptbr: 'por', pob: 'por', pb: 'por', por: 'por', pt: 'por', portuguese: 'por', portugues: 'por',
  'português': 'por', brazilian: 'por',
  en: 'eng', eng: 'eng', english: 'eng', ingles: 'eng', 'inglês': 'eng',
  es: 'spa', spa: 'spa', spanish: 'spa', espanol: 'spa', 'español': 'spa', espanhol: 'spa',
  fr: 'fra', fre: 'fra', fra: 'fra', french: 'fra', frances: 'fra', 'francês': 'fra',
  de: 'deu', ger: 'deu', deu: 'deu', german: 'deu', alemao: 'deu', 'alemão': 'deu',
  it: 'ita', ita: 'ita', italian: 'ita', italiano: 'ita',
  ja: 'jpn', jpn: 'jpn', japanese: 'jpn', japones: 'jpn', 'japonês': 'jpn'
}

export const LANG_LABEL: Record<string, string> = {
  por: 'Português', eng: 'Inglês', spa: 'Espanhol', fra: 'Francês', deu: 'Alemão', ita: 'Italiano', jpn: 'Japonês'
}

const FORCED = /^(forced|forcada|forçada)$/i
const SDH = /^(sdh|cc|hi)$/i
const SUBS_DIR = /^(subs?|legendas?|subtitles?)$/i

export function normalizeLang(code?: string): string | undefined {
  if (!code) return undefined
  const c = code.toLowerCase()
  if (c === 'und') return undefined
  return LANGS[c] ?? c
}

export interface ParsedSub {
  relPath: string
  dir: string
  base: string
  lang?: string | undefined
  forced: boolean
  sdh: boolean
  episodeCode?: string | undefined
}

export function parseSubtitlePath(relPath: string): ParsedSub {
  const parts = splitPath(relPath)
  const name = stripExt(parts[parts.length - 1] ?? '')
  const dirs = parts.slice(0, -1)
  const tokens = name.split('.')
  let lang: string | undefined
  let forced = false
  let sdh = false
  while (tokens.length > 1) {
    const t = tokens[tokens.length - 1]!.toLowerCase()
    if (FORCED.test(t)) forced = true
    else if (SDH.test(t)) sdh = true
    else if (!lang && LANGS[t]) lang = LANGS[t]
    else break
    tokens.pop()
  }
  const base = tokens.join('.')
  const inSubsDir = dirs.some((d, i) => SUBS_DIR.test(d) && i >= dirs.length - 2)
  if (!lang && inSubsDir) {
    for (const w of base.split(/[ ._-]+/).reverse()) {
      const l = LANGS[w.toLowerCase()]
      if (l && w.length > 2) {
        lang = l
        break
      }
    }
  }
  const sxe = name.match(SXE)
  return {
    relPath: parts.join('/'),
    dir: dirs.join('/'),
    base,
    lang,
    forced,
    sdh,
    episodeCode: sxe ? episodeCode(Number(sxe[1]), Number(sxe[2])) : undefined
  }
}

export interface VideoRef { relPath: string; episodeCodes: string[] }

export function matchSubtitles(videos: VideoRef[], subs: ParsedSub[]): { matches: Map<string, ParsedSub[]>; unmatched: ParsedSub[] } {
  const byDir = new Map<string, { video: VideoRef; base: string }[]>()
  for (const v of videos) {
    const parts = splitPath(v.relPath)
    const dir = parts.slice(0, -1).join('/').toLowerCase()
    const list = byDir.get(dir) ?? []
    list.push({ video: v, base: stripExt(parts[parts.length - 1]!).toLowerCase() })
    byDir.set(dir, list)
  }
  const matches = new Map<string, ParsedSub[]>()
  const unmatched: ParsedSub[] = []
  const add = (v: VideoRef, s: ParsedSub) => matches.set(v.relPath, [...(matches.get(v.relPath) ?? []), s])

  for (const s of subs) {
    const dirParts = splitPath(s.dir)
    const last = dirParts[dirParts.length - 1] ?? ''
    const secondLast = dirParts[dirParts.length - 2] ?? ''
    const candidateDirs = [dirParts.join('/')]
    if (SUBS_DIR.test(last)) candidateDirs.push(dirParts.slice(0, -1).join('/'))
    const base = s.base.toLowerCase()

    // 1. mesmo nome-base na pasta da legenda ou na pasta acima de Subs/Legendas
    let found = candidateDirs
      .flatMap((d) => byDir.get(d.toLowerCase()) ?? [])
      .find((c) => c.base === base)?.video

    // 2. Subs/<nome-do-vídeo>/qualquer.srt
    if (!found && SUBS_DIR.test(secondLast)) {
      const videoDir = dirParts.slice(0, -2).join('/').toLowerCase()
      found = (byDir.get(videoDir) ?? []).find((c) => c.base === last.toLowerCase())?.video
    }

    // 3. mesmo código de episódio, desde que só um vídeo da pasta tenha esse código
    if (!found && s.episodeCode) {
      const hits = candidateDirs
        .flatMap((d) => byDir.get(d.toLowerCase()) ?? [])
        .filter((c) => c.video.episodeCodes.includes(s.episodeCode!))
      if (hits.length === 1) found = hits[0]!.video
    }

    if (found) add(found, s)
    else unmatched.push(s)
  }
  return { matches, unmatched }
}
