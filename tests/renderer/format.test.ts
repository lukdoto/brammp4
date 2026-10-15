import { describe, it, expect } from 'vitest'
import { resolutionLabel, codecLabel, itemLabel, seasonsOf, plural } from '../../src/renderer/src/format'

describe('format', () => {
  it('resolução', () => {
    expect(resolutionLabel(2160)).toBe('4K')
    expect(resolutionLabel(1080)).toBe('1080p')
    expect(resolutionLabel(800)).toBe('720p')
    expect(resolutionLabel(480)).toBe('480p')
    expect(resolutionLabel(undefined)).toBeUndefined()
  })
  it('codec', () => {
    expect(codecLabel('hevc')).toBe('x265')
    expect(codecLabel('h264')).toBe('x264')
    expect(codecLabel('av1')).toBe('AV1')
  })
  it('rótulo S01E03', () => {
    expect(itemLabel(1, 3)).toBe('S01E03')
    expect(itemLabel(null, null)).toBe('Filme')
  })
  it('temporadas distintas e ordenadas', () => {
    const mk = (s: number | null) => ({ key: String(s), season: s, episode: 1, files: [] })
    expect(seasonsOf([mk(2), mk(1), mk(2)])).toEqual([1, 2])
  })
  it('plural', () => {
    expect(plural(1, 'série', 'séries')).toBe('1 série')
    expect(plural(0, 'filme', 'filmes')).toBe('0 filmes')
    expect(plural(2, 'episódio', 'episódios')).toBe('2 episódios')
  })
})
