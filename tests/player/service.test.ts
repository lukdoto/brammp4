import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { getPrefs, getProgress, saveProgress } from '../../src/main/db/progress'
import { MpvClient } from '../../src/main/player/mpv-client'
import { PlayerService } from '../../src/main/player/service'
import type { PlayRequest, PlayerState } from '../../src/shared/types'
import { FakeChild } from '../helpers/fake-child'
import { FakeMpv, uniquePipePath } from '../helpers/fake-mpv'
import { seedSeries } from '../helpers/seed'
import { sleep, waitFor } from '../helpers/wait'

const created: { mpv: FakeMpv[]; services: PlayerService[] } = { mpv: [], services: [] }
afterEach(async () => {
  for (const s of created.services) await s.flushAndStop().catch(() => {})
  for (const m of created.mpv) await m.close().catch(() => {})
  created.mpv = []
  created.services = []
})

function harness(
  over: {
    online?: boolean
    exists?: (p: string) => boolean
    mpvExe?: () => string
    /** comandos que o FakeMpv ignora */
    silent?: string[]
    /** propriedades já presentes no FakeMpv quando o serviço conecta */
    props?: Record<string, unknown>
    commandTimeoutMs?: number
    throwOnState?: boolean
    /** o spawn não cria FakeMpv: o pipe nunca existe e o connect segue tentando */
    noServer?: boolean
  } = {}
) {
  const seeded = seedSeries({ online: over.online })
  const states: PlayerState[] = []
  let clock = 0
  let present = true
  const fakes: { mpv?: FakeMpv; child?: FakeChild; args: string[] } = { args: [] }
  const service = new PlayerService({
    db: seeded.db,
    mpvExe: over.mpvExe ?? (() => 'C:\\mpv\\mpv.exe'),
    configDir: () => 'C:\\mpv-config',
    spawn: (_exe, args) => {
      fakes.args = args
      const pipe = args.find((a) => a.startsWith('--input-ipc-server='))!.slice('--input-ipc-server='.length)
      if (!over.noServer) {
        fakes.mpv = new FakeMpv(pipe)
        created.mpv.push(fakes.mpv)
        for (const c of over.silent ?? []) fakes.mpv.silentCommands.add(c)
        for (const [k, v] of Object.entries(over.props ?? {})) fakes.mpv.props.set(k, v)
      }
      fakes.child = new FakeChild()
      return fakes.child
    },
    connect: (pipe, o) => MpvClient.connect(pipe, { ...o, delayMs: 5, ...(over.commandTimeoutMs ? { commandTimeoutMs: over.commandTimeoutMs } : {}) }),
    exitGraceMs: 20,
    newPipePath: uniquePipePath,
    exists: over.exists ?? (() => present),
    now: () => clock,
    onState: (s) => {
      states.push(s)
      if (over.throwOnState) throw new Error('onState quebrou')
    }
  })
  created.services.push(service)
  return { ...seeded, service, states, fakes, tick: (ms: number) => (clock += ms), setPresent: (v: boolean) => (present = v) }
}

const req = (h: { keys: string[]; fileIds: number[] }, over: Partial<PlayRequest> = {}): PlayRequest => ({
  itemKey: h.keys[0]!,
  fileId: h.fileIds[0]!,
  startS: 0,
  selection: { audioTypeIndex: null, sub: { kind: 'off' } },
  ...over
})

describe('PlayerService.play: argumentos', () => {
  it('lança o mpv com posição, faixas, legendas externas e o arquivo certo', async () => {
    const h = harness()
    repo.replaceExternalSubs(h.db, h.fileIds[0]!, [{ relPath: 'Dark/Season 1/Dark.S01E01.por.srt', lang: 'por', forced: false, sdh: false, codec: 'srt' }])
    const r = await h.service.play(req(h, { startS: 1829, selection: { audioTypeIndex: 2, sub: { kind: 'embedded', typeIndex: 1 } } }))
    expect(r).toEqual({ ok: true })
    const a = h.fakes.args
    expect(a).toContain('--start=1829.000')
    expect(a).toContain('--aid=2')
    expect(a).toContain('--sid=1')
    expect(a).toContain(`--sub-file=${join('E:\\Videos\\Series', 'Dark/Season 1/Dark.S01E01.por.srt')}`)
    expect(a.slice(-2)).toEqual(['--', join('E:\\Videos\\Series', 'Dark/Season 1/Dark.S01E01.mkv')])
    expect(h.states.at(-1)).toMatchObject({ playing: true, itemKey: h.keys[0], label: 'Dark · S01E01' })
  })

  const trio = [
    { type: 'audio' as const, streamIndex: 1, typeIndex: 1, codec: 'aac', lang: 'jpn', isDefault: true, isForced: false },
    { type: 'audio' as const, streamIndex: 2, typeIndex: 2, codec: 'aac', lang: 'por', isDefault: false, isForced: false },
    { type: 'sub' as const, streamIndex: 3, typeIndex: 1, codec: 'subrip', lang: 'por', isDefault: false, isForced: false }
  ]

  it('grava como preferência o que o usuário mudou em relação ao padrão', async () => {
    const h = harness()
    repo.replaceEmbeddedTracks(h.db, h.fileIds[0]!, trio)
    await h.service.play(req(h, { selection: { audioTypeIndex: 2, sub: { kind: 'embedded', typeIndex: 1 } } }))
    expect(getPrefs(h.db, h.titleId)).toEqual({ audioLang: 'por', subLang: 'por' })
  })

  it('escolher exatamente o padrão não grava preferência nenhuma', async () => {
    const h = harness()
    repo.replaceEmbeddedTracks(h.db, h.fileIds[0]!, trio)
    await h.service.play(req(h, { selection: { audioTypeIndex: 1, sub: { kind: 'off' } } })) // padrão: áudio marcado e legenda desligada
    expect(getPrefs(h.db, h.titleId)).toEqual({})
  })
})

describe('PlayerService.play: recusas', () => {
  it('segundo play enquanto toca', async () => {
    const h = harness()
    expect(await h.service.play(req(h))).toEqual({ ok: true })
    expect(await h.service.play(req(h))).toEqual({ ok: false, error: 'already-playing' })
  })

  it('biblioteca offline', async () => {
    const h = harness({ online: false })
    expect(await h.service.play(req(h))).toEqual({ ok: false, error: 'offline' })
  })

  it('arquivo desconhecido, de outro item ou ausente', async () => {
    const h = harness()
    expect(await h.service.play(req(h, { fileId: 9999 }))).toEqual({ ok: false, error: 'missing-file' })
    expect(await h.service.play(req(h, { itemKey: h.keys[1]! }))).toEqual({ ok: false, error: 'missing-file' }) // fileId é do E01
    repo.markMissing(h.db, 'lib1', new Set([h.fileIds[1]!, h.fileIds[2]!]))
    expect(await h.service.play(req(h))).toEqual({ ok: false, error: 'missing-file' })
  })

  it('disco sumiu entre o catálogo e o clique: pasta da biblioteca não existe mais', async () => {
    const h = harness({ exists: () => false })
    expect(await h.service.play(req(h))).toEqual({ ok: false, error: 'offline' })
  })

  it('arquivo apagado com o disco presente: missing-file', async () => {
    const h = harness({ exists: (p) => !p.endsWith('Dark.S01E01.mkv') })
    expect(await h.service.play(req(h))).toEqual({ ok: false, error: 'missing-file' })
  })

  it('mpv não encontrado', async () => {
    const h = harness({ mpvExe: () => { throw new Error('mpv ausente') } })
    expect(await h.service.play(req(h))).toEqual({ ok: false, error: 'mpv-missing' })
  })

  it('legenda externa que não pertence ao arquivo é recusada sem lançar o mpv (pedido forjado)', async () => {
    const h = harness()
    const r = await h.service.play(req(h, { selection: { audioTypeIndex: null, sub: { kind: 'external', relPath: '..\\..\\Windows\\win.ini' } } }))
    expect(r).toEqual({ ok: false, error: 'invalid' })
    expect(h.fakes.child).toBeUndefined()
  })
})

describe('PlayerService: progresso', () => {
  async function start(h: ReturnType<typeof harness>, startS = 600) {
    expect(await h.service.play(req(h, { startS }))).toEqual({ ok: true })
    return h.fakes.mpv!
  }
  const saved = (h: ReturnType<typeof harness>) => getProgress(h.db, h.keys[0]!)

  it('grava a cada 5 s depois do playback-restart, nunca antes', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.setProp('time-pos', 0.3) // carregando: não pode apagar nada
    await sleep(40)
    expect(saved(h)).toBeUndefined()
    mpv.props.set('time-pos', 605) // posição real, lida pelo serviço no playback-restart
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('duration', 1380)
    await waitFor(() => saved(h)?.positionS === 605)
    h.tick(5000)
    mpv.setProp('time-pos', 615)
    await waitFor(() => saved(h)?.positionS === 615)
    h.tick(1000)
    mpv.setProp('time-pos', 616)
    await sleep(40)
    expect(saved(h)?.positionS).toBe(615)
    expect(saved(h)?.durationS).toBe(1380)
  })

  it('pausar grava na hora', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.props.set('time-pos', 605)
    mpv.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 605)
    h.tick(1000)
    mpv.setProp('time-pos', 607)
    mpv.setProp('pause', true)
    await waitFor(() => saved(h)?.positionS === 607)
  })

  it('mpv iniciado pausado: o playback-restart sozinho grava a posição lida do mpv', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.props.set('time-pos', 605) // pausado: nenhum time-pos novo será enviado
    mpv.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 605)
  })

  it('restart sem posição conhecida: nada é gravado e o progresso anterior fica intacto', async () => {
    const h = harness()
    saveProgress(h.db, { itemKey: h.keys[0]!, positionS: 300, durationS: 1380, watched: false })
    const mpv = await start(h) // get_property time-pos responde "property unavailable"
    mpv.emitEvent({ event: 'playback-restart' })
    await sleep(40)
    mpv.emitEvent({ event: 'end-file', reason: 'quit' })
    h.fakes.child!.exitNow(0)
    await waitFor(() => h.states.at(-1)?.playing === false)
    expect(saved(h)).toMatchObject({ positionS: 300, durationS: 1380, watched: false })
  })

  it('usuário fecha o player: última posição salva e estado "closed"', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.props.set('time-pos', 605)
    mpv.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 605)
    h.tick(1000)
    mpv.setProp('time-pos', 640)
    await sleep(30)
    mpv.emitEvent({ event: 'end-file', reason: 'quit' })
    h.fakes.child!.exitNow(0)
    await waitFor(() => h.states.at(-1)?.playing === false)
    expect(h.states.at(-1)).toMatchObject({ playing: false, closedReason: 'closed', itemKey: h.keys[0] })
    expect(saved(h)).toMatchObject({ positionS: 640, watched: false })
    expect(await h.service.play(req(h))).toEqual({ ok: true }) // a sessão acabou: dá para tocar de novo
  })

  it('chegou ao fim (eof): assistido até a duração, estado "ended"', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.setProp('duration', 1380)
    mpv.props.set('time-pos', 1370)
    mpv.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 1370)
    mpv.emitEvent({ event: 'end-file', reason: 'eof' })
    await waitFor(() => saved(h)?.positionS === 1380) // o end-file chegou pelo pipe; só então o processo sai
    h.fakes.child!.exitNow(0)
    await waitFor(() => h.states.at(-1)?.playing === false)
    expect(h.states.at(-1)?.closedReason).toBe('ended')
    expect(saved(h)).toMatchObject({ positionS: 1380, durationS: 1380, watched: true })
  })

  it('disco removido durante a reprodução: ponto salvo, não vira assistido, estado "disconnected"', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.setProp('duration', 1380)
    mpv.props.set('time-pos', 700)
    mpv.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 700)
    h.setPresent(false)
    mpv.emitEvent({ event: 'end-file', reason: 'eof' }) // leitura falhou e o mpv chamou de fim
    h.fakes.child!.exitNow(1)
    await waitFor(() => h.states.at(-1)?.playing === false)
    expect(h.states.at(-1)?.closedReason).toBe('disconnected')
    expect(saved(h)).toMatchObject({ positionS: 700, watched: false })
  })

  it('o mpv morre antes de a reprodução começar: nenhum progresso é gravado e o estado é "error"', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.setProp('time-pos', 5)
    await sleep(30)
    h.fakes.child!.exitNow(1)
    await waitFor(() => h.states.at(-1)?.playing === false)
    expect(h.states.at(-1)?.closedReason).toBe('error')
    expect(saved(h)).toBeUndefined()
  })

  it('rede de segurança: se o playback-restart nunca chegar, arma depois de 15 s de reprodução', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.setProp('time-pos', 3)
    await sleep(30)
    expect(saved(h)).toBeUndefined()
    h.tick(16000)
    mpv.setProp('time-pos', 20)
    await waitFor(() => saved(h)?.positionS === 20)
  })

  it('flushAndStop (app fechando): grava o que faltava, encerra o mpv e fecha a sessão', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.props.set('time-pos', 605)
    mpv.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 605)
    h.tick(1000)
    mpv.setProp('time-pos', 640)
    await sleep(30)
    await h.service.flushAndStop()
    expect(h.fakes.child!.killed).toBe(true)
    expect(saved(h)?.positionS).toBe(640)
    expect(h.service.state().playing).toBe(false)
  })

  it('flush (notebook suspendendo) grava sem encerrar', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.props.set('time-pos', 605)
    mpv.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 605)
    h.tick(1000)
    mpv.setProp('time-pos', 650)
    await sleep(30)
    h.service.flush()
    expect(saved(h)?.positionS).toBe(650)
    expect(h.service.state().playing).toBe(true)
  })
})

describe('PlayerService: ciclo de vida da sessão', () => {
  const saved = (h: ReturnType<typeof harness>) => getProgress(h.db, h.keys[0]!)

  it('end-file eof e saída do processo no mesmo instante: continua "ended" e assistido', async () => {
    const h = harness()
    await h.service.play(req(h, { startS: 600 }))
    const mpv = h.fakes.mpv!
    mpv.setProp('duration', 1380)
    mpv.props.set('time-pos', 1370)
    mpv.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 1370)
    mpv.emitEvent({ event: 'end-file', reason: 'eof' })
    h.fakes.child!.exitNow(0) // sem esperar: o exit pode chegar antes do end-file
    await waitFor(() => h.states.at(-1)?.playing === false)
    expect(h.states.at(-1)?.closedReason).toBe('ended')
    expect(saved(h)).toMatchObject({ positionS: 1380, watched: true })
  })

  it('play que continua depois de a sessão morrer não anuncia "tocando" nem devolve ok', async () => {
    const h = harness({ silent: ['observe_property'], commandTimeoutMs: 100 })
    const p = h.service.play(req(h))
    await waitFor(() => (h.fakes.mpv?.commands.length ?? 0) > 0) // o serviço já está nos observes
    h.fakes.child!.exitNow(1)
    expect(await p).toEqual({ ok: false, error: 'start-failed' })
    expect(h.states.at(-1)).toMatchObject({ playing: false, closedReason: 'error' })
    expect(h.service.state().playing).toBe(false)
  })

  it('socket caiu com o mpv vivo: o processo é encerrado e a sessão fecha', async () => {
    const h = harness()
    await h.service.play(req(h))
    h.fakes.mpv!.dropClients()
    await waitFor(() => h.states.at(-1)?.playing === false)
    expect(h.fakes.child!.killed).toBe(true)
    expect(h.service.state().playing).toBe(false)
  })

  it('onState que lança não impede a sessão de fechar', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const h = harness({ throwOnState: true })
      expect(await h.service.play(req(h))).toEqual({ ok: true })
      h.fakes.child!.exitNow(0)
      await waitFor(() => !h.service.state().playing && h.states.length >= 2)
      expect(h.states.at(-1)).toMatchObject({ playing: false })
      expect(err).toHaveBeenCalled()
    } finally {
      err.mockRestore()
    }
  })

  it('syncState arma com a posição que o mpv já tinha ao conectar', async () => {
    const h = harness({ props: { 'time-pos': 605, seeking: false, duration: 1380, 'track-list': [] } })
    await h.service.play(req(h, { startS: 600 }))
    await waitFor(() => saved(h)?.positionS === 605)
  })

  it('syncState não arma enquanto o mpv ainda está buscando (seeking)', async () => {
    const h = harness({ props: { 'time-pos': 605, seeking: true, 'track-list': [] } })
    await h.service.play(req(h, { startS: 600 }))
    await sleep(40)
    expect(saved(h)).toBeUndefined()
    h.fakes.mpv!.props.set('time-pos', 606)
    h.fakes.mpv!.emitEvent({ event: 'playback-restart' })
    await waitFor(() => saved(h)?.positionS === 606)
  })

  it('flushAndStop manda "quit" ao mpv', async () => {
    const h = harness()
    await h.service.play(req(h))
    await h.service.flushAndStop()
    expect(h.fakes.mpv!.commands.some((c) => c[0] === 'quit')).toBe(true)
  })

  it('flushAndStop não espera para sempre por um mpv que não responde ao quit', async () => {
    const h = harness({ silent: ['quit'] })
    await h.service.play(req(h))
    const t0 = Date.now()
    await h.service.flushAndStop()
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(h.fakes.child!.killed).toBe(true)
    expect(h.service.state().playing).toBe(false)
  })
})

describe('PlayerService.active', () => {
  it('é falso no início, verdadeiro logo após play() (antes de aguardar), durante e falso depois de finalizar', async () => {
    const h = harness()
    expect(h.service.active()).toBe(false)
    const p = h.service.play(req(h))
    expect(h.service.active()).toBe(true)
    expect(await p).toEqual({ ok: true })
    expect(h.service.active()).toBe(true)
    await h.service.flushAndStop()
    expect(h.service.active()).toBe(false)
  })

  it('fechar o app com o mpv lançado mas ainda sem pipe mata o processo e o play() falha', async () => {
    const h = harness({ noServer: true })
    const p = h.service.play(req(h))
    await waitFor(() => h.fakes.child !== undefined)
    expect(h.service.active()).toBe(true)
    await h.service.flushAndStop()
    expect(h.fakes.child!.killed).toBe(true)
    expect(await p).toEqual({ ok: false, error: 'start-failed' })
    expect(h.service.active()).toBe(false)
  })
})

describe('PlayerService: faixas dentro do mpv', () => {
  it('a legenda externa escolhida é selecionada depois do file-loaded, pelo nome do arquivo', async () => {
    const h = harness()
    const rel = 'Dark/Season 1/Dark.S01E01.por.srt'
    repo.replaceExternalSubs(h.db, h.fileIds[0]!, [{ relPath: rel, lang: 'por', forced: false, sdh: false, codec: 'srt' }])
    await h.service.play(req(h, { selection: { audioTypeIndex: null, sub: { kind: 'external', relPath: rel } } }))
    const mpv = h.fakes.mpv!
    expect(h.fakes.args.some((a) => a.startsWith('--sid='))).toBe(false)
    mpv.props.set('track-list', [
      { id: 1, type: 'sub', lang: 'eng', external: false },
      { id: 3, type: 'sub', external: true, 'external-filename': join('E:\\Videos\\Series', rel) }
    ])
    mpv.emitEvent({ event: 'file-loaded' })
    await waitFor(() => mpv.commands.some((c) => c[0] === 'set_property' && c[1] === 'sid' && c[2] === 3))
  })

  it('o que o usuário troca dentro do mpv vira preferência (só depois de a reprodução começar)', async () => {
    const h = harness()
    await h.service.play(req(h))
    const mpv = h.fakes.mpv!
    mpv.props.set('track-list', [
      { id: 1, type: 'audio', lang: 'jpn' },
      { id: 2, type: 'audio', lang: 'por' },
      { id: 1, type: 'sub', lang: 'eng', external: false }
    ])
    mpv.emitEvent({ event: 'file-loaded' })
    await sleep(50)
    mpv.setProp('aid', 1) // antes do playback-restart: é só o estado inicial, não é escolha do usuário
    await sleep(30)
    expect(getPrefs(h.db, h.titleId)).toEqual({})
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('aid', 2)
    await waitFor(() => getPrefs(h.db, h.titleId).audioLang === 'por')
    mpv.setProp('sid', false)
    await waitFor(() => getPrefs(h.db, h.titleId).subLang === 'off')
  })
})
