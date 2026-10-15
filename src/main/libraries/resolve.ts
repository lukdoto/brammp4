import { win32 } from 'node:path'
import { readMarker as realReadMarker, type Marker } from './marker'

export type Resolved = { status: 'online'; rootPath: string } | { status: 'offline' }

export const DEFAULT_LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export async function resolveLibrary(
  lib: { id: string; rootPath: string },
  deps: { readMarker?: (dir: string) => Promise<Marker | null>; letters?: string[] } = {}
): Promise<Resolved> {
  const read = deps.readMarker ?? realReadMarker
  const letters = deps.letters ?? DEFAULT_LETTERS
  if ((await read(lib.rootPath))?.id === lib.id) return { status: 'online', rootPath: lib.rootPath }
  const m = /^([A-Za-z]):([\\/].*)$/.exec(lib.rootPath)
  if (!m) return { status: 'offline' }
  const current = m[1]!.toUpperCase()
  const candidates = letters.filter((l) => l.toUpperCase() !== current).map((l) => `${l}:${m[2]}`)
    .filter((c) => win32.isAbsolute(c))
  const markers = await Promise.all(candidates.map((c) => read(c).catch(() => null)))
  const idx = markers.findIndex((mk) => mk?.id === lib.id)
  return idx >= 0 ? { status: 'online', rootPath: candidates[idx]! } : { status: 'offline' }
}
