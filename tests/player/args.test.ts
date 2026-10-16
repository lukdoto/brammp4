import { describe, expect, it } from 'vitest'
import { buildMpvArgs, newPipePath, type MpvLaunch } from '../../src/main/player/args'

const base: MpvLaunch = {
  pipePath: '\\\\.\\pipe\\brammp4-abc',
  configDir: 'C:\\app\\mpv-config',
  filePath: 'E:\\Séries\\Dark [2017]\\Dark & Co S01E01 = teste.mkv',
  title: 'Dark · S01E01',
  startS: 0,
  audioId: null,
  sid: null,
  externalSubs: []
}

describe('buildMpvArgs', () => {
  it('argumentos fixos da spec, com o arquivo por último depois de "--"', () => {
    const a = buildMpvArgs(base)
    expect(a).toEqual(expect.arrayContaining([
      '--input-ipc-server=\\\\.\\pipe\\brammp4-abc',
      '--config-dir=C:\\app\\mpv-config',
      '--fullscreen',
      '--force-window=yes',
      '--osc=no',
      '--osd-bar=no',
      '--border=no',
      '--keep-open=no'
    ]))
    expect(a.slice(-2)).toEqual(['--', base.filePath]) // acentos, [ ], & e = passam intactos
    expect(a.some((x) => x.startsWith('--start='))).toBe(false)
    expect(a.some((x) => x.startsWith('--aid=') || x.startsWith('--sid='))).toBe(false)
  })

  it('posição inicial, faixas e legendas externas', () => {
    const a = buildMpvArgs({ ...base, startS: 1829, audioId: 2, sid: 1, externalSubs: ['E:\\a [1].srt', 'E:\\b & c.srt'] })
    expect(a).toContain('--start=1829.000')
    expect(a).toContain('--aid=2')
    expect(a).toContain('--sid=1')
    expect(a).toContain('--sub-file=E:\\a [1].srt')
    expect(a).toContain('--sub-file=E:\\b & c.srt')
  })

  it('legenda desligada vira --sid=no', () => {
    expect(buildMpvArgs({ ...base, sid: 'no' })).toContain('--sid=no')
  })

  it('o título não deixa o mpv expandir propriedades ($) nem escapes (\\)', () => {
    const a = buildMpvArgs({ ...base, title: 'Filme ${path} \\n' })
    expect(a).toContain('--title=Filme {path} n')
  })
})

describe('newPipePath', () => {
  it('é diferente a cada chamada e fica no namespace de pipes do Windows', () => {
    const a = newPipePath()
    expect(a).not.toBe(newPipePath())
    if (process.platform === 'win32') expect(a.startsWith('\\\\.\\pipe\\brammp4-')).toBe(true)
  })
})
