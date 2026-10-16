import type { Db } from '../db/database'

/** Cifra injetável: em produção o `index.ts` passa uma implementação sobre `safeStorage`. */
export interface Cipher {
  available(): boolean
  encrypt(s: string): Buffer
  decrypt(b: Buffer): string
}

const KEY_NAME = 'tmdb_key'

export function saveTmdbKey(db: Db, cipher: Cipher, key: string): 'ok' | 'encryption-unavailable' {
  const clean = key.trim()
  if (clean === '') throw new Error('chave do TMDB vazia')
  if (!cipher.available()) return 'encryption-unavailable'
  const value = cipher.encrypt(clean).toString('base64')
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY_NAME, value)
  return 'ok'
}

/** Devolve null se não houver chave, se a cifra estiver indisponível ou se o valor gravado não puder ser decifrado. */
export function loadTmdbKey(db: Db, cipher: Cipher): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_NAME) as unknown as { value: string } | undefined
  if (!row) return null
  if (!cipher.available()) return null
  try {
    return cipher.decrypt(Buffer.from(row.value, 'base64'))
  } catch {
    return null
  }
}

export function clearTmdbKey(db: Db): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(KEY_NAME)
}

export function hasTmdbKey(db: Db): boolean {
  return db.prepare('SELECT 1 FROM settings WHERE key = ?').get(KEY_NAME) !== undefined
}
