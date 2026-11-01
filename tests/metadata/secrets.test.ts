import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import type { Db } from '../../src/main/db/database'
import { clearTmdbKey, hasTmdbKey, loadTmdbKey, saveTmdbKey, type Cipher } from '../../src/main/metadata/secrets'

/** cifra falsa: inverte a string e marca com prefixo; decrypt recusa o que não tem o prefixo */
function fakeCipher(available = true): Cipher {
  return {
    available: () => available,
    encrypt: (s: string) => Buffer.from('enc:' + [...s].reverse().join(''), 'utf8'),
    decrypt: (b: Buffer) => {
      const t = b.toString('utf8')
      if (!t.startsWith('enc:')) throw new Error('dado corrompido')
      return [...t.slice(4)].reverse().join('')
    }
  }
}

function rawValue(db: Db): string | undefined {
  const r = db.prepare(`SELECT value FROM settings WHERE key = 'tmdb_key'`).get() as unknown as { value: string } | undefined
  return r?.value
}

const KEY = 'abc123SECRETkey'

describe('chave do TMDB cifrada', () => {
  it('salva cifrado: o valor no banco não contém a chave em texto', () => {
    const db = openDatabase(':memory:')
    expect(saveTmdbKey(db, fakeCipher(), KEY)).toBe('ok')
    const stored = rawValue(db)
    expect(stored).toBeDefined()
    expect(stored).not.toContain(KEY)
    expect(Buffer.from(stored!, 'base64').toString('utf8')).not.toContain(KEY)
  })

  it('load devolve a chave original', () => {
    const db = openDatabase(':memory:')
    saveTmdbKey(db, fakeCipher(), KEY)
    expect(loadTmdbKey(db, fakeCipher())).toBe(KEY)
  })

  it('sem cifra disponível não grava nada e devolve encryption-unavailable', () => {
    const db = openDatabase(':memory:')
    const cipher = fakeCipher(false)
    const encrypt = vi.spyOn(cipher, 'encrypt')
    expect(saveTmdbKey(db, cipher, KEY)).toBe('encryption-unavailable')
    expect(rawValue(db)).toBeUndefined()
    expect(hasTmdbKey(db)).toBe(false)
    expect(encrypt).not.toHaveBeenCalled()
  })

  it('chave corrompida no banco devolve null em vez de lançar', () => {
    const db = openDatabase(':memory:')
    db.prepare(`INSERT INTO settings (key, value) VALUES ('tmdb_key', ?)`).run(Buffer.from('lixo qualquer').toString('base64'))
    expect(() => loadTmdbKey(db, fakeCipher())).not.toThrow()
    expect(loadTmdbKey(db, fakeCipher())).toBeNull()
  })

  it('load devolve null quando não há chave gravada', () => {
    const db = openDatabase(':memory:')
    expect(loadTmdbKey(db, fakeCipher())).toBeNull()
  })

  it('clear remove', () => {
    const db = openDatabase(':memory:')
    saveTmdbKey(db, fakeCipher(), KEY)
    expect(hasTmdbKey(db)).toBe(true)
    clearTmdbKey(db)
    expect(hasTmdbKey(db)).toBe(false)
    expect(loadTmdbKey(db, fakeCipher())).toBeNull()
  })

  it('save apara espaços e recusa string vazia', () => {
    const db = openDatabase(':memory:')
    saveTmdbKey(db, fakeCipher(), `  ${KEY}\n `)
    expect(loadTmdbKey(db, fakeCipher())).toBe(KEY)
    expect(() => saveTmdbKey(db, fakeCipher(), '   ')).toThrow()
    expect(loadTmdbKey(db, fakeCipher())).toBe(KEY)
  })

  it('salvar de novo substitui a chave anterior', () => {
    const db = openDatabase(':memory:')
    saveTmdbKey(db, fakeCipher(), 'primeira')
    saveTmdbKey(db, fakeCipher(), 'segunda')
    expect(loadTmdbKey(db, fakeCipher())).toBe('segunda')
  })
})
