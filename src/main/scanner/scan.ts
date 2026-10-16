import { join } from 'node:path'
import type { ProbeResult, ScanProgress, ScanSummary } from '../../shared/types'
import type { Db } from '../db/database'
import { tx } from '../db/database'
import * as repo from '../db/repo'
import { parseVideoPath, extOf } from '../parser/video'
import { titleOf, itemsOf, episodeCodesOf } from '../parser/keys'
import { parseSubtitlePath, matchSubtitles } from '../parser/subtitle'
import { walkLibrary } from './walk'

export interface ScanDeps {
  db: Db
  probe: (absPath: string) => Promise<ProbeResult>
  isOnline: () => Promise<boolean>
  onProgress?: (p: ScanProgress) => void
  concurrency?: number
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!)
  })
  await Promise.all(workers)
}

const aborted = (libraryId: string): ScanSummary => ({
  libraryId, aborted: true, videos: 0, probed: 0, series: 0, movies: 0, episodes: 0, seasons: 0, subtitles: 0, unmatched: 0
})

/**
 * Lê a biblioteca, roda ffprobe só no que é novo ou mudou e grava tudo numa transação.
 * Se o disco sumir no meio, aborta sem gravar: nada é marcado como sumido por engano.
 */
export async function scanLibrary(lib: { id: string; rootPath: string }, deps: ScanDeps): Promise<ScanSummary> {
  const { db } = deps
  let walked: Awaited<ReturnType<typeof walkLibrary>>
  try {
    walked = await walkLibrary(lib.rootPath)
  } catch (err) {
    console.error('[scan] varredura abortada', lib.id, err)
    return aborted(lib.id)
  }

  const existing = new Map(repo.listLibraryFiles(db, lib.id).map((f) => [`${f.relPath}|${f.itemKey}`, f]))
  const parsed = walked.videos.map((v) => ({ ...v, parsed: parseVideoPath(v.relPath) }))
  const recognized = parsed.filter((v) => v.parsed !== null)
  const unmatchedVideos = parsed.filter((v) => v.parsed === null).map((v) => ({ relPath: v.relPath, reason: 'nome não reconhecido' }))

  // undefined = reaproveitar leitura anterior; null = ffprobe falhou
  const probes = new Map<string, ProbeResult | null | undefined>()
  let done = 0
  await pool(recognized, Math.max(1, deps.concurrency ?? 4), async (v) => {
    const firstKey = itemsOf(v.parsed!)[0]!.key
    const prev = existing.get(`${v.relPath}|${firstKey}`)
    if (prev && prev.size === v.size && prev.mtimeMs === v.mtimeMs && prev.probedAt) probes.set(v.relPath, undefined)
    else {
      try {
        probes.set(v.relPath, await deps.probe(join(lib.rootPath, v.relPath)))
      } catch {
        probes.set(v.relPath, null)
      }
    }
    done++
    deps.onProgress?.({ libraryId: lib.id, done, total: recognized.length, current: v.relPath })
  })

  if (!(await deps.isOnline())) return aborted(lib.id)

  const subs = matchSubtitles(
    recognized.map((v) => ({ relPath: v.relPath, episodeCodes: episodeCodesOf(v.parsed!) })),
    walked.subs.map(parseSubtitlePath)
  )

  tx(db, () => {
    const seen = new Set<number>()
    for (const v of recognized) {
      const p = v.parsed!
      const titleId = repo.upsertTitle(db, titleOf(p))
      const probe = probes.get(v.relPath)
      for (const item of itemsOf(p)) {
        repo.upsertItem(db, { ...item, titleId })
        const fileId = repo.upsertFile(db, { itemKey: item.key, libraryId: lib.id, relPath: v.relPath, size: v.size, mtimeMs: v.mtimeMs, probe })
        seen.add(fileId)
        if (probe !== undefined) repo.replaceEmbeddedTracks(db, fileId, probe?.tracks ?? [])
        repo.replaceExternalSubs(
          db,
          fileId,
          (subs.matches.get(v.relPath) ?? []).map((s) => ({ relPath: s.relPath, lang: s.lang, forced: s.forced, sdh: s.sdh, codec: extOf(s.relPath).slice(1) }))
        )
      }
    }
    repo.markMissing(db, lib.id, seen)
    repo.replaceUnmatched(db, lib.id, [
      ...unmatchedVideos,
      ...subs.unmatched.map((s) => ({ relPath: s.relPath, reason: 'legenda sem vídeo correspondente' }))
    ])
    repo.setLastScan(db, lib.id)
  })

  const probed = [...probes.values()].filter((p) => p !== undefined).length
  return { libraryId: lib.id, aborted: false, videos: walked.videos.length, probed, ...repo.librarySummary(db, lib.id) }
}
