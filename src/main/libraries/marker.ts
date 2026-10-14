import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const MARKER = '.brammp4.json'

export interface Marker { id: string; label: string; createdAt: string }

export async function readMarker(dir: string): Promise<Marker | null> {
  try {
    const j = JSON.parse(await readFile(join(dir, MARKER), 'utf8')) as Partial<Marker>
    return typeof j.id === 'string' ? { id: j.id, label: String(j.label ?? ''), createdAt: String(j.createdAt ?? '') } : null
  } catch {
    return null
  }
}

/** Grava o marcador uma única vez e o oculta no Windows (reescrever arquivo oculto falha com EPERM). */
export async function writeMarker(dir: string, label: string): Promise<Marker> {
  const m: Marker = { id: randomUUID(), label, createdAt: new Date().toISOString() }
  const file = join(dir, MARKER)
  await writeFile(file, JSON.stringify(m, null, 2), 'utf8')
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => execFile('attrib', ['+h', file], { windowsHide: true }, () => resolve()))
  }
  return m
}
