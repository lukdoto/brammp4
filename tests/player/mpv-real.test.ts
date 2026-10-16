import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MpvClient } from '../../src/main/player/mpv-client'
import { findExternalSubId, type MpvTrack } from '../../src/main/player/tracks'
import { uniquePipePath } from '../helpers/fake-mpv'
import { sleep } from '../helpers/wait'

const exe = join(process.cwd(), 'vendor', 'mpv', 'mpv.exe')
const config = join(process.cwd(), 'vendor', 'mpv-config')
const fixture = join(process.cwd(), 'tests', 'fixtures', 'tiny.mkv')

let child: ChildProcess | undefined
let client: MpvClient | undefined
let dir: string | undefined
afterEach(() => {
  client?.close()
  child?.kill()
  if (dir) rmSync(dir, { recursive: true, force: true })
  child = client = dir = undefined
})

// Prova as suposições sobre o protocolo com o mpv de verdade (roda onde o vendor/ foi baixado, inclusive no CI)
describe.skipIf(!existsSync(exe))('mpv real', () => {
  it('abre arquivo em pasta com acento, [ ], & e =; expõe track-list, aid/sid e reporta o fim (eof)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'brammp4-mpv-'))
    const folder = join(dir, 'Séries [teste] & co = x')
    mkdirSync(folder)
    const video = join(folder, 'Filme áéí [1].mkv')
    const srt = join(folder, 'Filme áéí [1].por.srt')
    copyFileSync(fixture, video)
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nolá\n')

    const pipe = uniquePipePath()
    let exited = false
    child = spawn(
      exe,
      [
        `--input-ipc-server=${pipe}`,
        `--config-dir=${config}`,
        '--vo=null',
        '--ao=null',
        '--pause',
        '--no-terminal',
        '--msg-level=all=error',
        '--osc=no',
        '--osd-bar=no',
        '--border=no',
        '--keep-open=no',
        '--aid=1',
        '--sid=no',
        `--sub-file=${srt}`,
        '--',
        video
      ],
      { stdio: 'ignore' }
    )
    child.on('exit', () => (exited = true))

    client = await MpvClient.connect(pipe, { retries: 200, delayMs: 50, shouldAbort: () => exited })
    const events: Record<string, unknown>[] = []
    client.on('event', (m: Record<string, unknown>) => events.push(m))
    client.start()

    // espera o arquivo carregar
    let duration: unknown
    for (let i = 0; i < 100 && typeof duration !== 'number'; i++) {
      duration = await client.getProperty('duration').catch(() => undefined)
      if (typeof duration !== 'number') await sleep(100)
    }
    expect(duration).toBeGreaterThan(0.5)
    expect(duration).toBeLessThan(2)

    const trackList = (await client.getProperty('track-list')) as MpvTrack[]
    const audio = trackList.find((t) => t.type === 'audio')
    expect(audio).toMatchObject({ id: 1, lang: 'por' })
    expect(trackList.find((t) => t.type === 'sub' && t.external === false)).toMatchObject({ id: 1, lang: 'eng' })
    // a legenda externa é achada pelo caminho, mesmo com acento e colchetes
    const extId = findExternalSubId(trackList, srt)
    expect(extId).toBeDefined()
    const sid = await client.getProperty('sid')
    expect(sid === false || sid === 'no').toBe(true)
    expect(await client.getProperty('aid')).toBe(1)

    // selecionar a externa funciona
    await client.setProperty('sid', extId)
    expect(await client.getProperty('sid')).toBe(extId)

    await client.observe('time-pos')
    await client.setProperty('pause', false)
    for (let i = 0; i < 150 && !events.some((e) => e.event === 'end-file'); i++) await sleep(100)
    const end = events.find((e) => e.event === 'end-file')
    expect(end).toMatchObject({ reason: 'eof' })
  }, 30000)
})
