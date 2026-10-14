import { describe, it, expect } from 'vitest'
import { parseVideoPath, isIgnored } from '../../src/main/parser/video'

describe('parseVideoPath', () => {
  const cases: [string, unknown][] = [
    ['Dark/Season 1/Dark.S01E03.1080p.WEB.x265-GROUP.mkv', { kind: 'episode', seriesName: 'Dark', season: 1, episodes: [3] }],
    ['Series/Dark.S01E03.mkv', { kind: 'episode', seriesName: 'Dark', season: 1, episodes: [3] }],
    ['Doctor.Who.2005.S01E01.mkv', { kind: 'episode', seriesName: 'Doctor Who', year: 2005, season: 1, episodes: [1] }],
    ['Friends/Temporada 02/Friends 2x05 - Nome.avi', { kind: 'episode', seriesName: 'Friends', season: 2, episodes: [5] }],
    ['The Office/Season 03/03 - The Coup.mkv', { kind: 'episode', seriesName: 'The Office', season: 3, episodes: [3] }],
    ['Breaking Bad/S05/E14.mkv', { kind: 'episode', seriesName: 'Breaking Bad', season: 5, episodes: [14] }],
    ['Dark/Season 1/Dark.S01E01E02.mkv', { kind: 'episode', seriesName: 'Dark', season: 1, episodes: [1, 2] }],
    ['show_s1e3.mkv', { kind: 'episode', seriesName: 'show', season: 1, episodes: [3] }],
    ['Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E01.mkv', { kind: 'episode', seriesName: 'La Casa de Papel', season: 1, episodes: [1] }],
    ['進撃の巨人/Season 1/進撃の巨人 S01E01.mkv', { kind: 'episode', seriesName: '進撃の巨人', season: 1, episodes: [1] }],
    ['Filmes/Interestelar (2014) [1080p].mkv', { kind: 'movie', title: 'Interestelar', year: 2014 }],
    ['Blade.Runner.2049.2017.1080p.BluRay.x264.mkv', { kind: 'movie', title: 'Blade Runner 2049', year: 2017 }],
    ['1917.2019.1080p.mkv', { kind: 'movie', title: '1917', year: 2019 }],
    ['Filmes/Cidade de Deus (2002)/Cidade.de.Deus.2002.DUAL.mkv', { kind: 'movie', title: 'Cidade de Deus', year: 2002 }],
    ['Filmes/Blade Runner 2049.mkv', { kind: 'movie', title: 'Blade Runner 2049' }]
  ]
  for (const [path, expected] of cases) {
    it(path, () => expect(parseVideoPath(path)).toEqual(expected))
  }

  it('arquivo em pasta de temporada sem número de episódio não é reconhecido', () => {
    expect(parseVideoPath('Dark/Season 1/notes episode.mkv')).toBeNull()
  })
})

describe('isIgnored', () => {
  it.each([
    ['Dark/Extras/Making of.mkv', true],
    ['Dark/Featurettes/x.mkv', true],
    ['Filme/Filme.sample.mkv', true],
    ['Samples/x.mkv', true],
    ['$RECYCLE.BIN/x.mkv', true],
    ['System Volume Information/x.mkv', true],
    ['.brammp4.json', true],
    ['Dark/Season 1/Dark.S01E01.mkv', false],
    ['Sampler (2020).mkv', false]
  ])('%s -> %s', (path, expected) => expect(isIgnored(path)).toBe(expected))
})
