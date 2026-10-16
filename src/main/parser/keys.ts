import type { ParsedVideo } from '../../shared/types'

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

const pad = (n: number) => String(n).padStart(2, '0')

export function episodeCode(season: number, episode: number): string {
  return `S${pad(season)}E${pad(episode)}`
}

export function titleOf(p: ParsedVideo): { kind: 'series' | 'movie'; localKey: string; name: string; year?: number } {
  if (p.kind === 'episode') return { kind: 'series', localKey: `series:${slugify(p.seriesName)}`, name: p.seriesName, year: p.year }
  const slug = slugify(p.title)
  return { kind: 'movie', localKey: `movie:${p.year ? `${slug}-${p.year}` : slug}`, name: p.title, year: p.year }
}

export function itemsOf(p: ParsedVideo): { key: string; season: number | null; episode: number | null; name?: string }[] {
  if (p.kind === 'episode') {
    const slug = slugify(p.seriesName)
    // o título do episódio só vale quando o arquivo tem um único episódio
    const name = p.episodes.length === 1 && p.episodeTitle ? { name: p.episodeTitle } : {}
    return p.episodes.map((e) => ({ key: `local:${slug}:${episodeCode(p.season, e)}`, season: p.season, episode: e, ...name }))
  }
  const slug = slugify(p.title)
  return [{ key: `local:${p.year ? `${slug}-${p.year}` : slug}`, season: null, episode: null }]
}

export function episodeCodesOf(p: ParsedVideo): string[] {
  return p.kind === 'episode' ? p.episodes.map((e) => episodeCode(p.season, e)) : []
}
