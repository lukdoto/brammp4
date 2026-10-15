import { describe, it, expect } from 'vitest'
import { parseVideoPath } from '../../src/main/parser/video'
import { itemsOf } from '../../src/main/parser/keys'

const ep = (seriesName: string, season: number, episodes: number[], extra: Record<string, unknown> = {}) => ({
  kind: 'episode', seriesName, season, episodes, ...extra
})

describe('layouts reais da biblioteca', () => {
  const AV = 'Avatar a Lenda de Aang'
  const cases: [string, unknown][] = [
    [`${AV}/1 Livro Um_ Água/1x01_-_-By_Fulano_-_SITE.COM[1].mkv`, ep(AV, 1, [1])],
    [`${AV}/1 Livro Um_ Água/1x02 - -By Fulano - SITE.COM.mkv`, ep(AV, 1, [2])],
    [`${AV}/2 Livro Dois_ Terra/episódio 1 - O Estado Avatar.avi`, ep(AV, 2, [1], { episodeTitle: 'O Estado Avatar' })],
    [`${AV}/2 Livro Dois_ Terra/episódio 10 - A Biblioteca.avi`, ep(AV, 2, [10], { episodeTitle: 'A Biblioteca' })],
    [
      `${AV}/3 Livro Três_ Fogo/episódio 10 - O Dia Do Sol Negro (1ª Parte - A Invasão).avi`,
      ep(AV, 3, [10], { episodeTitle: 'O Dia Do Sol Negro (1ª Parte - A Invasão)' })
    ],
    [
      `${AV}/Avatar.Aang.The.Last.Airbender.2026.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H265-GRP.DUAL-x.mkv`,
      { kind: 'movie', title: 'Avatar Aang The Last Airbender', year: 2026 }
    ],
    ['cowboy bebop/Cowboy.Bebop.S01E01.1080p.BluRay.FLAC.5.1.x264-GRP.TRIAL-x-006.mkv', ep('cowboy bebop', 1, [1])],
    ['Duna/Dune.2021.1080p.AMZN.WEB-DL.DDP5.1.H.264.DUAL-GRP.mkv', { kind: 'movie', title: 'Dune', year: 2021 }],
    ['Duna/Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.H264.DUAL-GRP.mkv', { kind: 'movie', title: 'Dune Part Two', year: 2024 }],
    [
      'Frieren/[WF] Sousou no Frieren [BD 1080p x265 OPUS][DUAL]/[WF] Sousou no Frieren - 01 [BD 1080p x265 OPUS][DUAL][11F8B077].mkv',
      ep('Frieren', 1, [1])
    ],
    [
      'Frieren/[WF] Sousou no Frieren [BD 1080p x265 OPUS][DUAL]/[WF] Sousou no Frieren - 28 [BD 1080p x265 OPUS][DUAL][7DA1D64C].mkv',
      ep('Frieren', 1, [28])
    ],
    ['Frieren/[S.A]_[Wf]_-_Sousou No Frieren 2_-_01 [SD].mp4', ep('Frieren', 2, [1])],
    ['X-Men 97/S1/1x1.mp4', ep('X-Men 97', 1, [1])],
    ['X-Men 97/S1/1x10.mp4', ep('X-Men 97', 1, [10])],
    ['X-Men 97/S2/ep 1.mkv', ep('X-Men 97', 2, [1])],
    ['X-Men 97/S2/ep 9.mkv', ep('X-Men 97', 2, [9])]
  ]
  for (const [path, expected] of cases) {
    it(path, () => expect(parseVideoPath(path)).toEqual(expected))
  }
})

describe('pasta do título', () => {
  it.each([
    ['Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E01.mkv', 'La Casa de Papel'],
    ['Series/Dark.S01E03.mkv', 'Dark'],
    ['Animes/Desenhos/Naruto/Naruto.S01E01.mkv', 'Naruto'],
    ['Filmes/Dark/Dark.S01E01.mkv', 'Dark'],
    ['Dark/Dark.S01E01.mkv', 'Dark'],
    ['3 Body Problem/Season 1/3.Body.Problem.S01E01.mkv', '3 Body Problem'],
    ['Pasta Qualquer/Outro Nome.S01E01.mkv', 'Pasta Qualquer'],
    ['Dark.S01.1080p.BluRay/Dark.S01E01.mkv', 'Dark']
  ])('%s -> série %s', (path, name) => {
    expect(parseVideoPath(path)).toMatchObject({ kind: 'episode', seriesName: name })
  })

  it('pasta de temporada no lugar do título cai no prefixo do arquivo', () => {
    expect(parseVideoPath('S1/Dark.S01E01.mkv')).toEqual(ep('Dark', 1, [1]))
    expect(parseVideoPath('Season 2/Dark.S01E01.mkv')).toEqual(ep('Dark', 1, [1]))
  })

  it('arquivo dentro de contêiner sem pasta de título usa o prefixo', () => {
    expect(parseVideoPath('Séries/Dark.S01E03.mkv')).toEqual(ep('Dark', 1, [3]))
  })

  it('contêiner sem nome no arquivo não vira série', () => {
    expect(parseVideoPath('Series/S01E03.mkv')).toBeNull()
  })

  it('ano da pasta ou do prefixo é preservado', () => {
    expect(parseVideoPath('Dark (2017)/Dark.S01E01.mkv')).toEqual(ep('Dark', 1, [1], { year: 2017 }))
    expect(parseVideoPath('Dark/Dark.2017.S01E01.mkv')).toEqual(ep('Dark', 1, [1], { year: 2017 }))
  })

  it('filmes continuam filmes', () => {
    expect(parseVideoPath('Filmes/Interestelar (2014) [1080p].mkv')).toEqual({ kind: 'movie', title: 'Interestelar', year: 2014 })
    expect(parseVideoPath('Filmes/Interestelar (2014)/Interestelar.2014.1080p.mkv')).toEqual({
      kind: 'movie', title: 'Interestelar', year: 2014
    })
  })
})

describe('temporada pelas pastas', () => {
  it.each([
    ['Show/Livro 2/ep 1.mkv', 2],
    ['Show/Book 3/ep 1.mkv', 3],
    ['Show/Parte Quatro/ep 1.mkv', 4],
    ['Show/Part 5/ep 1.mkv', 5],
    ['Show/Volume 6/ep 1.mkv', 6],
    ['Show/Vol 7/ep 1.mkv', 7],
    ['Show/Temp 8/ep 1.mkv', 8],
    ['Show/3 - Terceira/ep 1.mkv', 3],
    ['Show/2_Segunda/ep 1.mkv', 2],
    ['Show/Livro Três_ Fogo/ep 1.mkv', 3],
    ['Show/Livro Dez/ep 1.mkv', 10]
  ])('%s -> temporada %i', (path, season) => {
    expect(parseVideoPath(path)).toMatchObject({ kind: 'episode', seriesName: 'Show', season, episodes: [1] })
  })

  it('pasta de qualidade ou de release não é temporada', () => {
    expect(parseVideoPath('Show/2160p/ep 1.mkv')).toMatchObject({ season: 1 })
    expect(parseVideoPath('Show/[Grupo] Show [BD 1080p]/ep 3.mkv')).toMatchObject({ season: 1, episodes: [3] })
    expect(parseVideoPath('Show/1080p/Show.S01E01.mkv')).toMatchObject({ season: 1 })
  })

  it('temporada no nome do arquivo vence a da pasta', () => {
    expect(parseVideoPath('Show/2 Livro Dois/Show.S03E01.mkv')).toMatchObject({ season: 3 })
    expect(parseVideoPath('Show/2 Livro Dois/Show 4x05.mkv')).toMatchObject({ season: 4, episodes: [5] })
  })

  it('a pasta do título nunca é lida como temporada solta', () => {
    expect(parseVideoPath('2 Broke Girls/ep 3.mkv')).toMatchObject({ seriesName: '2 Broke Girls', season: 1 })
  })

  it('temporada padrão 1 só com pasta de título', () => {
    expect(parseVideoPath('Show/ep 4.mkv')).toEqual(ep('Show', 1, [4]))
    expect(parseVideoPath('ep 4.mkv')).toMatchObject({ kind: 'movie' })
  })
})

describe('marcadores de episódio', () => {
  it.each([
    ['Show/Show 1x1.mkv', 1, 1],
    ['Show/Show 1x01.mkv', 1, 1],
    ['Show/Show 12x123.mkv', 12, 123],
    ['Show/Show.Episode.05.mkv', 1, 5],
    ['Show/Show episodio 7.mkv', 1, 7],
    ['Show/Show Capítulo 9.mkv', 1, 9],
    ['Show/capitulo 11.mkv', 1, 11],
    ['Show/Cap 12.mkv', 1, 12]
  ])('%s', (path, season, episode) => {
    expect(parseVideoPath(path)).toEqual(ep('Show', season, [episode]))
  })

  it('resolução e codec não são episódio', () => {
    expect(parseVideoPath('Filmes/Filme.1920x1080.mkv')).toMatchObject({ kind: 'movie' })
    expect(parseVideoPath('Filme.2019.1280x720.x264.mkv')).toMatchObject({ kind: 'movie' })
    expect(parseVideoPath('Filme.2019.x264.mkv')).toMatchObject({ kind: 'movie' })
  })

  it('"Seven - 7" é filme (um dígito não é episódio)', () => {
    expect(parseVideoPath('Seven - 7.mkv')).toEqual({ kind: 'movie', title: 'Seven - 7' })
    expect(parseVideoPath('Show/Seven - 7.mkv')).toMatchObject({ kind: 'movie' })
  })

  it('palavra "sleep" ou "escape" não é marcador', () => {
    expect(parseVideoPath('Show/Sleep 5.mkv')).toMatchObject({ kind: 'movie' })
  })

  it('forma anime: nome - NN, com versão', () => {
    expect(parseVideoPath('Meu Anime/[Grupo] Meu Anime - 05v2 [720p].mkv')).toEqual(ep('Meu Anime', 1, [5]))
    expect(parseVideoPath('Meu Anime/Meu.Anime_-_123.mkv')).toEqual(ep('Meu Anime', 1, [123]))
  })

  it('forma anime na raiz, sem temporada em lugar nenhum, não é episódio', () => {
    expect(parseVideoPath('[Grupo] Meu Anime - 05 [720p].mkv')).toMatchObject({ kind: 'movie' })
    expect(parseVideoPath('Anime/[Grupo] Meu Anime - 05 [720p].mkv')).toMatchObject({ kind: 'movie' })
  })

  it('anime: dígito 2-9 depois do nome é a temporada e não entra no nome', () => {
    expect(parseVideoPath('[Grupo] Meu Anime 3 - 04 [720p].mkv')).toEqual(ep('Meu Anime', 3, [4]))
    expect(parseVideoPath('Season 2/[Grupo] Meu Anime 3 - 04 [720p].mkv')).toEqual(ep('Meu Anime', 3, [4]))
    expect(parseVideoPath('Anime/[Grupo] Meu Anime 3 - 04 [720p].mkv')).toEqual(ep('Meu Anime', 3, [4]))
    expect(parseVideoPath('Pasta/[Grupo] Meu Anime 3 - 04 [720p].mkv')).toEqual(ep('Pasta', 3, [4]))
    expect(parseVideoPath('Pasta/[Grupo] Meu Anime 12 - 04 [720p].mkv')).toEqual(ep('Pasta', 1, [4]))
  })

  it('forma anime sem pasta de título usa o nome do arquivo quando há pasta de temporada', () => {
    expect(parseVideoPath('Season 1/Meu Anime - 04.mkv')).toEqual(ep('Meu Anime', 1, [4]))
  })

  it('episódio com título só para a forma "episódio N - Título"', () => {
    expect(parseVideoPath('Show/ep 3 - Piloto.mkv')).toMatchObject({ episodeTitle: 'Piloto' })
    expect(parseVideoPath('Show/ep 3.mkv')).not.toHaveProperty('episodeTitle')
    expect(parseVideoPath('Show/Show 1x03 - Piloto.mkv')).not.toHaveProperty('episodeTitle')
    expect(parseVideoPath('Show/Show - 03.mkv')).not.toHaveProperty('episodeTitle')
  })

  it('número solto em pasta de temporada continua funcionando', () => {
    expect(parseVideoPath('Show/Season 2/05 - Nome.mkv')).toEqual(ep('Show', 2, [5]))
    expect(parseVideoPath('Show/Season 2/notes episode.mkv')).toBeNull()
  })

  it('pasta de temporada solta não transforma filme em episódio nem em não identificado', () => {
    expect(parseVideoPath('Filmes/Saga/1 Primeiro/Filme.2001.mkv')).toEqual({ kind: 'movie', title: 'Filme', year: 2001 })
  })
})

describe('chaves e título do episódio', () => {
  it('itemsOf devolve name só para arquivo de um episódio', () => {
    const p = parseVideoPath('Avatar a Lenda de Aang/2 Livro Dois_ Terra/episódio 1 - O Estado Avatar.avi')!
    expect(itemsOf(p)).toEqual([{ key: 'local:avatar-a-lenda-de-aang:S02E01', season: 2, episode: 1, name: 'O Estado Avatar' }])
    expect(itemsOf({ kind: 'episode', seriesName: 'Dark', season: 1, episodes: [1, 2], episodeTitle: 'X' })).toEqual([
      { key: 'local:dark:S01E01', season: 1, episode: 1 },
      { key: 'local:dark:S01E02', season: 1, episode: 2 }
    ])
  })
})
