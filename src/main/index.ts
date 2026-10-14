import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

app.whenReady().then(() => {
  const row = new DatabaseSync(':memory:').prepare('SELECT sqlite_version() AS v').get()
  console.log('[sqlite-check]', process.versions.node, row)
  const win = new BrowserWindow({ width: 1000, height: 700, webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true } })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
