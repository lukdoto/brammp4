import type { AudioOption, SubChoice, SubOption, TrackSelection } from '../../shared/types'
import type { Prefs } from '../db/progress'
import { normalizeLang } from '../parser/subtitle'

/** Normal (0) < SDH (1) < forçada (2) < forçada e SDH (3). */
function subRank(s: SubOption): number {
  return (s.isForced ? 2 : 0) + (s.isSdh ? 1 : 0)
}

function bestSub(candidates: SubOption[]): SubOption | undefined {
  return [...candidates].sort((a, b) => subRank(a) - subRank(b) || (a.source === b.source ? 0 : a.source === 'embedded' ? -1 : 1))[0]
}

function toChoice(s: SubOption): SubChoice {
  return s.source === 'embedded' ? { kind: 'embedded', typeIndex: s.typeIndex ?? 1 } : { kind: 'external', relPath: s.externalPath ?? '' }
}

export function defaultSelection(audio: AudioOption[], subs: SubOption[], prefs: Prefs): TrackSelection {
  const audioPick =
    (prefs.audioLang ? audio.find((a) => a.lang === prefs.audioLang) : undefined) ?? audio.find((a) => a.isDefault) ?? audio[0]

  let sub: SubChoice = { kind: 'off' }
  if (prefs.subLang !== 'off') {
    const preferred = prefs.subLang ? bestSub(subs.filter((s) => s.lang === prefs.subLang)) : undefined
    const flagged = subs.find((s) => s.source === 'embedded' && s.isDefault)
    const pick = preferred ?? flagged
    if (pick) sub = toChoice(pick)
  }
  return { audioTypeIndex: audioPick ? audioPick.typeIndex : null, sub }
}

/** Idiomas da escolha feita (painel de play), para gravar em `prefs`. Faixa sem idioma conhecido não vira preferência. */
export function prefsFromSelection(audio: AudioOption[], subs: SubOption[], sel: TrackSelection): Prefs {
  const out: Prefs = {}
  const a = audio.find((x) => x.typeIndex === sel.audioTypeIndex)
  if (a?.lang) out.audioLang = a.lang
  const choice = sel.sub
  if (choice.kind === 'off') out.subLang = 'off'
  else {
    const s = subs.find((x) =>
      choice.kind === 'embedded' ? x.source === 'embedded' && x.typeIndex === choice.typeIndex : x.source === 'external' && x.externalPath === choice.relPath
    )
    if (s?.lang) out.subLang = s.lang
  }
  return out
}

export interface MpvTrack {
  id: number
  type: string
  lang?: string
  title?: string
  default?: boolean
  forced?: boolean
  external?: boolean
  'external-filename'?: string
  selected?: boolean
}

const normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/** Id (para `sid`) da legenda externa que o mpv carregou a partir deste caminho absoluto. */
export function findExternalSubId(trackList: MpvTrack[], absPath: string): number | undefined {
  const want = normPath(absPath)
  return trackList.find((t) => t.type === 'sub' && t.external === true && typeof t['external-filename'] === 'string' && normPath(t['external-filename']) === want)?.id
}

/** Idiomas escolhidos pelo usuário dentro do mpv (menu do uosc), a partir de `aid` e `sid`. */
export function prefsFromMpv(trackList: MpvTrack[], aid: unknown, sid: unknown): Prefs {
  const out: Prefs = {}
  const a = typeof aid === 'number' ? trackList.find((t) => t.type === 'audio' && t.id === aid) : undefined
  const al = normalizeLang(a?.lang)
  if (al) out.audioLang = al
  if (sid === false || sid === 'no') out.subLang = 'off'
  else if (typeof sid === 'number') {
    const sl = normalizeLang(trackList.find((t) => t.type === 'sub' && t.id === sid)?.lang)
    if (sl) out.subLang = sl
  }
  return out
}
