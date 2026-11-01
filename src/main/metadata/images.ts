import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ImageSize = 'w342' | 'w780'

const NAME_RE = /^w(342|780)-[A-Za-z0-9_-]+\.jpg$/
const TMDB_PATH_RE = /^\/([A-Za-z0-9_-]+\.jpg)$/
const BASE = 'https://image.tmdb.org/t/p/'
const TIMEOUT_MS = 15000
/** Pôster w342/fundo w780 do TMDB têm centenas de KB; 5 MB é folga de sobra. */
const MAX_BYTES = 5 * 1024 * 1024

/** Nome de arquivo do cache: sem separadores, sem escapes, tamanho e extensão fixos. */
export function isSafeImageName(name: string): boolean {
  return typeof name === 'string' && NAME_RE.test(name)
}

/** '/abc.jpg' -> 'w342-abc.jpg'; qualquer caminho fora de ^/[A-Za-z0-9_-]+\.jpg$ -> undefined. */
export function imageFileName(size: ImageSize, tmdbPath: string): string | undefined {
  if (size !== 'w342' && size !== 'w780') return undefined
  if (typeof tmdbPath !== 'string') return undefined
  const m = TMDB_PATH_RE.exec(tmdbPath)
  if (!m) return undefined
  const name = `${size}-${m[1]}`
  return isSafeImageName(name) ? name : undefined
}

export interface ImageCache {
  /** Devolve o nome do arquivo no cache, baixando se faltar; undefined se falhar. */
  ensure(size: ImageSize, tmdbPath: string): Promise<string | undefined>
}

/** Libera a conexão sem ler o corpo. */
async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined)
}

/** Lê o corpo em stream; undefined (e conexão cancelada) se passar de `max` bytes. */
async function readLimited(res: Response, max: number): Promise<Uint8Array | undefined> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.byteLength > max ? undefined : buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return undefined
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export function createImageCache(opts: { dir: string; fetch?: typeof fetch }): ImageCache {
  const doFetch = opts.fetch ?? fetch
  const inflight = new Map<string, Promise<string | undefined>>()

  async function download(size: ImageSize, tmdbPath: string, name: string): Promise<string | undefined> {
    const final = join(opts.dir, name)
    const tmp = final + '.tmp'
    try {
      if (await exists(final)) return name
      await mkdir(opts.dir, { recursive: true })
      const res = await doFetch(`${BASE}${size}${tmdbPath}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      const declared = Number(res.headers.get('content-length') ?? NaN)
      if (
        !res.ok ||
        !(res.headers.get('content-type') ?? '').toLowerCase().startsWith('image/') ||
        (Number.isFinite(declared) && declared > MAX_BYTES)
      ) {
        await discard(res)
        return undefined
      }
      const bytes = await readLimited(res, MAX_BYTES)
      if (!bytes || bytes.byteLength === 0) return undefined
      await writeFile(tmp, bytes)
      await rename(tmp, final)
      return name
    } catch {
      return undefined
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined)
    }
  }

  return {
    ensure(size, tmdbPath) {
      const name = imageFileName(size, tmdbPath)
      if (!name) return Promise.resolve(undefined)
      const running = inflight.get(name)
      if (running) return running
      const p = download(size, tmdbPath, name).finally(() => inflight.delete(name))
      inflight.set(name, p)
      return p
    }
  }
}

/** 'brammp-img://img/<nome>' -> caminho absoluto dentro de dir, só se o nome for seguro. */
export function resolveImagePath(dir: string, url: string): string | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  if (u.protocol !== 'brammp-img:' || u.hostname !== 'img') return undefined
  if (u.search || u.hash || u.username || u.password || u.port) return undefined
  if (!u.pathname.startsWith('/')) return undefined
  const raw = u.pathname.slice(1)
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  // Nomes legítimos não têm escapes: qualquer diferença após decodificar é tentativa de truque.
  if (decoded !== raw || !isSafeImageName(raw) || !isSafeImageName(decoded)) return undefined
  return join(dir, decoded)
}
