import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildMpvArgs } from '../../src/main/player/args'
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
let exited = false

/** Espera o processo terminar (até 5 s); se não terminar, mata de novo. */
async function stopChild(c: ChildProcess): Promise<void> {
  if (c.exitCode !== null || c.signalCode !== null) return
  const done = new Promise<void>((r) => c.once('exit', () => r()))
  c.kill()
  await Promise.race([done, sleep(5000)])
  if (c.exitCode === null && c.signalCode === null) {
    c.kill('SIGKILL')
    await Promise.race([done, sleep(2000)])
  }
}

afterEach(async () => {
  client?.close()
  if (child) await stopChild(child)
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  child = client = dir = undefined
})

/** Cria pasta com acento, [ ], & e =, o vídeo e a legenda externa ao lado. */
function prepare(): { video: string; srt: string } {
  dir = mkdtempSync(join(tmpdir(), 'brammp4-mpv-'))
  const folder = join(dir, 'Séries [teste] & co = x')
  mkdirSync(folder)
  const video = join(folder, 'Filme áéí [1].mkv')
  const srt = join(folder, 'Filme áéí [1].por.srt')
  copyFileSync(fixture, video)
  writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nolá\n')
  return { video, srt }
}

function launch(args: string[]): void {
  exited = false
  child = spawn(exe, args, { stdio: 'ignore' })
  child.on('exit', () => (exited = true))
}

async function connect(pipe: string): Promise<MpvClient> {
  const c = await MpvClient.connect(pipe, { retries: 200, delayMs: 50, shouldAbort: () => exited })
  client = c
  return c
}

async function waitDuration(c: MpvClient): Promise<unknown> {
  let duration: unknown
  for (let i = 0; i < 100 && typeof duration !== 'number'; i++) {
    duration = await c.getProperty('duration').catch(() => undefined)
    if (typeof duration !== 'number') await sleep(100)
  }
  return duration
}

/** Espera (limitado) até a legenda externa aparecer na track-list. */
async function waitTracks(c: MpvClient, srt: string): Promise<{ trackList: MpvTrack[]; extId: number | undefined }> {
  let trackList: MpvTrack[] = []
  let extId: number | undefined
  for (let i = 0; i < 50 && extId === undefined; i++) {
    trackList = (await c.getProperty('track-list')) as MpvTrack[]
    extId = findExternalSubId(trackList, srt)
    if (extId === undefined) await sleep(100)
  }
  return { trackList, extId }
}

// Prova as suposições sobre o protocolo com o mpv de verdade (roda onde o vendor/ foi baixado, inclusive no CI)
describe.skipIf(!existsSync(exe))('mpv real', () => {
  it('abre arquivo em pasta com acento, [ ], & e =; expõe track-list, aid/sid e reporta o fim (eof)', async () => {
    const { video, srt } = prepare()
    const pipe = uniquePipePath()
    launch([
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
    ])

    const c = await connect(pipe)
    const events: Record<string, unknown>[] = []
    c.on('event', (m: Record<string, unknown>) => events.push(m))
    c.start()

    const duration = await waitDuration(c)
    expect(duration).toBeGreaterThan(0.5)
    expect(duration).toBeLessThan(2)

    const { trackList, extId } = await waitTracks(c, srt)
    const audio = trackList.find((t) => t.type === 'audio')
    expect(audio).toMatchObject({ id: 1, lang: 'por' })
    expect(trackList.find((t) => t.type === 'sub' && t.external === false)).toMatchObject({ id: 1, lang: 'eng' })
    // a legenda externa é achada pelo caminho, mesmo com acento e colchetes
    expect(extId).toBeDefined()
    const sid = await c.getProperty('sid')
    expect(sid === false || sid === 'no').toBe(true)
    expect(await c.getProperty('aid')).toBe(1)

    // selecionar a externa funciona
    await c.setProperty('sid', extId)
    expect(await c.getProperty('sid')).toBe(extId)

    await c.observe('time-pos')
    await c.setProperty('pause', false)
    for (let i = 0; i < 150 && !events.some((e) => e.event === 'end-file'); i++) await sleep(100)
    const end = events.find((e) => e.event === 'end-file')
    expect(end).toMatchObject({ reason: 'eof' })
  }, 30000)

  it('aceita os argumentos montados por buildMpvArgs (produção), com título de caracteres estranhos', async () => {
    const { video, srt } = prepare()
    const pipe = uniquePipePath()
    const args = buildMpvArgs({
      pipePath: pipe,
      configDir: config,
      filePath: video,
      title: 'Filme: ${x} \\ "aspas" 100%',
      startS: 0.2,
      audioId: 1,
      sid: null,
      externalSubs: [srt]
    })
    // extras para rodar sem janela/áudio, antes do "-- arquivo" final; opções posteriores vencem as anteriores
    args.splice(args.length - 2, 0, '--vo=null', '--ao=null', '--pause', '--no-terminal', '--msg-level=all=error')
    launch(args)

    const c = await connect(pipe)
    c.start()
    expect(await waitDuration(c)).toBeGreaterThan(0.5)
    // o mpv não saiu por causa de opção inválida
    expect(exited).toBe(false)
    expect(await c.getProperty('aid')).toBe(1)

    const { extId } = await waitTracks(c, srt)
    expect(extId).toBeDefined()
    await c.setProperty('sid', extId)
    expect(await c.getProperty('sid')).toBe(extId)

    const exit = new Promise<void>((r) => child!.once('exit', () => r()))
    await c.command('quit').catch(() => undefined)
    await Promise.race([exit, sleep(5000)])
    expect(exited).toBe(true)
  }, 30000)

  it('a configuração do app: sem retomar do mpv, sem arrastar, só teclas seguras', async () => {
    const { video } = prepare()
    const log = join(dir!, 'mpv-conf.log')
    const pipe = uniquePipePath()
    launch([
      `--input-ipc-server=${pipe}`,
      `--config-dir=${config}`,
      `--log-file=${log}`,
      '--vo=null',
      '--ao=null',
      '--pause',
      '--no-terminal',
      '--osc=no',
      '--',
      video
    ])
    const c = await connect(pipe)
    c.start()
    expect(await waitDuration(c)).toBeGreaterThan(0.5)
    const off = (v: unknown) => v === false || v === 'no'
    expect(off(await c.getProperty('options/resume-playback'))).toBe(true)
    expect(off(await c.getProperty('options/save-position-on-quit'))).toBe(true)
    // drag-and-drop é uma escolha (no/auto/replace/...); pelo IPC o "no" chega como false
    expect(off(await c.getProperty('options/drag-and-drop'))).toBe(true)
    expect(off(await c.getProperty('options/input-default-bindings'))).toBe(true)

    // input-bindings lista também as teclas embutidas do mpv (is_weak: true), mas com priority negativa = inativas
    const bindings = (await c.getProperty('input-bindings')) as { key: string; cmd: string; section: string; priority: number; is_weak?: boolean }[]
    expect(Array.isArray(bindings)).toBe(true)
    const weak = bindings.filter((b) => b.is_weak)
    expect(weak.length).toBeGreaterThan(0)
    expect(weak.filter((b) => b.priority >= 0)).toEqual([])
    const active = bindings.filter((b) => b.priority >= 0)
    const quitKeys = active.filter((b) => b.cmd === 'quit').map((b) => b.key)
    expect(quitKeys).toEqual(expect.arrayContaining(['q', 'Q']))
    for (const k of ['q', 'Q']) expect(active.filter((b) => b.key === k).map((b) => b.cmd)).toEqual(['quit'])
    const forbidden = /playlist-next|playlist-prev|playlist-play-index|delete-file|open-file|loadfile|loadlist/
    expect(active.filter((b) => forbidden.test(b.cmd))).toEqual([])
    // seções do uosc (mouse) e do input.conf: nada perigoso nem quando ativadas
    expect(bindings.filter((b) => !b.is_weak && forbidden.test(b.cmd))).toEqual([])

    const exit = new Promise<void>((r) => child!.once('exit', () => r()))
    await c.command('quit').catch(() => undefined)
    await Promise.race([exit, sleep(5000)])
    const text = readFileSync(log, 'utf8')
    expect(text).toMatch(/Reading config file .*mpv\.conf/)
    expect(text).toMatch(/Input config file .*input\.conf parsed: \d+ binds/)
    // nenhuma opção desconhecida/inválida no mpv.conf nem tecla/comando inválido no input.conf
    expect(text).not.toMatch(/Error parsing option|Option .* not found|unknown option|Setting commandline option .* failed/i)
    expect(text).not.toMatch(/\]\[[ewf]\]\[(cplayer|input|options|cfg|global)\]/)
  }, 30000)

  it('carrega o uosc a partir da pasta de configuração embutida, sem erros', async () => {
    const { video } = prepare()
    const log = join(dir!, 'mpv.log')
    const pipe = uniquePipePath()
    launch([
      `--input-ipc-server=${pipe}`,
      `--config-dir=${config}`,
      `--log-file=${log}`,
      '--msg-level=all=error,uosc=v',
      '--vo=null',
      '--ao=null',
      '--pause',
      '--no-terminal',
      '--osc=no',
      '--',
      video
    ])
    const c = await connect(pipe)
    c.start()
    expect(await waitDuration(c)).toBeGreaterThan(0.5)
    const exit = new Promise<void>((r) => child!.once('exit', () => r()))
    await c.command('quit').catch(() => undefined)
    await Promise.race([exit, sleep(5000)])

    const text = readFileSync(log, 'utf8')
    // marcador positivo: o uosc leu o uosc.conf do config-dir (só acontece se main.lua rodou)
    expect(text).toMatch(/\[v\]\[uosc\] Opened config file script-opts\/uosc\.conf/)
    // nenhum erro/aviso emitido pelo uosc nem erro de Lua em qualquer script
    expect(text).not.toMatch(/\[[ewf]\]\[uosc\]/)
    expect(text).not.toMatch(/lua error|failed to load/i)
  }, 30000)
})
