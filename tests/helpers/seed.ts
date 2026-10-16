import { openDatabase, type Db } from '../../src/main/db/database'
import * as repo from '../../src/main/db/repo'

/** Série "Dark" com S01E01..S01E03, um arquivo por episódio (1080p, 1380 s) na biblioteca lib1. */
export function seedSeries(opts: { online?: boolean } = {}): { db: Db; titleId: number; keys: string[]; fileIds: number[] } {
  const db = openDatabase(':memory:')
  repo.upsertLibrary(db, { id: 'lib1', label: 'HD Séries', rootPath: 'E:\\Videos\\Series' })
  if (opts.online === false) repo.setLibraryStatus(db, 'lib1', 'offline')
  const titleId = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark' })
  const keys: string[] = []
  const fileIds: number[] = []
  for (const e of [1, 2, 3]) {
    const key = `local:dark:S01E0${e}`
    repo.upsertItem(db, { key, titleId, season: 1, episode: e })
    fileIds.push(
      repo.upsertFile(db, {
        itemKey: key,
        libraryId: 'lib1',
        relPath: `Dark/Season 1/Dark.S01E0${e}.mkv`,
        size: 1,
        mtimeMs: 1,
        probe: { durationS: 1380, height: 1080, videoCodec: 'hevc', tracks: [] }
      })
    )
    keys.push(key)
  }
  return { db, titleId, keys, fileIds }
}

export function seedMovie(db: Db, name = 'Dune', year = 2021): { titleId: number; key: string; fileId: number } {
  const titleId = repo.upsertTitle(db, { kind: 'movie', localKey: `movie:${name.toLowerCase()}-${year}`, name, year })
  const key = `local:${name.toLowerCase()}-${year}`
  repo.upsertItem(db, { key, titleId, season: null, episode: null })
  const fileId = repo.upsertFile(db, {
    itemKey: key,
    libraryId: 'lib1',
    relPath: `Filmes/${name}.mkv`,
    size: 1,
    mtimeMs: 1,
    probe: { durationS: 9000, height: 1080, videoCodec: 'h264', tracks: [] }
  })
  return { titleId, key, fileId }
}
