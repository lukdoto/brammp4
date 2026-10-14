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
  it('pasta inexistente (disco desconectado) retorna null', async () => {
    expect(await readMarker('Q:\\nao\\existe')).toBeNull()
  })
})
