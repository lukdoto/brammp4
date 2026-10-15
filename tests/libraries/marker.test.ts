import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMarker, writeMarker } from '../../src/main/libraries/marker'

describe('marker', () => {
  it('grava e lê o marcador; pasta sem marcador retorna null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brammp4-'))
    expect(await readMarker(dir)).toBeNull()
    const m = await writeMarker(dir, 'HD Séries')
    expect(m.label).toBe('HD Séries')
    expect(await readMarker(dir)).toEqual(m)
  })
  it('não sobrescreve marcador existente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brammp4-'))
    const first = await writeMarker(dir, 'A')
    await expect(writeMarker(dir, 'B')).rejects.toThrow()
    expect(await readMarker(dir)).toEqual(first)
  })
  it('grava o id informado e gera um novo quando omitido', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brammp4-'))
    const m = await writeMarker(dir, 'A', 'id-antigo')
    expect(m.id).toBe('id-antigo')
    expect((await readMarker(dir))?.id).toBe('id-antigo')
    const other = await writeMarker(mkdtempSync(join(tmpdir(), 'brammp4-')), 'B')
    expect(other.id).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('pasta inexistente (disco desconectado) retorna null', async () => {
    expect(await readMarker('Q:\\nao\\existe')).toBeNull()
  })
})
