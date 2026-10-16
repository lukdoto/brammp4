import { describe, it, expect } from 'vitest'
import type { AudioOption, SubOption } from '../../src/shared/types'
import { defaultSelection, findExternalSubId, prefsFromMpv, prefsFromSelection, type MpvTrack } from '../../src/main/player/tracks'

const aud = (typeIndex: number, lang: string | undefined, isDefault = false): AudioOption => ({ typeIndex, lang, codec: 'aac', isDefault })
const emb = (typeIndex: number, lang: string | undefined, extra: Partial<SubOption> = {}): SubOption => ({
  source: 'embedded', typeIndex, lang, codec: 'subrip', isDefault: false, isForced: false, isSdh: false, ...extra
})
const ext = (externalPath: string, lang: string | undefined, extra: Partial<SubOption> = {}): SubOption => ({
  source: 'external', externalPath, lang, codec: 'srt', isDefault: false, isForced: false, isSdh: false, ...extra
})

describe('defaultSelection', () => {
  it('sem preferências usa a faixa marcada como padrão e legenda desligada', () => {
    const sel = defaultSelection([aud(1, 'jpn'), aud(2, 'por', true)], [emb(1, 'eng')], {})
    expect(sel).toEqual({ audioTypeIndex: 2, sub: { kind: 'off' } })
  })
  it('sem faixa padrão marcada, usa a primeira; sem áudio, null', () => {
    expect(defaultSelection([aud(1, 'jpn'), aud(2, 'por')], [], {}).audioTypeIndex).toBe(1)
    expect(defaultSelection([], [], {}).audioTypeIndex).toBeNull()
  })
  it('legenda embutida marcada como padrão é usada', () => {
    expect(defaultSelection([aud(1, 'jpn')], [emb(1, 'eng'), emb(2, 'por', { isDefault: true })], {}).sub).toEqual({ kind: 'embedded', typeIndex: 2 })
  })
  it('preferência de áudio vence o padrão do arquivo; idioma ausente cai no padrão', () => {
    const a = [aud(1, 'jpn'), aud(2, 'por', true)]
    expect(defaultSelection(a, [], { audioLang: 'jpn' }).audioTypeIndex).toBe(1)
    expect(defaultSelection(a, [], { audioLang: 'deu' }).audioTypeIndex).toBe(2)
  })
  it('preferência de legenda: prefere a normal à forçada e à SDH, e a embutida à externa quando empatam', () => {
    const subs = [emb(1, 'por', { isForced: true }), ext('S/a.por.srt', 'por'), emb(2, 'por', { isSdh: true }), emb(3, 'por')]
    expect(defaultSelection([], subs, { subLang: 'por' }).sub).toEqual({ kind: 'embedded', typeIndex: 3 })
    expect(defaultSelection([], [emb(1, 'por', { isForced: true }), ext('S/a.por.srt', 'por')], { subLang: 'por' }).sub).toEqual({ kind: 'external', relPath: 'S/a.por.srt' })
  })
  it('subLang "off" desliga; idioma que não existe no arquivo cai no padrão', () => {
    expect(defaultSelection([], [emb(1, 'por', { isDefault: true })], { subLang: 'off' }).sub).toEqual({ kind: 'off' })
    expect(defaultSelection([], [emb(1, 'eng', { isDefault: true })], { subLang: 'por' }).sub).toEqual({ kind: 'embedded', typeIndex: 1 })
    expect(defaultSelection([], [emb(1, 'eng')], { subLang: 'por' }).sub).toEqual({ kind: 'off' })
  })
})

describe('prefsFromSelection', () => {
  const audio = [aud(1, 'jpn'), aud(2, 'por')]
  const subs = [emb(1, 'eng'), ext('S/a.por.srt', 'por'), ext('S/b.srt', undefined)]
  it('traduz a escolha em idiomas', () => {
    expect(prefsFromSelection(audio, subs, { audioTypeIndex: 2, sub: { kind: 'embedded', typeIndex: 1 } })).toEqual({ audioLang: 'por', subLang: 'eng' })
    expect(prefsFromSelection(audio, subs, { audioTypeIndex: 1, sub: { kind: 'external', relPath: 'S/a.por.srt' } })).toEqual({ audioLang: 'jpn', subLang: 'por' })
    expect(prefsFromSelection(audio, subs, { audioTypeIndex: 1, sub: { kind: 'off' } })).toEqual({ audioLang: 'jpn', subLang: 'off' })
  })
  it('faixa sem idioma conhecido não vira preferência', () => {
    expect(prefsFromSelection(audio, subs, { audioTypeIndex: null, sub: { kind: 'external', relPath: 'S/b.srt' } })).toEqual({})
  })
})

describe('mpv track-list', () => {
  const list: MpvTrack[] = [
    { id: 1, type: 'audio', lang: 'jpn' },
    { id: 2, type: 'audio', lang: 'pt' },
    { id: 1, type: 'sub', lang: 'eng', external: false },
    { id: 2, type: 'sub', external: true, 'external-filename': 'E:\\Videos\\Series\\Dark\\Dark.S01E01.por.srt' }
  ]
  it('acha a legenda externa ignorando maiúsculas e o tipo de barra', () => {
    expect(findExternalSubId(list, 'e:/videos/series/dark/dark.s01e01.por.srt')).toBe(2)
    expect(findExternalSubId(list, 'E:\\Videos\\Series\\Outro.srt')).toBeUndefined()
  })
  it('converte aid/sid do mpv em idiomas (pt vira por; sid false vira off; externa sem idioma é ignorada)', () => {
    expect(prefsFromMpv(list, 2, 1)).toEqual({ audioLang: 'por', subLang: 'eng' })
    expect(prefsFromMpv(list, 1, false)).toEqual({ audioLang: 'jpn', subLang: 'off' })
    expect(prefsFromMpv(list, 1, 'no')).toEqual({ audioLang: 'jpn', subLang: 'off' })
    expect(prefsFromMpv(list, 99, 2)).toEqual({})
  })
})
