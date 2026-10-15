import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { extOf, isIgnored, VIDEO_EXTS } from '../parser/video'
import { SUB_EXTS } from '../parser/subtitle'

export interface WalkEntry { relPath: string; size: number; mtimeMs: number }

/** Lista vídeos e legendas da biblioteca. Lança erro se a pasta sumir no meio (disco removido). */
export async function walkLibrary(root: string): Promise<{ videos: WalkEntry[]; subs: string[] }> {
  const videos: WalkEntry[] = []
  const subs: string[] = []
  async function visit(relDir: string): Promise<void> {
    const entries = await readdir(join(root, relDir), { withFileTypes: true })
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (isIgnored(rel)) continue
      if (e.isDirectory()) await visit(rel)
      else if (e.isFile()) {
        const ext = extOf(e.name)
        if (VIDEO_EXTS.has(ext)) {
          const st = await stat(join(root, rel))
          videos.push({ relPath: rel, size: st.size, mtimeMs: Math.trunc(st.mtimeMs) })
        } else if (SUB_EXTS.has(ext)) subs.push(rel)
      }
    }
  }
  await visit('')
  return { videos, subs }
}
