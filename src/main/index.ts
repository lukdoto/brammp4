import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import type { ScanSummary } from '../shared/types'
import { openDatabase } from './db/database'
import * as repo from './db/repo'
import { registerIpc } from './ipc'
import { LibraryMonitor } from './libraries/monitor'
import { readMarker } from './libraries/marker'
import { resolveLibrary } from './libraries/resolve'
import { binPath, dbPath } from './paths'
import { probeFile } from './scanner/probe'
import { scanLibrary } from './scanner/scan'

let win: BrowserWindow | null = null

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

app.whenReady().then(() => {
  const db = openDatabase(dbPath())
  // ao abrir, tudo começa offline: o primeiro tick do monitor dispara a varredura do que estiver conectado
  repo.setAllLibrariesOffline(db)

  const running = new Map<string, Promise<ScanSummary>>()
  const scan = (id: string): Promise<ScanSummary> => {
    const current = running.get(id)
    if (current) return current
    const lib = repo.listLibraries(db).find((l) => l.id === id)
    if (!lib) return Promise.reject(new Error('biblioteca desconhecida'))
    const ffprobe = binPath('ffprobe.exe')
    const job = scanLibrary(lib, {
      db,
      probe: (abs) => probeFile(ffprobe, abs),
      isOnline: async () => (await readMarker(lib.rootPath))?.id === id,
      onProgress: (p) => send('scan:progress', p)
    })
      .catch((err): ScanSummary => {
        console.error('[scan] falhou', id, err)
        return { libraryId: id, aborted: true, videos: 0, probed: 0, series: 0, movies: 0, episodes: 0, subtitles: 0, unmatched: 0 }
      })
      .then((s) => {
        send('scan:done', s)
        return s
      })
      .finally(() => running.delete(id))
    running.set(id, job)
    return job
  }

  registerIpc({ db, window: () => win, scan })

  const monitor = new LibraryMonitor({
    intervalMs: 3000,
    list: () => repo.listLibraries(db),
    resolve: (lib) => resolveLibrary(lib),
    onChange: (id, r) => {
      if (r.status === 'online') repo.setLibraryStatus(db, id, 'online', r.rootPath)
      else repo.setLibraryStatus(db, id, 'offline')
      const view = repo.listLibraries(db).find((l) => l.id === id)
      if (view) send('libraries:status', view)
      if (r.status === 'online') scan(id).catch((err) => console.error('[scan] falhou', id, err))
    }
  })
  monitor.start()
  app.on('before-quit', () => monitor.stop())

  createWindow()
}).catch((err) => {
  dialog.showErrorBox('brammp4', 'Não foi possível iniciar: ' + (err instanceof Error ? err.message : String(err)))
  app.quit()
})

app.on('window-all-closed', () => app.quit())
