import { describe, it, expect } from 'vitest'
import { resolveLibrary } from '../../src/main/libraries/resolve'
import type { Marker } from '../../src/main/libraries/marker'

const marker = (id: string): Marker => ({ id, label: 'HD', createdAt: '' })
const fakeFs = (present: Record<string, string>) => async (dir: string) => (present[dir] ? marker(present[dir]!) : null)

describe('resolveLibrary', () => {
  const lib = { id: 'abc', rootPath: 'E:\\Videos\\Series' }
  it('online no endereço guardado', async () => {
    expect(await resolveLibrary(lib, { readMarker: fakeFs({ 'E:\\Videos\\Series': 'abc' }) })).toEqual({ status: 'online', rootPath: 'E:\\Videos\\Series' })
  })
  it('encontra a mesma pasta em outra letra', async () => {
    expect(await resolveLibrary(lib, { readMarker: fakeFs({ 'G:\\Videos\\Series': 'abc' }) })).toEqual({ status: 'online', rootPath: 'G:\\Videos\\Series' })
  })
  it('respeita a lista de letras informada', async () => {
    expect(await resolveLibrary(lib, { letters: ['F', 'G'], readMarker: fakeFs({ 'G:\\Videos\\Series': 'abc' }) })).toEqual({ status: 'online', rootPath: 'G:\\Videos\\Series' })
  })
  it('raiz relativa à unidade (E:Videos) não é realocada', async () => {
    expect(await resolveLibrary({ id: 'abc', rootPath: 'E:Videos' }, { readMarker: fakeFs({ 'G:Videos': 'abc' }) })).toEqual({ status: 'offline' })
  })
  it('ignora pasta com mesmo caminho mas outro ID (outro disco)', async () => {
    expect(await resolveLibrary(lib, { readMarker: fakeFs({ 'F:\\Videos\\Series': 'outro' }) })).toEqual({ status: 'offline' })
  })
  it('offline quando não acha em lugar nenhum', async () => {
    expect(await resolveLibrary(lib, { readMarker: fakeFs({}) })).toEqual({ status: 'offline' })
  })
})
