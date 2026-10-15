import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { openDatabase, type Db } from '../../src/main/db/database'
import * as repo from '../../src/main/db/repo'
import { scanLibrary } from '../../src/main/scanner/scan'
import type { ProbeResult } from '../../src/shared/types'

let root: string
let db: Db
const lib = () => ({ id: 'lib1', rootPath: root })
const touch = (rel: string) => {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, 'x')
}
const probe = async (): Promise<ProbeResult> => ({ height: 1080, videoCodec: 'hevc', durationS: 100, tracks: [] })
const scan = () => scanLibrary(lib(), { db, probe, isOnline: async () => true })

const AV = 'Avatar a Lenda de Aang'
const RELEASE = '[WF] Sousou no Frieren [BD 1080p x265 OPUS][DUAL]'
const TAIL = '[BD 1080p x265 OPUS][DUAL]'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brammp4-layouts-'))
  db = openDatabase(':memory:')
  repo.upsertLibrary(db, { id: 'lib1', label: 'HD', rootPath: root })
  touch(`${AV}/1 Livro Um_ Água/1x01_-_-By_Fulano_-_SITE.COM[1].mkv`)
  touch(`${AV}/1 Livro Um_ Água/1x02 - -By Fulano - SITE.COM.mkv`)
  touch(`${AV}/2 Livro Dois_ Terra/episódio 1 - O Estado Avatar.avi`)
  touch(`${AV}/2 Livro Dois_ Terra/episódio 10 - A Biblioteca.avi`)
  touch(`${AV}/3 Livro Três_ Fogo/episódio 10 - O Dia Do Sol Negro (1ª Parte - A Invasão).avi`)
  touch(`${AV}/Avatar.Aang.The.Last.Airbender.2026.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H265-GRP.DUAL-x.mkv`)
  touch('cowboy bebop/Cowboy.Bebop.S01E01.1080p.BluRay.FLAC.5.1.x264-GRP.TRIAL-x-006.mkv')
  touch('cowboy bebop/Cowboy.Bebop.S01E02.1080p.BluRay.FLAC.5.1.x264-GRP.TRIAL-x-006.mkv')
  touch('Duna/Dune.2021.1080p.AMZN.WEB-DL.DDP5.1.H.264.DUAL-GRP.mkv')
  touch('Duna/Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.H264.DUAL-GRP.mkv')
  touch(`Frieren/${RELEASE}/[WF] Sousou no Frieren - 01 ${TAIL}[11F8B077].mkv`)
  touch(`Frieren/${RELEASE}/[WF] Sousou no Frieren - 28 ${TAIL}[7DA1D64C].mkv`)
  touch('Frieren/[S.A]_[Wf]_-_Sousou No Frieren 2_-_01 [SD].mp4')
  touch('X-Men 97/S1/1x1.mp4')
  touch('X-Men 97/S1/1x10.mp4')
  touch('X-Men 97/S2/ep 1.mkv')
  touch('X-Men 97/S2/ep 9.mkv')
})

const seasonsOf = (id: number) => {
  const out: Record<number, number> = {}
  for (const i of repo.getTitleDetail(db, id)!.items) out[i.season!] = (out[i.season!] ?? 0) + 1
  return out
}

describe('scanLibrary com os layouts reais', () => {
  it('catálogo: 4 séries, 3 filmes, nada não identificado', async () => {
    const s = await scan()
    expect(s).toMatchObject({ aborted: false, videos: 17, series: 4, movies: 3, episodes: 14, unmatched: 0 })
    const cat = repo.getCatalog(db)
    expect(cat.series.map((c) => c.name)).toEqual([AV, 'cowboy bebop', 'Frieren', 'X-Men 97'])
    expect(cat.movies.map((c) => [c.name, c.year])).toEqual([
      ['Avatar Aang The Last Airbender', 2026],
      ['Dune', 2021],
      ['Dune Part Two', 2024]
    ])
    const byName = Object.fromEntries(cat.series.map((c) => [c.name, c.id]))
    expect(seasonsOf(byName[AV]!)).toEqual({ 1: 2, 2: 2, 3: 1 })
    expect(seasonsOf(byName['cowboy bebop']!)).toEqual({ 1: 2 })
    expect(seasonsOf(byName['Frieren']!)).toEqual({ 1: 2, 2: 1 })
    expect(seasonsOf(byName['X-Men 97']!)).toEqual({ 1: 2, 2: 2 })
  })

  it('título do episódio fica salvo; sem título, não há name', async () => {
    await scan()
    const av = repo.getCatalog(db).series.find((c) => c.name === AV)!
    const items = repo.getTitleDetail(db, av.id)!.items
    const find = (s: number, e: number) => items.find((i) => i.season === s && i.episode === e)!
    expect(find(2, 1).name).toBe('O Estado Avatar')
    expect(find(3, 10).name).toBe('O Dia Do Sol Negro (1ª Parte - A Invasão)')
    expect(find(1, 1).name).toBeUndefined()
  })

  it('biblioteca com linhas antigas de chaves erradas: só os títulos novos ficam visíveis', async () => {
    const oldFiles: [string, string, string, string][] = [
      ['series:1-livro-um-agua', '1 Livro Um_ Água', 'local:1-livro-um-agua:S01E01', `${AV}/1 Livro Um_ Água/1x01_-_-By_Fulano_-_SITE.COM[1].mkv`],
      ['movie:episodio-1-o-estado-avatar', 'episódio 1 - O Estado Avatar', 'local:episodio-1-o-estado-avatar',
        `${AV}/2 Livro Dois_ Terra/episódio 1 - O Estado Avatar.avi`],
      ['movie:sousou-no-frieren-01', 'Sousou no Frieren - 01', 'local:sousou-no-frieren-01',
        `Frieren/${RELEASE}/[WF] Sousou no Frieren - 01 ${TAIL}[11F8B077].mkv`]
    ]
    for (const [localKey, name, key, rel] of oldFiles) {
      const kind = localKey.startsWith('series') ? 'series' : 'movie'
      const titleId = repo.upsertTitle(db, { kind, localKey, name })
      repo.upsertItem(db, { key, titleId, season: kind === 'series' ? 1 : null, episode: kind === 'series' ? 1 : null })
      repo.upsertFile(db, { itemKey: key, libraryId: 'lib1', relPath: rel, size: 1, mtimeMs: 1, probe: { tracks: [] } })
    }
    expect(repo.getCatalog(db).movies).toHaveLength(2)
    const s = await scan()
    expect(s).toMatchObject({ series: 4, movies: 3, unmatched: 0 })
    const cat = repo.getCatalog(db)
    expect(cat.series.map((c) => c.name)).toEqual([AV, 'cowboy bebop', 'Frieren', 'X-Men 97'])
    expect(cat.movies.map((c) => c.name)).toEqual(['Avatar Aang The Last Airbender', 'Dune', 'Dune Part Two'])
    await expect(scan()).resolves.toMatchObject({ aborted: false, series: 4, movies: 3 })
  })
})
