import { describe, it, expect } from 'vitest'
import { findOfflineTwin } from '../../src/main/libraries/twin'

const lib = (id: string, rootPath: string, status = 'offline') => ({ id, label: id, rootPath, status })

describe('findOfflineTwin', () => {
  it('casa ignorando letra do disco e caixa', () => {
    const libs = [lib('a', 'E:\\Videos\\Series')]
    expect(findOfflineTwin(libs, 'g:/videos/series')?.id).toBe('a')
    expect(findOfflineTwin(libs, 'F:\\VIDEOS\\Series\\')?.id).toBe('a')
  })
  it('não casa biblioteca online', () => {
    expect(findOfflineTwin([lib('a', 'E:\\Videos', 'online')], 'F:\\Videos')).toBeUndefined()
  })
  it('não casa final de caminho diferente', () => {
    expect(findOfflineTwin([lib('a', 'E:\\Videos\\Series')], 'F:\\Videos\\Filmes')).toBeUndefined()
    expect(findOfflineTwin([lib('a', 'E:\\Videos\\Series')], 'F:\\Outra\\Videos\\Series')).toBeUndefined()
  })
  it('caminho sem letra de disco retorna undefined', () => {
    expect(findOfflineTwin([lib('a', 'E:\\Videos')], '\\\\servidor\\Videos')).toBeUndefined()
    expect(findOfflineTwin([lib('a', '\\\\servidor\\Videos')], '\\\\servidor\\Videos')).toBeUndefined()
  })
})
