import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'node:path'
import type { ScanSummary } from '../shared/types'
import type { Db } from './db/database'
import * as repo from './db/repo'
import { readMarker, writeMarker } from './libraries/marker'

export interface IpcContext {
  db: Db
  window: () => BrowserWindow | null
  scan: (libraryId: string) => Promise<ScanSummary>
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
    const name = typed || existing?.label || basename(dir)
    const marker = existing ?? (await writeMarker(dir, name))
    repo.upsertLibrary(ctx.db, { id: marker.id, label: name, rootPath: dir })
    ctx.scan(marker.id).catch((err) => console.error('[scan] falhou', marker.id, err))
    return repo.listLibraries(ctx.db).find((l) => l.id === marker.id) ?? null
  })

  ipcMain.handle('libraries:rescan', (_e, id: unknown) => {
    if (typeof id !== 'string') return Promise.reject(new Error('id inválido'))
    return ctx.scan(id)
  })
  ipcMain.handle('catalog:get', () => repo.getCatalog(ctx.db))
  ipcMain.handle('title:get', (_e, id: unknown) => (Number.isInteger(id) ? repo.getTitleDetail(ctx.db, id as number) : null))
}
