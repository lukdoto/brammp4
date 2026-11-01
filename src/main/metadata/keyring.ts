import type { Db } from '../db/database'
import { hasTmdbKey, loadTmdbKey, type Cipher } from './secrets'
import type { TmdbClient } from './tmdb'

/**
 * Entrega o cliente do TMDB para a chave gravada, sem decifrar a cada chamada:
 * o cliente é guardado até `invalidate()` (chamado ao salvar ou apagar a chave).
 */
export function createKeyring(db: Db, cipher: Cipher, makeClient: (key: string) => TmdbClient): {
  client(): TmdbClient | null
  invalidate(): void
} {
  let cached: TmdbClient | null = null
  return {
    client() {
      if (cached) return cached
      if (!hasTmdbKey(db)) return null
      const key = loadTmdbKey(db, cipher)
      if (key === null) return null
      cached = makeClient(key)
      return cached
    },
    invalidate() {
      cached = null
    }
  }
}
