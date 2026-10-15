import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function dbPath(): string {
  return join(app.getPath('userData'), 'brammp4.db')
}

/** Binário embutido no instalador; em desenvolvimento usa vendor/bin ou o PATH. */
export function binPath(exe: string): string {
  const p = app.isPackaged ? join(process.resourcesPath, 'bin', exe) : join(app.getAppPath(), 'vendor', 'bin', exe)
  return existsSync(p) ? p : exe.replace(/\.exe$/i, '')
}
