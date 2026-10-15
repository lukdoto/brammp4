import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { openDatabase, type Db } from '../../src/main/db/database'
import * as repo from '../../src/main/db/repo'
import { scanLibrary } from '../../src/main/scanner/scan'
import type { ProbeResult } from '../../src/shared/types'

let root: string
let db: Db
const lib = () => ({ id: 'lib1', rootPath: root })
const touch = (rel: string, content = 'x') => {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
}
const okProbe = async (): Promise<ProbeResult> => ({
  height: 1080, videoCodec: 'hevc', durationS: 100,
  tracks: [{ type: 'audio', streamIndex: 1, typeIndex: 1, codec: 'aac', lang: 'por', isDefault: true, isForced: false }]
})

beforeEach(() => {
  vi.restoreAllMocks()
  root = mkdtempSync(join(tmpdir(), 'brammp4-lib-'))
  db = openDatabase(':memory:')
  repo.upsertLibrary(db, { id: 'lib1', label: 'HD Séries', rootPath: root })
  touch('Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E01.mkv')
  touch('Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E01.pt-BR.srt')
  touch('Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E02.mkv')
  touch('Séries/La Casa de Papel/Extras/Making of.mkv')
  touch('Filmes/Interestelar (2014)/Interestelar.2014.1080p.mkv')
  touch('Filmes/Interestelar (2014)/Interestelar.2014.sample.mkv')
  touch('Filmes/aleatorio/Temporada 1/notas.mkv')
})

describe('scanLibrary', () => {
  it('varredura inicial: séries, filmes, legendas e não identificados', async () => {
    const progress: number[] = []
    const s = await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true, onProgress: (p) => progress.push(p.done) })
    expect(s).toMatchObject({ aborted: false, videos: 4, probed: 3, series: 1, movies: 1, episodes: 2, subtitles: 1, unmatched: 1 })
    expect(progress.at(-1)).toBe(3)
    const cat = repo.getCatalog(db)
    expect(cat.series.map((c) => c.name)).toEqual(['La Casa de Papel'])
    expect(cat.movies.map((c) => [c.name, c.year])).toEqual([['Interestelar', 2014]])
    const ep1 = repo.getTitleDetail(db, cat.series[0]!.id)!.items[0]!.files[0]!
    expect(ep1).toMatchObject({ height: 1080, audioCount: 1, subCount: 1 })
  })

  it('segunda varredura não roda ffprobe em arquivos inalterados', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    let calls = 0
    const s = await scanLibrary(lib(), { db, probe: async () => { calls++; return okProbe() }, isOnline: async () => true })
    expect(calls).toBe(0)
    expect(s.probed).toBe(0)
  })

  it('arquivo alterado é lido de novo', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    const f = join(root, 'Filmes/Interestelar (2014)/Interestelar.2014.1080p.mkv')
    writeFileSync(f, 'conteúdo maior')
    utimesSync(f, new Date(), new Date(Date.now() + 5000))
    let calls = 0
    await scanLibrary(lib(), { db, probe: async () => { calls++; return okProbe() }, isOnline: async () => true })
    expect(calls).toBe(1)
  })

  it('vídeo que o ffprobe não lê continua no catálogo, sem faixas', async () => {
    const s = await scanLibrary(lib(), { db, probe: async () => { throw new Error('corrompido') }, isOnline: async () => true })
    expect(s.aborted).toBe(false)
    const cat = repo.getCatalog(db)
    expect(repo.getTitleDetail(db, cat.movies[0]!.id)!.items[0]!.files[0]).toMatchObject({ audioCount: 0, height: undefined })
  })

  it('disco removido durante a leitura: nada é marcado como sumido', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    rmSync(join(root, 'Filmes'), { recursive: true, force: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => false })
    expect(s.aborted).toBe(true)
    expect(repo.getCatalog(db).movies).toHaveLength(1)
  })

  it('pasta raiz inacessível: aborta sem alterar o banco', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = await scanLibrary({ id: 'lib1', rootPath: join(root, 'nao-existe') }, { db, probe: okProbe, isOnline: async () => true })
    expect(s.aborted).toBe(true)
    expect(repo.getCatalog(db).series).toHaveLength(1)
    expect(spy).toHaveBeenCalled()
  })

  it('falha do ffprobe não fica em cache: a próxima varredura tenta de novo', async () => {
    await scanLibrary(lib(), { db, probe: async () => { throw new Error('travado') }, isOnline: async () => true })
    const s = await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    expect(s.probed).toBeGreaterThan(0)
    const cat = repo.getCatalog(db)
    expect(repo.getTitleDetail(db, cat.movies[0]!.id)!.items[0]!.files[0]).toMatchObject({ height: 1080 })
  })

  it('arquivo apagado com o disco conectado some do catálogo', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    rmSync(join(root, 'Filmes'), { recursive: true, force: true })
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    expect(repo.getCatalog(db).movies).toHaveLength(0)
  })
})
