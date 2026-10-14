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
  const m = /^([A-Za-z]):(.*)$/.exec(lib.rootPath)
  if (!m) return { status: 'offline' }
  const current = m[1]!.toUpperCase()
  for (const letter of letters) {
    if (letter === current) continue
    const candidate = `${letter}:${m[2]}`
    if ((await read(candidate))?.id === lib.id) return { status: 'online', rootPath: candidate }
  }
  return { status: 'offline' }
}
