import { BrowserWindow, dialog, ipcMain, type MessageBoxOptions } from 'electron'
import { basename } from 'node:path'
import type { AssignResult, PlayerState, PlayRequest, PlayResult, ReclassifyResult, ScanSummary, SetKeyResult, TmdbSearchResult, TmdbStatus, UnmatchedFile } from '../shared/types'
import type { Db } from './db/database'
import { listContinueWatching } from './db/progress'
import * as metaDb from './db/metadata'
import * as repo from './db/repo'
import { readMarker, writeMarker } from './libraries/marker'
import { findOfflineTwin } from './libraries/twin'
import { getPlayOptions } from './player/options'
import { parsePlayRequest } from './player/request'
import { parseAssignTmdbRequest, parseReclassifyRequest } from './metadata/requests'
import { runTmdbSearch, toAssignResult } from './metadata/results'
import { clearTmdbKey, saveTmdbKey, type Cipher } from './metadata/secrets'
import type { MetadataService } from './metadata/service'
import { setTmdbKey } from './metadata/setkey'
import { createTmdbClient } from './metadata/tmdb'

export interface IpcContext {
  db: Db
  window: () => BrowserWindow | null
  scan: (libraryId: string) => Promise<ScanSummary>
  player: { play(req: PlayRequest): Promise<PlayResult>; state(): PlayerState }
  metadata: Pick<MetadataService, 'status' | 'sync' | 'search' | 'assign'>
  cipher: Cipher
  /** Chamado depois de salvar ou apagar a chave: descarta o cliente guardado. */
  onKeyChanged: () => void
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle('libraries:list', () => repo.listLibraries(ctx.db))

  ipcMain.handle('libraries:add', async (_e, rawLabel: unknown) => {
    const label = typeof rawLabel === 'string' ? rawLabel : ''
    const win = ctx.window()
    const opts = { title: 'Escolha a pasta do catálogo', properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const dir = r.filePaths[0]
    if (r.canceled || !dir) return null
    const typed = label.trim()
    const existing = await readMarker(dir)
    let name = typed || existing?.label || basename(dir)
    let marker = existing
    if (!marker) {
      // marcador apagado: oferece reaproveitar a biblioteca offline que apontava para esta mesma pasta
      const twin = findOfflineTwin(repo.listLibraries(ctx.db), dir)
      let reuse = false
      if (twin) {
        const box: MessageBoxOptions = {
          type: 'question',
          buttons: ['Reutilizar', 'Criar nova'],
          defaultId: 0,
          cancelId: 1,
          message: `Esta pasta parece ser a biblioteca “${twin.label}”, que perdeu o arquivo de identificação. Reutilizar o catálogo e o progresso dela?`
        }
        const ans = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
        reuse = ans.response === 0
      }
      if (reuse && twin) {
        name = typed || twin.label
        marker = await writeMarker(dir, name, twin.id)
      } else marker = await writeMarker(dir, name)
    }
    const id = marker.id
    repo.upsertLibrary(ctx.db, { id, label: name, rootPath: dir })
    ctx.scan(id).catch((err) => console.error('[scan] falhou', id, err))
    return repo.listLibraries(ctx.db).find((l) => l.id === id) ?? null
  })

  ipcMain.handle('libraries:rescan', (_e, id: unknown) => {
    if (typeof id !== 'string') return Promise.reject(new Error('id inválido'))
    return ctx.scan(id)
  })
  ipcMain.handle('catalog:get', () => repo.getCatalog(ctx.db))
  ipcMain.handle('title:get', (_e, id: unknown) => (Number.isInteger(id) ? repo.getTitleDetail(ctx.db, id as number) : null))

  ipcMain.handle('continue:list', () => listContinueWatching(ctx.db))
  ipcMain.handle('play:options', (_e, key: unknown) => (typeof key === 'string' && key.length <= 500 ? getPlayOptions(ctx.db, key) : null))
  ipcMain.handle('play:start', (_e, raw: unknown): Promise<PlayResult> | PlayResult => {
    const req = parsePlayRequest(raw)
    return req ? ctx.player.play(req) : { ok: false, error: 'invalid' }
  })
  ipcMain.handle('play:state', () => ctx.player.state())

  ipcMain.handle('tmdb:status', (): TmdbStatus => ctx.metadata.status())

  ipcMain.handle('tmdb:set-key', (_e, raw: unknown): Promise<SetKeyResult> =>
    setTmdbKey(raw, {
      encryptionAvailable: () => ctx.cipher.available(),
      validate: (key) => createTmdbClient({ key }).validate(),
      save: (key) => saveTmdbKey(ctx.db, ctx.cipher, key),
      onKeyChanged: ctx.onKeyChanged,
      sync: () => {
        ctx.metadata.sync().catch((err) => console.error('[metadata] sync falhou', err instanceof Error ? err.name : 'erro'))
      }
    })
  )

  ipcMain.handle('tmdb:clear-key', () => {
    clearTmdbKey(ctx.db)
    ctx.onKeyChanged()
  })

  ipcMain.handle('tmdb:search', (_e, raw: unknown): Promise<TmdbSearchResult> =>
    runTmdbSearch(raw, (kind, query, year) => ctx.metadata.search(kind, query, year))
  )

  ipcMain.handle('tmdb:assign', async (_e, raw: unknown): Promise<AssignResult> => {
    const req = parseAssignTmdbRequest(raw)
    if (!req) return { ok: false, error: 'invalid' }
    try {
      return toAssignResult(await ctx.metadata.assign(req.titleId, req.tmdbId))
    } catch (err) {
      console.error('[metadata] assign falhou', err instanceof Error ? err.name : 'erro')
      return { ok: false, error: 'network' }
    }
  })

  ipcMain.handle('unmatched:list', (): UnmatchedFile[] =>
    metaDb.listUnmatched(ctx.db).map(({ libraryId, libraryLabel, relPath }) => ({ libraryId, libraryLabel, relPath }))
  )

  ipcMain.handle('unmatched:reclassify', async (_e, raw: unknown): Promise<ReclassifyResult> => {
    const req = parseReclassifyRequest(raw)
    if (!req) return { ok: false, error: 'invalid' }
    const lib = repo.listLibraries(ctx.db).find((l) => l.id === req.libraryId)
    if (!lib || lib.status !== 'online') return { ok: false, error: 'offline' }
    // série escolhida na lista: grava o nome que reproduz a local_key dela (o mostrado pode ser o do TMDB)
    metaDb.setAssignment(ctx.db, req.libraryId, req.relPath, metaDb.targetForExistingSeries(ctx.db, req.target, req.titleId))
    try {
      await ctx.scan(req.libraryId)
    } catch (err) {
      console.error('[scan] falhou após reclassificar', req.libraryId, err)
    }
    return { ok: true }
  })
}
