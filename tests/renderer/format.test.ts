import { describe, it, expect } from 'vitest'
import { resolutionLabel, codecLabel, itemLabel, seasonsOf, plural, audioLabel, formatClock, langName, minutesLabel, progressRatio, subLabel } from '../../src/renderer/src/format'

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

describe('relógio e progresso', () => {
  it('formatClock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(1834)).toBe('30:34')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(-4)).toBe('0:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatClock(Number.NEGATIVE_INFINITY)).toBe('0:00')
  })
  it('minutesLabel', () => {
    expect(minutesLabel(1380)).toBe('23 min')
    expect(minutesLabel(7260)).toBe('2 h 1 min')
    expect(minutesLabel(20)).toBe('1 min')
  })
  it('progressRatio', () => {
    expect(progressRatio(undefined)).toBeUndefined()
    expect(progressRatio({ positionS: 690, durationS: 1380, watched: false })).toBe(0.5)
    expect(progressRatio({ positionS: 10, watched: false }, 1000)).toBe(0.01)
    expect(progressRatio({ positionS: 10, watched: false })).toBeUndefined()
    expect(progressRatio({ positionS: 5, durationS: 1380, watched: true })).toBe(1)
    expect(progressRatio({ positionS: 2000, durationS: 1380, watched: false })).toBe(1)
    expect(progressRatio({ positionS: Number.NaN, durationS: 1380, watched: false })).toBeUndefined()
    expect(progressRatio({ positionS: 10, durationS: Number.POSITIVE_INFINITY, watched: false })).toBeUndefined()
    expect(progressRatio({ positionS: 10, durationS: Number.NaN, watched: false })).toBeUndefined()
    expect(progressRatio({ positionS: Number.POSITIVE_INFINITY, durationS: 1380, watched: false })).toBeUndefined()
  })
  it('rótulos de faixas', () => {
    expect(langName('por')).toBe('Português')
    expect(langName('xyz')).toBe('XYZ')
    expect(langName(undefined)).toBeUndefined()
    expect(audioLabel({ typeIndex: 1, lang: 'jpn', codec: 'eac3', isDefault: true })).toBe('Japonês · EAC3')
    expect(audioLabel({ typeIndex: 2, codec: 'aac', title: 'Dublado', isDefault: false })).toBe('Idioma desconhecido · Dublado · AAC')
    expect(subLabel({ source: 'external', externalPath: 'a.srt', lang: 'por', codec: 'srt', isDefault: false, isForced: false, isSdh: false })).toBe('Português (arquivo)')
    expect(subLabel({ source: 'embedded', typeIndex: 1, lang: 'eng', codec: 'subrip', isDefault: false, isForced: true, isSdh: true })).toBe('Inglês (forçada) (SDH)')
  })
})
