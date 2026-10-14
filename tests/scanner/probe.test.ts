import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFfprobe, probeFile } from '../../src/main/scanner/probe'
import { findFfprobe } from '../helpers/ffprobe'

describe('parseFfprobe', () => {
  it('extrai vídeo, faixas por tipo e duração', () => {
    const r = parseFfprobe({
      format: { duration: '3420.5' },
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080 },
        { index: 1, codec_type: 'audio', codec_name: 'eac3', tags: { language: 'jpn' }, disposition: { default: 1 } },
        { index: 2, codec_type: 'audio', codec_name: 'aac', tags: { language: 'por', title: 'Dublado' } },
        { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'pob' }, disposition: { forced: 1 } },
        { index: 4, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }
      ]
    })
    expect(r).toEqual({
      durationS: 3420.5, width: 1920, height: 1080, videoCodec: 'hevc',
      tracks: [
        { type: 'audio', streamIndex: 1, typeIndex: 1, codec: 'eac3', lang: 'jpn', title: undefined, isDefault: true, isForced: false },
        { type: 'audio', streamIndex: 2, typeIndex: 2, codec: 'aac', lang: 'por', title: 'Dublado', isDefault: false, isForced: false },
        { type: 'sub', streamIndex: 3, typeIndex: 1, codec: 'subrip', lang: 'por', title: undefined, isDefault: false, isForced: true }
      ]
    })
  })
  it('tolera JSON sem streams e sem duração', () => {
    expect(parseFfprobe({})).toEqual({ durationS: undefined, width: undefined, height: undefined, videoCodec: undefined, tracks: [] })
  })
})

const ffprobe = findFfprobe()
describe.skipIf(!ffprobe)('probeFile (ffprobe real)', () => {
  it('lê o vídeo de teste', async () => {
    const r = await probeFile(ffprobe!, join(process.cwd(), 'tests', 'fixtures', 'tiny.mkv'))
    expect(r.height).toBe(240)
    expect(r.tracks.map((t) => [t.type, t.lang])).toEqual([['audio', 'por'], ['sub', 'eng']])
  })
  it('rejeita arquivo corrompido em vez de travar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brammp4-'))
    const bad = join(dir, 'quebrado.mkv')
    writeFileSync(bad, Buffer.from('isto não é um vídeo'))
    await expect(probeFile(ffprobe!, bad)).rejects.toThrow()
  })
})
