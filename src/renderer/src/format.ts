import type { AudioOption, ItemView, ProgressView, SubOption } from '../../shared/types'

export function resolutionLabel(height?: number): string | undefined {
  if (!height) return undefined
  if (height >= 2000) return '4K'
  if (height >= 1000) return '1080p'
  if (height >= 700) return '720p'
  if (height >= 560) return '576p'
  return `${height}p`
}

export function codecLabel(codec?: string): string | undefined {
  if (!codec) return undefined
  const map: Record<string, string> = { hevc: 'x265', h264: 'x264', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4' }
  return map[codec] ?? codec.toUpperCase()
}

const pad = (n: number) => String(n).padStart(2, '0')

export function itemLabel(season: number | null, episode: number | null): string {
  return season === null || episode === null ? 'Filme' : `S${pad(season)}E${pad(episode)}`
}

export function seasonsOf(items: ItemView[]): number[] {
  return [...new Set(items.map((i) => i.season).filter((s): s is number => s !== null))].sort((a, b) => a - b)
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function formatClock(totalS: number): string {
  if (!Number.isFinite(totalS)) return '0:00'
  const s = Math.max(0, Math.floor(totalS))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export function minutesLabel(durationS: number): string {
  const min = Math.max(1, Math.round(durationS / 60))
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`
}

/** Fração assistida (0 a 1) para a barra; undefined quando não há como calcular. Assistido = cheia. */
export function progressRatio(p: Pick<ProgressView, 'positionS' | 'durationS' | 'watched'> | undefined, fallbackDurationS?: number): number | undefined {
  if (!p) return undefined
  if (p.watched) return 1
  const d = p.durationS ?? fallbackDurationS
  if (d === undefined || !Number.isFinite(d) || d <= 0 || !Number.isFinite(p.positionS)) return undefined
  return Math.min(1, Math.max(0, p.positionS / d))
}

const LANGS: Record<string, string> = {
  por: 'Português', eng: 'Inglês', spa: 'Espanhol', fra: 'Francês', deu: 'Alemão', ita: 'Italiano', jpn: 'Japonês'
}

export function langName(code?: string): string | undefined {
  if (!code) return undefined
  return LANGS[code] ?? code.toUpperCase()
}

export function audioLabel(a: AudioOption): string {
  return [langName(a.lang) ?? 'Idioma desconhecido', ...(a.title ? [a.title] : []), a.codec.toUpperCase()].join(' · ')
}

export function subLabel(s: SubOption): string {
  return `${langName(s.lang) ?? 'Idioma desconhecido'}${s.isForced ? ' (forçada)' : ''}${s.isSdh ? ' (SDH)' : ''}${s.source === 'external' ? ' (arquivo)' : ''}`
}
