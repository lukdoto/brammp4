import { app, BrowserWindow, dialog, powerMonitor } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ScanSummary } from '../shared/types'
import { openDatabase } from './db/database'
import * as repo from './db/repo'
import { registerIpc } from './ipc'
import { LibraryMonitor } from './libraries/monitor'
import { readMarker } from './libraries/marker'
import { resolveLibrary } from './libraries/resolve'
import { binPath, dbPath, mpvConfigDir, mpvPath } from './paths'
import { newPipePath } from './player/args'
import { MpvClient } from './player/mpv-client'
import { PlayerService } from './player/service'
import { probeFile } from './scanner/probe'
import { scanLibrary } from './scanner/scan'
import { createScanScheduler } from './scanner/scheduler'

let win: BrowserWindow | null = null
let quitting = false

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
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

function main(): void {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    const db = openDatabase(dbPath())
    // ao abrir, tudo começa offline: o primeiro tick do monitor dispara a varredura do que estiver conectado
    repo.setAllLibrariesOffline(db)

    // relê a biblioteca do banco a cada execução: se o disco voltou com outra letra no meio
    // de uma varredura, a repetição agendada pelo scheduler usa o endereço novo
    const scan = createScanScheduler((id): Promise<ScanSummary> => {
      const lib = repo.listLibraries(db).find((l) => l.id === id)
      if (!lib) return Promise.reject(new Error('biblioteca desconhecida'))
      // binPath dentro da cadeia: binário ausente vira resumo abortado, nunca exceção síncrona
      return Promise.resolve()
        .then(() => {
          const ffprobe = binPath('ffprobe.exe')
          return scanLibrary(lib, {
            db,
            probe: (abs) => probeFile(ffprobe, abs),
            isOnline: async () => (await readMarker(lib.rootPath))?.id === id,
            onProgress: (p) => send('scan:progress', p)
          })
        })
        .catch((err): ScanSummary => {
          console.error('[scan] falhou', id, err)
          return { libraryId: id, aborted: true, videos: 0, probed: 0, series: 0, movies: 0, episodes: 0, seasons: 0, subtitles: 0, unmatched: 0 }
        })
        .then((s) => {
          send('scan:done', s)
          return s
        })
    })

    const player = new PlayerService({
      db,
      mpvExe: mpvPath,
      configDir: mpvConfigDir,
      spawn: (exe, args) => spawn(exe, args, { stdio: 'ignore' }),
      connect: (pipe, o) => MpvClient.connect(pipe, o),
      newPipePath,
      exists: existsSync,
      now: Date.now,
      onState: (s) => {
        send('player:state', s)
        if (!s.playing && !quitting && win && !win.isDestroyed()) win.focus()
      }
    })

    registerIpc({ db, window: () => win, scan, player })

    // reforços além da gravação a cada 5 s (o evento 'shutdown' do powerMonitor não existe no Windows):
    // notebook indo dormir e app sendo fechado com um vídeo tocando
    powerMonitor.on('suspend', () => player.flush())
    let quitDone = false
    app.on('before-quit', (e) => {
      if (quitDone) return
      if (quitting) {
        // outro pedido de saída enquanto grava/encerra o mpv: espera terminar
        e.preventDefault()
        return
      }
      if (!player.active()) return
      e.preventDefault()
      quitting = true
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(fallback)
        quitDone = true
        app.quit()
      }
      // finish sempre roda, mesmo se flushAndStop rejeitar; o timer cobre uma promessa que nunca resolve
      const fallback = setTimeout(finish, 3000)
      void player
        .flushAndStop()
        .catch((err) => console.error('[player] flushAndStop falhou', err))
        .finally(finish)
    })

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
    win?.on('session-end', () => player.flush())
  }).catch((err) => {
    dialog.showErrorBox('brammp4', 'Não foi possível iniciar: ' + (err instanceof Error ? err.message : String(err)))
    app.quit()
  })

  app.on('window-all-closed', () => app.quit())
}

// instância única: um segundo processo não abre o banco, só traz a janela existente para a frente
if (!app.requestSingleInstanceLock()) app.quit()
else main()
