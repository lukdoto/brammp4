import { describe, expect, it } from 'vitest'
import { parsePlayRequest } from '../../src/main/player/request'

const ok = { itemKey: 'local:dark:S01E01', fileId: 3, startS: 12.5, selection: { audioTypeIndex: 2, sub: { kind: 'off' } } }

describe('parsePlayRequest', () => {
  it('aceita pedidos bem formados', () => {
    expect(parsePlayRequest(ok)).toEqual(ok)
    expect(parsePlayRequest({ ...ok, selection: { audioTypeIndex: null, sub: { kind: 'embedded', typeIndex: 1 } } })).not.toBeNull()
    expect(parsePlayRequest({ ...ok, selection: { audioTypeIndex: 1, sub: { kind: 'external', relPath: 'Dark/a.srt' } } })).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['texto', 'x'],
    ['sem itemKey', { ...ok, itemKey: '' }],
    ['itemKey enorme', { ...ok, itemKey: 'a'.repeat(501) }],
    ['fileId zero', { ...ok, fileId: 0 }],
    ['fileId fracionário', { ...ok, fileId: 1.5 }],
    ['fileId texto', { ...ok, fileId: '3' }],
    ['startS negativo', { ...ok, startS: -1 }],
    ['startS infinito', { ...ok, startS: Number.POSITIVE_INFINITY }],
    ['startS absurdo', { ...ok, startS: 2_000_000 }],
    ['sem seleção', { ...ok, selection: null }],
    ['áudio zero', { ...ok, selection: { audioTypeIndex: 0, sub: { kind: 'off' } } }],
    ['áudio absurdo', { ...ok, selection: { audioTypeIndex: 5000, sub: { kind: 'off' } } }],
    ['legenda de tipo desconhecido', { ...ok, selection: { audioTypeIndex: 1, sub: { kind: 'run' } } }],
    ['legenda embutida sem índice', { ...ok, selection: { audioTypeIndex: 1, sub: { kind: 'embedded' } } }],
    ['legenda externa sem caminho', { ...ok, selection: { audioTypeIndex: 1, sub: { kind: 'external', relPath: '' } } }]
  ])('recusa: %s', (_nome, raw) => {
    expect(parsePlayRequest(raw)).toBeNull()
  })
})
