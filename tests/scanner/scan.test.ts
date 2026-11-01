import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { openDatabase, type Db } from '../../src/main/db/database'
import * as repo from '../../src/main/db/repo'
import { scanLibrary } from '../../src/main/scanner/scan'
import * as meta from '../../src/main/db/metadata'
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

describe('atribuições manuais', () => {
  const scan = () => scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
  const UNMATCHED = 'Filmes/aleatorio/Temporada 1/notas.mkv'
  const unmatchedPaths = () => meta.listUnmatched(db).map((u) => u.relPath)

  it('arquivo sem nome reconhecido aparece em unmatched', async () => {
    await scan()
    expect(unmatchedPaths()).toContain(UNMATCHED)
  })

  it('após setAssignment como episódio, a varredura cria a série, o item local:<slug>:S02E05 e remove o arquivo de unmatched', async () => {
    meta.setAssignment(db, 'lib1', UNMATCHED, { kind: 'episode', series: 'Série Nova', season: 2, episode: 5 })
    const s = await scan()
    expect(s.unmatched).toBe(0)
    expect(unmatchedPaths()).not.toContain(UNMATCHED)
    const nova = repo.getCatalog(db).series.find((c) => c.name === 'Série Nova')!
    expect(repo.getTitleDetail(db, nova.id)!.items.map((i) => i.key)).toEqual(['local:serie-nova:S02E05'])
  })

  it('atribuição como filme com ano gera local:<slug>-<ano>', async () => {
    meta.setAssignment(db, 'lib1', UNMATCHED, { kind: 'movie', title: 'Filme Raro', year: 1999 })
    await scan()
    const m = repo.getCatalog(db).movies.find((c) => c.name === 'Filme Raro')!
    expect(m.year).toBe(1999)
    expect(repo.getTitleDetail(db, m.id)!.items.map((i) => i.key)).toEqual(['local:filme-raro-1999'])
  })

  it('reescanear com a atribuição não duplica itens', async () => {
    meta.setAssignment(db, 'lib1', UNMATCHED, { kind: 'episode', series: 'Série Nova', season: 2, episode: 5 })
    await scan()
    await scan()
    expect(repo.getCatalog(db).series.filter((c) => c.name === 'Série Nova')).toHaveLength(1)
    const n = db.prepare('SELECT COUNT(*) AS n FROM items WHERE key = ?').get('local:serie-nova:S02E05') as { n: number }
    const f = db.prepare('SELECT COUNT(*) AS n FROM files WHERE rel_path = ?').get(UNMATCHED) as { n: number }
    expect([n.n, f.n]).toEqual([1, 1])
  })

  it('atribuição de arquivo que sumiu não quebra a varredura', async () => {
    meta.setAssignment(db, 'lib1', 'nao/existe.mkv', { kind: 'movie', title: 'Fantasma' })
    const s = await scan()
    expect(s.aborted).toBe(false)
    expect(repo.getCatalog(db).movies.map((c) => c.name)).not.toContain('Fantasma')
  })

  it('atribuir a uma série existente reutiliza o título (mesmo localKey)', async () => {
    await scan()
    meta.setAssignment(db, 'lib1', UNMATCHED, { kind: 'episode', series: 'La Casa de Papel', season: 3, episode: 1 })
    await scan()
    const cat = repo.getCatalog(db)
    expect(cat.series).toHaveLength(1)
    const keys = repo.getTitleDetail(db, cat.series[0]!.id)!.items.map((i) => i.key)
    expect(keys).toContain('local:la-casa-de-papel:S03E01')
    expect(keys).toContain('local:la-casa-de-papel:S01E01')
  })
})
