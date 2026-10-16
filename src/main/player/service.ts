import { join } from 'node:path'
import type { PlayerClosedReason, PlayerState, PlayRequest, PlayResult } from '../../shared/types'
import type { Db } from '../db/database'
import { saveProgress, setPrefs, type Prefs } from '../db/progress'
import { buildMpvArgs } from './args'
import { MpvClient, type ConnectOptions, type MpvMessage } from './mpv-client'
import { buildFileOptions } from './options'
import { ProgressTracker } from './tracker'
import { findExternalSubId, prefsFromMpv, prefsFromSelection, type MpvTrack } from './tracks'

/** Se o `playback-restart` nunca chegar, arma o rastreador depois deste tempo para o progresso nunca se perder em silêncio. */
const ARM_FALLBACK_MS = 15000
const OBSERVED = ['time-pos', 'duration', 'pause', 'aid', 'sid'] as const

export interface ChildLike {
  on(event: string, listener: (...args: any[]) => void): unknown
  kill(): boolean
}

export interface PlayerDeps {
  db: Db
  /** caminho do mpv.exe; lança se não existir */
  mpvExe: () => string
  configDir: () => string
  spawn: (exe: string, args: string[]) => ChildLike
  connect: (pipePath: string, opts: ConnectOptions) => Promise<MpvClient>
  newPipePath: () => string
  exists: (path: string) => boolean
  now: () => number
  onState: (s: PlayerState) => void
  /** espera entre a saída do processo e o fechamento da sessão, para o end-file em trânsito chegar (padrão 200 ms) */
  exitGraceMs?: number
}

interface Session {
  itemKey: string
  titleId: number
  label: string
  absPath: string
  /** caminho absoluto da legenda externa escolhida (aplicada depois do file-loaded) */
  externalAbs?: string
  startedAt: number
  child: ChildLike
  /** o processo já saiu (exit/error) */
  exited: boolean
  exitTimer?: NodeJS.Timeout
  tracker: ProgressTracker
  client?: MpvClient
  live: boolean
  closed: boolean
  trackList: MpvTrack[]
  endReason?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class PlayerService {
  private session: Session | undefined
  private starting = false

  constructor(private readonly deps: PlayerDeps) {}

  state(): PlayerState {
    const s = this.session
    return s?.live ? { playing: true, itemKey: s.itemKey, label: s.label } : { playing: false }
  }

  /** Há um start() em andamento ou uma sessão (mesmo ainda sem pipe): o app não pode sair sem chamar flushAndStop. */
  active(): boolean {
    return this.starting || this.session !== undefined
  }

  async play(req: PlayRequest): Promise<PlayResult> {
    if (this.session || this.starting) return { ok: false, error: 'already-playing' }
    this.starting = true
    try {
      return await this.start(req)
    } finally {
      this.starting = false
    }
  }

  /** Grava a última posição conhecida (notebook suspendendo, fim de sessão do Windows). */
  flush(): void {
    this.session?.tracker.flush()
  }

  /** App fechando: grava, pede ao mpv que saia e garante que o processo não fique órfão. */
  async flushAndStop(): Promise<void> {
    const s = this.session
    if (!s) return
    s.tracker.flush()
    try {
      await Promise.race([s.client?.command('quit') ?? Promise.resolve(), sleep(500)])
    } catch {
      /* o mpv pode já ter saído */
    }
    try {
      s.child.kill()
    } catch {
      /* idem */
    }
    this.finalize(s)
  }

  private async start(req: PlayRequest): Promise<PlayResult> {
    const { db } = this.deps
    const file = db.prepare(
      `SELECT f.rel_path, l.root_path, l.status
       FROM files f JOIN libraries l ON l.id = f.library_id
       WHERE f.id = ? AND f.item_key = ? AND f.missing = 0`
    ).get(req.fileId, req.itemKey) as unknown as { rel_path: string; root_path: string; status: 'online' | 'offline' } | undefined
    if (!file) return { ok: false, error: 'missing-file' }
    if (file.status !== 'online' || !this.deps.exists(file.root_path)) return { ok: false, error: 'offline' }
    const absPath = join(file.root_path, file.rel_path)
    if (!this.deps.exists(absPath)) return { ok: false, error: 'missing-file' }

    let exe: string
    let configDir: string
    try {
      exe = this.deps.mpvExe()
      configDir = this.deps.configDir()
    } catch {
      return { ok: false, error: 'mpv-missing' }
    }

    // a legenda externa vem do banco, nunca do pedido: só vale o que pertence a este arquivo
    const externalRel = (
      db.prepare(`SELECT external_path FROM tracks WHERE file_id = ? AND source = 'external' ORDER BY id`).all(req.fileId) as unknown as { external_path: string }[]
    ).map((r) => r.external_path)
    const sub = req.selection.sub
    if (sub.kind === 'external' && !externalRel.includes(sub.relPath)) return { ok: false, error: 'invalid' }

    const info = db.prepare(
      `SELECT i.title_id, i.season, i.episode, t.name AS title_name
       FROM items i JOIN titles t ON t.id = i.title_id WHERE i.key = ?`
    ).get(req.itemKey) as unknown as { title_id: number; season: number | null; episode: number | null; title_name: string } | undefined
    if (!info) return { ok: false, error: 'missing-file' }
    const code = info.season !== null && info.episode !== null ? ` · S${pad(info.season)}E${pad(info.episode)}` : ''
    const label = `${info.title_name}${code}`

    // só o que o usuário MUDOU em relação ao padrão vira preferência da série
    // (gravar o padrão também faria "legenda desligada" ofuscar legendas marcadas como padrão nos próximos arquivos)
    const option = buildFileOptions(db, req.itemKey, info.title_id).find((f) => f.fileId === req.fileId)
    if (option) {
      const chosen = prefsFromSelection(option.audio, option.subs, req.selection)
      const changed: Prefs = {}
      if (req.selection.audioTypeIndex !== option.defaults.audioTypeIndex && chosen.audioLang) changed.audioLang = chosen.audioLang
      if (JSON.stringify(req.selection.sub) !== JSON.stringify(option.defaults.sub) && chosen.subLang) changed.subLang = chosen.subLang
      if (changed.audioLang || changed.subLang) setPrefs(db, info.title_id, changed)
    }

    const pipePath = this.deps.newPipePath()
    const externalAbs = externalRel.map((p) => join(file.root_path, p))
    const args = buildMpvArgs({
      pipePath,
      configDir,
      filePath: absPath,
      title: label,
      startS: req.startS,
      audioId: req.selection.audioTypeIndex,
      sid: sub.kind === 'off' ? 'no' : sub.kind === 'embedded' ? sub.typeIndex : null,
      externalSubs: externalAbs
    })

    const tracker = new ProgressTracker({
      now: this.deps.now,
      save: (p) => {
        try {
          saveProgress(db, { itemKey: req.itemKey, ...p })
        } catch (err) {
          console.error('[player] falha ao gravar o progresso', err)
        }
      }
    })
    let child: ChildLike
    try {
      child = this.deps.spawn(exe, args)
    } catch {
      return { ok: false, error: 'start-failed' }
    }
    const session: Session = {
      itemKey: req.itemKey,
      titleId: info.title_id,
      label,
      absPath,
      ...(sub.kind === 'external' ? { externalAbs: join(file.root_path, sub.relPath) } : {}),
      startedAt: this.deps.now(),
      child,
      exited: false,
      tracker,
      live: false,
      closed: false,
      trackList: []
    }
    this.session = session
    const gone = () => {
      session.exited = true
      if (session.closed) return
      if (!session.live) return this.finalize(session)
      // o exit do processo e o end-file pelo pipe chegam em ordem não garantida: dá um instante ao pipe
      session.exitTimer ??= setTimeout(() => this.finalize(session), this.deps.exitGraceMs ?? 200)
      session.exitTimer.unref()
    }
    child.on('exit', gone)
    child.on('error', gone)

    let client: MpvClient
    try {
      client = await this.deps.connect(pipePath, { shouldAbort: () => session.exited })
    } catch {
      this.abort(session)
      return { ok: false, error: 'start-failed' }
    }
    if (session.closed) {
      client.close()
      return { ok: false, error: 'start-failed' }
    }
    session.client = client
    session.live = true
    client.on('property', (name: string, data: unknown) => this.onProperty(session, name, data))
    client.on('event', (ev: MpvMessage) => this.onEvent(session, ev))
    client.on('close', () => this.finalize(session))
    client.start()
    for (const p of OBSERVED) await client.observe(p).catch(() => {})
    // eventos anteriores à conexão não voltam: pergunta ao mpv em que ponto está
    await this.syncState(session)
    // a sessão pode ter morrido durante os awaits: finalize já anunciou o estado real
    if (session.closed) return { ok: false, error: 'start-failed' }
    this.emit(this.state())
    return { ok: true }
  }

  private async syncState(s: Session): Promise<void> {
    const client = s.client
    if (!client) return
    const tl = await client.getProperty('track-list').catch(() => undefined)
    if (Array.isArray(tl) && tl.length > 0) {
      s.trackList = tl as MpvTrack[]
      await this.applyExternalSub(s)
    }
    const pos = await client.getProperty('time-pos').catch(() => undefined)
    const seeking = await client.getProperty('seeking').catch(() => undefined)
    if (typeof pos === 'number' && seeking === false) {
      s.tracker.arm()
      s.tracker.onTimePos(pos) // arm() descarta a posição anterior: alimenta a posição lida agora
    }
  }

  private async applyExternalSub(s: Session): Promise<void> {
    if (!s.externalAbs || !s.client) return
    const id = findExternalSubId(s.trackList, s.externalAbs)
    if (id !== undefined) await s.client.setProperty('sid', id).catch(() => {})
  }

  private onProperty(s: Session, name: string, data: unknown): void {
    switch (name) {
      case 'time-pos':
        if (!s.tracker.isArmed && typeof data === 'number' && this.deps.now() - s.startedAt >= ARM_FALLBACK_MS) s.tracker.arm()
        s.tracker.onTimePos(data)
        return
      case 'duration':
        s.tracker.onDuration(data)
        return
      case 'pause':
        s.tracker.onPause(data)
        return
      case 'aid':
      case 'sid': {
        if (!s.tracker.isArmed) return // valor inicial, não é escolha do usuário
        const prefs = prefsFromMpv(s.trackList, name === 'aid' ? data : undefined, name === 'sid' ? data : undefined)
        const only: Prefs = name === 'aid' ? { audioLang: prefs.audioLang } : { subLang: prefs.subLang }
        if (only.audioLang || only.subLang) {
          try {
            setPrefs(this.deps.db, s.titleId, only)
          } catch (err) {
            console.error('[player] falha ao gravar as preferências', err)
          }
        }
        return
      }
    }
  }

  private onEvent(s: Session, ev: MpvMessage): void {
    switch (ev.event) {
      case 'file-loaded':
        void s.client
          ?.getProperty('track-list')
          .then(async (tl) => {
            if (Array.isArray(tl)) s.trackList = tl as MpvTrack[]
            await this.applyExternalSub(s)
          })
          .catch(() => {})
        return
      case 'playback-restart':
        s.tracker.arm()
        // arm() descarta a posição anterior; um mpv iniciado pausado não manda time-pos novo, então pergunta
        void s.client
          ?.getProperty('time-pos')
          .then((p) => s.tracker.onTimePos(p))
          .catch(() => {})
        return
      case 'end-file': {
        s.endReason = String(ev.reason)
        // se o arquivo sumiu, "eof" foi só a leitura falhando: não conta como terminou
        s.tracker.onEnd(this.deps.exists(s.absPath) ? ev.reason : 'error')
        return
      }
    }
  }

  private emit(state: PlayerState): void {
    try {
      this.deps.onState(state)
    } catch (err) {
      console.error('[player] falha ao notificar o estado', err)
    }
  }

  private abort(s: Session): void {
    try {
      s.child.kill()
    } catch {
      /* já saiu */
    }
    s.closed = true
    if (this.session === s) this.session = undefined
  }

  private finalize(s: Session): void {
    if (s.closed) return
    s.closed = true
    clearTimeout(s.exitTimer)
    s.tracker.flush()
    if (!s.exited) {
      try {
        s.child.kill()
      } catch {
        /* já saiu */
      }
    }
    try {
      s.client?.close()
    } catch {
      /* já fechado */
    }
    if (this.session === s) this.session = undefined
    if (!s.live) return
    const reason: PlayerClosedReason = !this.deps.exists(s.absPath)
      ? 'disconnected'
      : !s.tracker.isArmed
        ? 'error'
        : s.endReason === 'eof'
          ? 'ended'
          : 'closed'
    this.emit({ playing: false, itemKey: s.itemKey, closedReason: reason })
  }
}
