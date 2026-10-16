import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function dbPath(): string {
  return join(app.getPath('userData'), 'brammp4.db')
}

/** Binário embutido no instalador; em desenvolvimento usa vendor/bin ou o PATH; empacotado nunca cai no PATH. */
export function binPath(exe: string): string {
  const p = app.isPackaged ? join(process.resourcesPath, 'bin', exe) : join(app.getAppPath(), 'vendor', 'bin', exe)
  if (existsSync(p)) return p
  if (app.isPackaged) throw new Error('binário ausente: ' + exe)
  return exe.replace(/\.exe$/i, '')
}

function resource(...parts: string[]): string {
  return app.isPackaged ? join(process.resourcesPath, ...parts) : join(app.getAppPath(), 'vendor', ...parts)
}

/** mpv embutido (resources/mpv/mpv.exe; em desenvolvimento, vendor/mpv/mpv.exe). Nunca cai no PATH. */
export function mpvPath(): string {
  const p = resource('mpv', 'mpv.exe')
  if (!existsSync(p)) throw new Error('mpv ausente')
  return p
}

/** Pasta de configuração própria do app (uosc e opções), separada do mpv que o usuário possa ter. */
export function mpvConfigDir(): string {
  const p = resource('mpv-config')
  if (!existsSync(p)) throw new Error('configuração do mpv ausente')
  return p
}
