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
  // undefined = ainda não decifrado; null = há chave gravada, mas não deu para decifrar
  let cached: TmdbClient | null | undefined
  return {
    client() {
      if (cached !== undefined) return cached
      if (!hasTmdbKey(db)) return null
      const key = loadTmdbKey(db, cipher)
      // a falha também fica guardada até invalidate(): status() e as rodadas não decifram de novo a cada chamada
      cached = key === null ? null : makeClient(key)
      return cached
    },
    invalidate() {
      cached = undefined
    }
  }
}
