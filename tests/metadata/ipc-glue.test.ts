import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { createKeyring } from '../../src/main/metadata/keyring'
import { setKeyError, toAssignResult, toCandidate } from '../../src/main/metadata/results'
import { clearTmdbKey, saveTmdbKey, type Cipher } from '../../src/main/metadata/secrets'
import { TmdbError, type TmdbClient } from '../../src/main/metadata/tmdb'

function cipher(): Cipher & { decrypt: ReturnType<typeof vi.fn> } {
  return {
    available: () => true,
    encrypt: (s: string) => Buffer.from('enc:' + s),
    decrypt: vi.fn((b: Buffer) => b.toString('utf8').slice(4))
  }
}

describe('setKeyError', () => {
  it('chave recusada vira invalid-key; o resto vira network, sem mensagem', () => {
    expect(setKeyError(new TmdbError('invalid-key'))).toEqual({ ok: false, error: 'invalid-key' })
    expect(setKeyError(new TmdbError('rate-limit'))).toEqual({ ok: false, error: 'network' })
    expect(setKeyError(new Error('https://x?api_key=SEGREDO'))).toEqual({ ok: false, error: 'network' })
  })
})

describe('toAssignResult', () => {
  it('ok e códigos de erro', () => {
    expect(toAssignResult('ok')).toEqual({ ok: true })
    expect(toAssignResult('no-key')).toEqual({ ok: false, error: 'no-key' })
    expect(toAssignResult('not-found')).toEqual({ ok: false, error: 'not-found' })
  })
})

describe('toCandidate', () => {
  it('omite campos ausentes e corta sinopse longa', () => {
    expect(toCandidate({ id: 5, name: 'Dark' })).toEqual({ tmdbId: 5, name: 'Dark' })
    const c = toCandidate({ id: 5, name: 'Dark', year: 2017, overview: 'x'.repeat(500) })
    expect(c.year).toBe(2017)
    expect(c.overview?.length).toBe(240)
  })
})

describe('keyring', () => {
  it('decifra uma vez, reaproveita o cliente e reflete set/clear após invalidate', () => {
    const db = openDatabase(':memory:')
    const c = cipher()
    const make = vi.fn((k: string) => ({ key: k }) as unknown as TmdbClient)
    const ring = createKeyring(db, c, make)
    expect(ring.client()).toBeNull()
    expect(c.decrypt).not.toHaveBeenCalled()

    saveTmdbKey(db, c, 'K1')
    ring.invalidate()
    const a = ring.client()
    expect(ring.client()).toBe(a)
    expect(c.decrypt).toHaveBeenCalledTimes(1)
    expect(make).toHaveBeenCalledWith('K1')

    clearTmdbKey(db)
    ring.invalidate()
    expect(ring.client()).toBeNull()
  })
})
