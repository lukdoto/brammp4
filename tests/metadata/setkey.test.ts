import { describe, expect, it, vi } from 'vitest'
import { setTmdbKey, type SetKeyDeps } from '../../src/main/metadata/setkey'
import { TmdbError } from '../../src/main/metadata/tmdb'

function deps(over: Partial<SetKeyDeps> = {}) {
  const order: string[] = []
  const d = {
    encryptionAvailable: vi.fn(() => {
      order.push('cipher')
      return true
    }),
    validate: vi.fn(async (_key: string) => {
      order.push('validate')
    }),
    save: vi.fn((_key: string): 'ok' | 'encryption-unavailable' => {
      order.push('save')
      return 'ok'
    }),
    onKeyChanged: vi.fn(() => {
      order.push('keyChanged')
    }),
    sync: vi.fn(() => {
      order.push('sync')
    }),
    ...over
  }
  return { d, order }
}

describe('setTmdbKey', () => {
  it('chave vazia, só espaços, longa demais ou não-texto: invalid sem tocar na rede', async () => {
    for (const raw of ['', '   ', 'x'.repeat(501), 42, null]) {
      const { d } = deps()
      expect(await setTmdbKey(raw, d)).toEqual({ ok: false, error: 'invalid' })
      expect(d.validate).not.toHaveBeenCalled()
      expect(d.save).not.toHaveBeenCalled()
    }
  })

  it('cifra indisponível: encryption-unavailable ANTES da rede', async () => {
    const { d } = deps({ encryptionAvailable: vi.fn(() => false) })
    expect(await setTmdbKey('abc', d)).toEqual({ ok: false, error: 'encryption-unavailable' })
    expect(d.validate).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
  })

  it('validate falha: nada gravado, nada invalidado', async () => {
    for (const [err, code] of [
      [new TmdbError('invalid-key'), 'invalid-key'],
      [new TmdbError('network'), 'network'],
      [new Error('https://x?api_key=SEGREDO'), 'network']
    ] as const) {
      const { d } = deps({ validate: vi.fn(async () => Promise.reject(err)) })
      expect(await setTmdbKey('abc', d)).toEqual({ ok: false, error: code })
      expect(d.save).not.toHaveBeenCalled()
      expect(d.onKeyChanged).not.toHaveBeenCalled()
      expect(d.sync).not.toHaveBeenCalled()
    }
  })

  it('validate ok: valida a chave aparada, grava, invalida o keyring e sincroniza, nessa ordem', async () => {
    const { d, order } = deps()
    expect(await setTmdbKey('  abc  ', d)).toEqual({ ok: true })
    expect(d.validate).toHaveBeenCalledWith('abc')
    expect(d.save).toHaveBeenCalledWith('abc')
    expect(order).toEqual(['cipher', 'validate', 'save', 'keyChanged', 'sync'])
  })

  it('gravação recusada ou que lança: encryption-unavailable, sem sync, e loga só o nome do erro', async () => {
    const refused = deps({ save: vi.fn(() => 'encryption-unavailable' as const) })
    expect(await setTmdbKey('abc', refused.d)).toEqual({ ok: false, error: 'encryption-unavailable' })
    expect(refused.d.sync).not.toHaveBeenCalled()

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const thrown = deps({
      save: vi.fn(() => {
        throw new TypeError('falhou com abc no meio')
      })
    })
    expect(await setTmdbKey('abc', thrown.d)).toEqual({ ok: false, error: 'encryption-unavailable' })
    expect(thrown.d.onKeyChanged).not.toHaveBeenCalled()
    expect(JSON.stringify(spy.mock.calls)).toContain('TypeError')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('abc')
    spy.mockRestore()
  })
})
