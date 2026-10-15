import { describe, it, expect } from 'vitest'
import { parseSubtitlePath, matchSubtitles, normalizeLang } from '../../src/main/parser/subtitle'

describe('chaves herdadas do protótipo', () => {
  it('normalizeLang não devolve função para constructor/toString', () => {
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(typeof normalizeLang(k)).toBe('string')
    }
  })
  it('X.constructor.srt tem lang indefinida ou texto, nunca função', () => {
    const p = parseSubtitlePath('Filme/X.constructor.srt')
    expect(p.lang === undefined || typeof p.lang === 'string').toBe(true)
    const q = parseSubtitlePath('Subs/constructor/X.srt')
    expect(q.lang === undefined || typeof q.lang === 'string').toBe(true)
  })
})

describe('parseSubtitlePath', () => {
  it('extrai idioma e marcadores do sufixo', () => {
    expect(parseSubtitlePath('Dark/Season 1/Dark.S01E03.pt-BR.forced.srt')).toMatchObject({
      dir: 'Dark/Season 1', base: 'Dark.S01E03', lang: 'por', forced: true, sdh: false, episodeCode: 'S01E03'
    })
    expect(parseSubtitlePath('Dark.S01E03.eng.sdh.srt')).toMatchObject({ base: 'Dark.S01E03', lang: 'eng', sdh: true })
  })
  it('sem idioma conhecido mantém o nome inteiro como base', () => {
    expect(parseSubtitlePath('Filmes/Interestelar.srt')).toMatchObject({ base: 'Interestelar', lang: undefined })
  })
  it('em pasta de legendas, detecta idioma pelo nome do arquivo', () => {
    expect(parseSubtitlePath('Filme/Subs/Filme.2014/2_Portuguese.srt').lang).toBe('por')
  })
  it('fora de pasta de legendas, não adivinha idioma por palavra do título', () => {
    expect(parseSubtitlePath('The.Italian.Job.2003.srt').lang).toBeUndefined()
  })
})

describe('normalizeLang', () => {
  it.each([['pt-BR', 'por'], ['pob', 'por'], ['fre', 'fra'], ['jpn', 'jpn'], ['und', undefined], [undefined, undefined]])(
    '%s -> %s', (input, out) => expect(normalizeLang(input)).toBe(out)
  )
})

describe('matchSubtitles', () => {
  const videos = [
    { relPath: 'Dark/Season 1/Dark.S01E03.1080p.mkv', episodeCodes: ['S01E03'] },
    { relPath: 'Dark/Season 1/Dark.S01E04.1080p.mkv', episodeCodes: ['S01E04'] },
    { relPath: 'Filmes/Filme.2014/Filme.2014.mkv', episodeCodes: [] }
  ]
  it('associa por mesmo nome, por subpasta Subs e por código de episódio', () => {
    const subs = [
      'Dark/Season 1/Dark.S01E03.1080p.pt-BR.srt',
      'Dark/Season 1/Legendas/Dark.S01E04.1080p.eng.srt',
      'Dark/Season 1/dark_s01e04_legenda.por.srt',
      'Filmes/Filme.2014/Subs/Filme.2014/3_English.srt',
      'Outros/sem-video.srt'
    ].map(parseSubtitlePath)
    const { matches, unmatched } = matchSubtitles(videos, subs)
    expect(matches.get('Dark/Season 1/Dark.S01E03.1080p.mkv')!.map((s) => s.relPath)).toEqual(['Dark/Season 1/Dark.S01E03.1080p.pt-BR.srt'])
    expect(matches.get('Dark/Season 1/Dark.S01E04.1080p.mkv')!.map((s) => s.relPath).sort()).toEqual([
      'Dark/Season 1/Legendas/Dark.S01E04.1080p.eng.srt',
      'Dark/Season 1/dark_s01e04_legenda.por.srt'
    ])
    expect(matches.get('Filmes/Filme.2014/Filme.2014.mkv')!.map((s) => s.lang)).toEqual(['eng'])
    expect(unmatched.map((s) => s.relPath)).toEqual(['Outros/sem-video.srt'])
  })
  it('não associa por código de episódio quando dois vídeos têm o mesmo código', () => {
    const vids = [
      { relPath: 'X/S01E01.720p.mkv', episodeCodes: ['S01E01'] },
      { relPath: 'X/S01E01.1080p.mkv', episodeCodes: ['S01E01'] }
    ]
    const { unmatched } = matchSubtitles(vids, [parseSubtitlePath('X/legenda S01E01.srt')])
    expect(unmatched).toHaveLength(1)
  })
})
