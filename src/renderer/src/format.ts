import type { ItemView } from '../../shared/types'

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
