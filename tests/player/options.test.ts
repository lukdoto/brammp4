import { describe, it, expect } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { saveProgress, setPrefs } from '../../src/main/db/progress'
import { getPlayOptions } from '../../src/main/player/options'
import { seedSeries } from '../helpers/seed'

describe('getPlayOptions', () => {
  it('item desconhecido ou sem arquivos devolve null', () => {
    const { db } = seedSeries()
    expect(getPlayOptions(db, 'nao-existe')).toBeNull()
  })

  it('lista faixas, escolhe os padrões pelas preferências e calcula de onde continuar', () => {
    const { db, titleId, keys, fileIds } = seedSeries()
    repo.replaceEmbeddedTracks(db, fileIds[0]!, [
      { type: 'audio', streamIndex: 1, typeIndex: 1, codec: 'aac', lang: 'jpn', isDefault: true, isForced: false },
      { type: 'audio', streamIndex: 2, typeIndex: 2, codec: 'ac3', lang: 'por', isDefault: false, isForced: false },
      { type: 'sub', streamIndex: 3, typeIndex: 1, codec: 'subrip', lang: 'eng', isDefault: false, isForced: false }
    ])
    repo.replaceExternalSubs(db, fileIds[0]!, [{ relPath: 'Dark/Season 1/Dark.S01E01.por.srt', lang: 'por', forced: false, sdh: false, codec: 'srt' }])
    setPrefs(db, titleId, { audioLang: 'por', subLang: 'por' })
    saveProgress(db, { itemKey: keys[0]!, positionS: 1834, durationS: 1380 * 2, watched: false })

    const o = getPlayOptions(db, keys[0]!)!
    expect(o).toMatchObject({ itemKey: keys[0], titleName: 'Dark', kind: 'series', season: 1, episode: 1, resumeFromS: 1829, defaultFileId: fileIds[0] })
    expect(o.files).toHaveLength(1)
    const f = o.files[0]!
    expect(f.audio.map((a) => [a.typeIndex, a.lang])).toEqual([[1, 'jpn'], [2, 'por']])
    expect(f.subs.map((s) => [s.source, s.typeIndex ?? s.externalPath])).toEqual([['embedded', 1], ['external', 'Dark/Season 1/Dark.S01E01.por.srt']])
    expect(f.defaults).toEqual({ audioTypeIndex: 2, sub: { kind: 'external', relPath: 'Dark/Season 1/Dark.S01E01.por.srt' } })
  })

  it('assistido recomeça do zero', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 1370, durationS: 1380, watched: true })
    expect(getPlayOptions(db, keys[0]!)!.resumeFromS).toBe(0)
  })

  it('duas versões: a online de maior resolução vem primeiro e é a padrão; a offline fica listada como indisponível', () => {
    const { db, keys } = seedSeries()
    repo.upsertLibrary(db, { id: 'lib2', label: 'HD Filmes', rootPath: 'F:\\Videos' })
    repo.setLibraryStatus(db, 'lib2', 'offline')
    const offlineId = repo.upsertFile(db, { itemKey: keys[0]!, libraryId: 'lib2', relPath: 'Dark.S01E01.2160p.mkv', size: 1, mtimeMs: 1, probe: { height: 2160, tracks: [] } })
    const onlineLow = repo.upsertFile(db, { itemKey: keys[0]!, libraryId: 'lib1', relPath: 'Dark/Dark.S01E01.720p.mkv', size: 1, mtimeMs: 1, probe: { height: 720, tracks: [] } })
    const o = getPlayOptions(db, keys[0]!)!
    expect(o.files.map((f) => [f.fileId === offlineId ? 'off2160' : f.height, f.available])).toEqual([[1080, true], [720, true], ['off2160', false]])
    expect(o.defaultFileId).not.toBe(offlineId)
    expect(o.defaultFileId).not.toBe(onlineLow)
  })

  it('só versões em disco desconectado: nenhuma é padrão', () => {
    const { db, keys } = seedSeries({ online: false })
    const o = getPlayOptions(db, keys[0]!)!
    expect(o.defaultFileId).toBeNull()
    expect(o.files.every((f) => !f.available)).toBe(true)
  })

  it('arquivos marcados como ausentes não entram', () => {
    const { db, keys, fileIds } = seedSeries()
    repo.markMissing(db, 'lib1', new Set([fileIds[1]!, fileIds[2]!]))
    expect(getPlayOptions(db, keys[0]!)).toBeNull()
  })
})
