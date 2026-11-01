import type { Db } from '../db/database'
import * as meta from '../db/metadata'
import type { ImageCache } from './images'
import { pickBest } from './match'
import { TmdbError, type TmdbClient, type TmdbEpisode, type TmdbTitle } from './tmdb'

const RECHECK_DAYS = 7
const DEFAULT_RETRY_MS = 600_000

export type AssignResult = 'ok' | 'no-key' | TmdbError['code'] | 'not-found' | 'kind-mismatch'

/** Busca manual sem chave configurada. */
export class NoKeyError extends Error {
  constructor() {
    super('Sem chave do TMDB')
    this.name = 'NoKeyError'
  }
}

export interface MetadataServiceDeps {
  db: Db
  /** Cliente com a chave atual, ou null se não há chave. Relido antes de cada requisição da rodada. */
  client: () => TmdbClient | null
  images: ImageCache
  now: () => Date
  onChange: () => void
  retryMs?: number
  /** O arquivo (nome no cache de imagens) ainda existe no disco? Sem isto, confia no banco. */
  imageExists?: (file: string) => boolean
}

type StopCode = TmdbError['code'] | 'key-changed' | 'stopped'

/** Interrompe a rodada atual (rede, limite, chave, troca de chave, stop): o que sobrou fica para a próxima. */
class StopRound extends Error {
  constructor(readonly code: StopCode) {
    super(code)
  }
}

/** Cliente e geração da chave com que a rodada começou. */
interface RoundCtx {
  client: TmdbClient
  gen: number
}

/** Nunca inclui a mensagem de erros desconhecidos: ela poderia carregar uma URL com a chave. */
function describe(e: unknown): string {
  if (e instanceof TmdbError) return e.code
  return e instanceof Error ? e.name : 'erro desconhecido'
}

export class MetadataService {
  private readonly db: Db
  private readonly getClient: () => TmdbClient | null
  private readonly images: ImageCache
  private readonly now: () => Date
  private readonly onChange: () => void
  private readonly retryMs: number
  private readonly imageExists?: (file: string) => boolean

  private running: Promise<void> | null = null
  /** Pedido de sync (ou troca de chave) durante uma rodada: roda outra ao terminar. */
  private rerun = false
  /** Incrementada a cada troca/remoção da chave; a rodada compara antes de cada requisição. */
  private keyGen = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private disposed = false
  /** invalid-key: sem timer até alguém chamar sync() de novo (ex.: depois de salvar a chave). */
  private keyRejected = false
  /** Tentativas já feitas nesta execução do app (evita martelar o TMDB). */
  private readonly triedSeasons = new Set<string>()
  private readonly triedImages = new Set<number>()
  /** Títulos cuja busca voltou com resposta ruim: pulados até a próxima execução do app. */
  private readonly badTitles = new Set<number>()

  constructor(deps: MetadataServiceDeps) {
    this.db = deps.db
    this.getClient = deps.client
    this.images = deps.images
    this.now = deps.now
    this.onChange = deps.onChange
    this.retryMs = deps.retryMs ?? DEFAULT_RETRY_MS
    this.imageExists = deps.imageExists
  }

  start(): void {
    this.started = true
    this.disposed = false
    void this.sync()
  }

  stop(): void {
    this.started = false
    this.disposed = true
    this.rerun = false
    this.clearTimer()
  }

  /** A chave foi salva, trocada ou apagada: a rodada em andamento para de usar o cliente antigo. */
  keyChanged(): void {
    this.keyGen++
    this.keyRejected = false
    if (this.running) this.rerun = true
  }

  status(): { hasKey: boolean; syncing: boolean; pending: number } {
    return { hasKey: this.getClient() !== null, syncing: this.running !== null, pending: meta.countPending(this.db) }
  }

  /**
   * Uma rodada por vez. Pedido feito durante uma rodada devolve a mesma promessa e garante
   * mais uma rodada ao terminar (títulos novos do scan, chave nova).
   */
  sync(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.running) {
      this.rerun = true
      return this.running
    }
    const p = (async () => {
      do {
        this.rerun = false
        this.keyRejected = false
        this.clearTimer()
        await this.round().catch((e) => console.error('[metadata] falha inesperada na sincronização:', describe(e)))
      } while (this.rerun && !this.disposed)
    })().finally(() => {
      this.running = null
    })
    this.running = p
    return p
  }

  async search(kind: 'series' | 'movie', query: string, year?: number): Promise<TmdbTitle[]> {
    const q = query.trim()
    if (!q) throw new Error('Consulta vazia')
    const client = this.getClient()
    if (!client) throw new NoKeyError()
    return client.search(kind, q, year)
  }

  async assign(titleId: number, tmdbId: number): Promise<AssignResult> {
    const client = this.getClient()
    if (!client) return 'no-key'
    const title = meta.getTitleForAssign(this.db, titleId)
    if (!title) return 'not-found'
    let found: TmdbTitle
    try {
      found = await client.details(title.kind, tmdbId)
    } catch (e) {
      if (e instanceof TmdbError) {
        // O cliente não distingue 404 de outras respostas ruins: aqui, id inexistente para este tipo.
        if (e.code === 'bad-response') return 'not-found'
        if (e.code === 'invalid-key') this.keyRejected = true
        console.error('[metadata] assign falhou:', e.code)
        return e.code
      }
      console.error('[metadata] assign falhou:', describe(e))
      return 'network'
    }
    const posterFile = found.posterPath ? await this.images.ensure('w342', found.posterPath) : undefined
    const backdropFile = found.backdropPath ? await this.images.ensure('w780', found.backdropPath) : undefined
    meta.applyTitleMatch(this.db, titleId, {
      tmdbId: found.id,
      name: found.name,
      year: found.year,
      overview: found.overview,
      posterFile,
      backdropFile,
      source: 'manual'
    })
    this.triedImages.add(titleId)
    this.badTitles.delete(titleId)
    this.forgetSeasons(titleId)
    if (title.kind === 'series') {
      try {
        await this.fillEpisodes(titleId, found.id, (id, s) => client.season(id, s))
      } catch (e) {
        // Melhor esforço: o vínculo já foi gravado; a próxima rodada completa os episódios.
        console.error('[metadata] episódios após assign:', describe(e))
      }
    }
    this.onChange()
    return 'ok'
  }

  // --- internos ---

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private forgetSeasons(titleId: number): void {
    for (const k of [...this.triedSeasons]) if (k.startsWith(`${titleId}:`)) this.triedSeasons.delete(k)
  }

  private schedule(): void {
    if (!this.started || this.disposed || this.keyRejected || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.sync()
    }, this.retryMs)
    this.timer.unref?.()
  }

  /** Antes de cada requisição: parado, ou chave diferente da que a rodada começou, encerra a rodada. */
  private check(r: RoundCtx): void {
    if (this.disposed) throw new StopRound('stopped')
    if (r.gen !== this.keyGen || this.getClient() !== r.client) throw new StopRound('key-changed')
  }

  /** Requisição ao TMDB dentro da rodada; TmdbError passa adiante como está. */
  private async call<T>(r: RoundCtx, fn: (c: TmdbClient) => Promise<T>): Promise<T> {
    this.check(r)
    return fn(r.client)
  }

  private async round(): Promise<void> {
    const client = this.getClient()
    if (!client) return
    const r: RoundCtx = { client, gen: this.keyGen }
    let retry = false
    try {
      await this.syncPending(r)
      await this.syncMissingImages(r)
      await this.syncLinkedSeries(r)
    } catch (e) {
      if (e instanceof StopRound) {
        if (e.code === 'stopped') return
        if (e.code === 'key-changed') {
          // a rodada seguinte relê o cliente (ou para, se a chave foi apagada)
          this.rerun = true
          return
        }
        if (e.code === 'invalid-key') this.keyRejected = true
        else retry = true
        console.error('[metadata] rodada interrompida:', e.code)
      } else {
        console.error('[metadata] erro na rodada:', describe(e))
        retry = true
      }
    }
    if (retry || (!this.keyRejected && this.hasPendingLeft())) this.schedule()
  }

  /** Pendentes que ainda vale tentar nesta execução (os de resposta ruim ficam para a próxima). */
  private hasPendingLeft(): boolean {
    return meta.listPendingTitles(this.db, this.now().toISOString(), RECHECK_DAYS).some((t) => !this.badTitles.has(t.id))
  }

  /** Converte falhas do TMDB em StopRound; StopRound e erros não-TMDB passam como estão. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof TmdbError) throw new StopRound(e.code)
      throw e
    }
  }

  private async syncPending(r: RoundCtx): Promise<void> {
    const nowIso = this.now().toISOString()
    for (const t of meta.listPendingTitles(this.db, nowIso, RECHECK_DAYS)) {
      if (this.badTitles.has(t.id)) continue
      let results: TmdbTitle[]
      try {
        results = await this.call(r, (c) => c.search(t.kind, t.name, t.year))
      } catch (e) {
        if (e instanceof TmdbError && e.code === 'bad-response') {
          // Problema deste título (404/422/5xx, corpo estranho): não trava a fila. Sem markChecked,
          // a próxima execução do app tenta de novo; nesta, não repete.
          this.badTitles.add(t.id)
          console.error('[metadata] resposta inesperada do TMDB ao buscar um título; seguindo para o próximo')
          continue
        }
        if (e instanceof TmdbError) throw new StopRound(e.code) // rede, limite, chave: encerra a rodada
        throw e
      }
      const best = pickBest(results, t.name, t.year)
      if (!best) {
        // "sem resultados" é uma resposta válida: reavalia só em 7 dias.
        meta.markChecked(this.db, t.id, nowIso)
        continue
      }
      const posterFile = best.posterPath ? await this.images.ensure('w342', best.posterPath) : undefined
      const backdropFile = best.backdropPath ? await this.images.ensure('w780', best.backdropPath) : undefined
      const applied = meta.applyTitleMatch(this.db, t.id, {
        tmdbId: best.id,
        name: best.name,
        year: best.year,
        overview: best.overview,
        posterFile,
        backdropFile,
        source: 'auto'
      })
      this.triedImages.add(t.id)
      if (!applied) continue // virou manual no meio da rodada: não é mais da conta do automático
      this.onChange()
      if (t.kind === 'series') await this.guard(() => this.fillEpisodes(t.id, best.id, this.seasonIn(r)))
    }
  }

  private seasonIn(r: RoundCtx): (tvId: number, season: number) => Promise<TmdbEpisode[]> {
    return (tvId, season) => this.call(r, (c) => c.season(tvId, season))
  }

  private async syncMissingImages(r: RoundCtx): Promise<void> {
    if (this.imageExists) {
      // arquivo apagado do cache: o título volta a ser tentado nesta execução
      for (const id of meta.clearMissingImageFiles(this.db, this.imageExists)) this.triedImages.delete(id)
    }
    for (const t of meta.listMissingImages(this.db)) {
      if (this.triedImages.has(t.id)) continue
      this.check(r)
      this.triedImages.add(t.id)
      let found: TmdbTitle
      try {
        found = await this.call(r, (c) => c.details(t.kind, t.tmdbId))
      } catch (e) {
        if (e instanceof TmdbError && e.code === 'bad-response') continue
        throw e instanceof TmdbError ? new StopRound(e.code) : e
      }
      const posterFile = found.posterPath ? await this.images.ensure('w342', found.posterPath) : undefined
      const backdropFile = found.backdropPath ? await this.images.ensure('w780', found.backdropPath) : undefined
      if (!posterFile && !backdropFile) continue
      meta.applyTitleImages(this.db, t.id, { overview: found.overview, posterFile, backdropFile })
      this.onChange()
    }
  }

  private async syncLinkedSeries(r: RoundCtx): Promise<void> {
    for (const s of meta.listLinkedSeries(this.db)) {
      this.check(r)
      await this.guard(() => this.fillEpisodes(s.id, s.tmdbId, this.seasonIn(r)))
    }
  }

  /** Uma tentativa por temporada por execução do app. Falhas de rede/chave (e StopRound) propagam. */
  private async fillEpisodes(
    titleId: number,
    tmdbId: number,
    season: (tvId: number, season: number) => Promise<TmdbEpisode[]>
  ): Promise<void> {
    let changed = false
    try {
      for (const s of meta.listSeasonsNeedingEpisodes(this.db, titleId)) {
        const key = `${titleId}:${s}`
        if (this.triedSeasons.has(key)) continue
        this.triedSeasons.add(key)
        try {
          const eps = await season(tmdbId, s)
          // descarta se o vínculo mudou enquanto season() estava em andamento
          if (meta.applyEpisodes(this.db, titleId, s, eps, tmdbId)) changed = true
        } catch (e) {
          if (e instanceof TmdbError && e.code === 'bad-response') continue // temporada que o TMDB não conhece
          this.triedSeasons.delete(key) // falha transitória: a próxima rodada tenta de novo
          throw e
        }
      }
    } finally {
      if (changed) this.onChange()
    }
  }
}
