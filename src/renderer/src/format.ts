import type { AssignResult, AudioOption, ItemView, ProgressView, ReclassifyResult, SetKeyResult, SubOption } from '../../shared/types'

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

const IMAGE_NAME = /^w(342|780)-[A-Za-z0-9_-]+\.jpg$/

/** URL do protocolo de imagens do cache; undefined se o nome não segue o padrão do cache. */
export function imageUrl(file: string | undefined): string | undefined {
  return file !== undefined && IMAGE_NAME.test(file) ? `brammp-img://img/${file}` : undefined
}

const pad =(n: number) => String(n).padStart(2, '0')

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

export function tmdbKeyError(e: Exclude<SetKeyResult, { ok: true }>['error']): string {
  switch (e) {
    case 'invalid': return 'A chave informada não tem um formato válido. Copie a chave de API (v3) completa.'
    case 'invalid-key': return 'O TMDB não aceitou essa chave. Confira se copiou a chave de API inteira.'
    case 'network': return 'Não foi possível falar com o TMDB. Verifique a conexão com a internet e tente de novo.'
    case 'encryption-unavailable': return 'Este computador não oferece armazenamento seguro para a chave, então ela não foi salva.'
  }
}

export function reclassifyError(e: Exclude<ReclassifyResult, { ok: true }>['error']): string {
  switch (e) {
    case 'invalid': return 'Dados inválidos. Confira os campos e tente de novo.'
    case 'offline': return 'Conecte a biblioteca para reclassificar este arquivo.'
  }
}

/** Temporada (0 a 200) e episódio (1 a 9999) como inteiros; null se algum campo for inválido. */
export function parseEpisodeInput(season: string, episode: string): { season: number; episode: number } | null {
  const s = season.trim()
  const e = episode.trim()
  if (!/^\d{1,3}$/.test(s) || !/^\d{1,4}$/.test(e)) return null
  const sn = Number(s)
  const en = Number(e)
  return sn <= 200 && en >= 1 ? { season: sn, episode: en } : null
}

export function assignError(e: Exclude<AssignResult, { ok: true }>['error']): string {
  switch (e) {
    case 'invalid': return 'Seleção inválida. Feche a janela e tente de novo.'
    case 'no-key': return 'Configure a chave do TMDB em Configurações antes de corrigir a identificação.'
    case 'network': return 'Não foi possível falar com o TMDB. Verifique a conexão com a internet e tente de novo.'
    case 'rate-limit': return 'O TMDB limitou as consultas por agora. Aguarde um instante e tente de novo.'
    case 'invalid-key': return 'O TMDB recusou a chave configurada. Atualize a chave em Configurações.'
    case 'bad-response': return 'O TMDB respondeu de um jeito inesperado. Tente de novo mais tarde.'
    case 'not-found': return 'Esse título não foi encontrado no TMDB. Escolha outro resultado.'
    case 'kind-mismatch': return 'Esse resultado é de outro tipo (filme no lugar de série, ou o contrário). Escolha outro.'
  }
}
