import type { Db } from '../db/database'
import * as meta from '../db/metadata'
import type { ImageCache } from './images'
import { pickBest } from './match'
import { TmdbError, type TmdbClient, type TmdbTitle } from './tmdb'

const RECHECK_DAYS = 7
const DEFAULT_RETRY_MS = 600_000

export type AssignResult = 'ok' | 'no-key' | TmdbError['code'] | 'not-found' | 'kind-mismatch'

export interface MetadataServiceDeps {
  db: Db
  /** Cliente com a chave atual, ou null se não há chave. Avaliado a cada rodada. */
  client: () => TmdbClient | null
  images: ImageCache
  now: () => Date
  onChange: () => void
  retryMs?: number
}

/** Interrompe a rodada atual (rede, limite, chave): o que sobrou fica para a próxima. */
class StopRound extends Error {
  constructor(readonly code: TmdbError['code']) {
    super(code)
  }
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

  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private disposed = false
  /** invalid-key: sem timer até alguém chamar sync() de novo (ex.: depois de salvar a chave). */
  private keyRejected = false
  /** Tentativas já feitas nesta execução do app (evita martelar o TMDB). */
  private readonly triedSeasons = new Set<string>()
  private readonly triedImages = new Set<number>()

  constructor(deps: MetadataServiceDeps) {
    this.db = deps.db
    this.getClient = deps.client
    this.images = deps.images
    this.now = deps.now
    this.onChange = deps.onChange
    this.retryMs = deps.retryMs ?? DEFAULT_RETRY_MS
  }

  start(): void {
    this.started = true
    this.disposed = false
    void this.sync()
  }

  stop(): void {
    this.started = false
    this.disposed = true
    this.clearTimer()
  }

  status(): { hasKey: boolean; syncing: boolean; pending: number } {
    return { hasKey: this.getClient() !== null, syncing: this.running !== null, pending: meta.countPending(this.db) }
  }

  sync(): Promise<void> {
    if (this.running) return this.running
    this.keyRejected = false
    this.clearTimer()
    const p = this.round()
      .catch((e) => console.error('[metadata] falha inesperada na sincronização:', describe(e)))
      .finally(() => {
        this.running = null
      })
    this.running = p
    return p
  }

  async search(kind: 'series' | 'movie', query: string, year?: number): Promise<TmdbTitle[]> {
    const q = query.trim()
    if (!q) throw new Error('Consulta vazia')
    const client = this.getClient()
    if (!client) throw new Error('Sem chave do TMDB')
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
    this.forgetSeasons(titleId)
    if (title.kind === 'series') {
      try {
        await this.fillEpisodes(titleId, found.id)
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

  private async round(): Promise<void> {
    const client = this.getClient()
    if (!client) return
    let retry = false
    try {
      await this.syncPending(client)
      await this.syncMissingImages(client)
      await this.syncLinkedSeries()
    } catch (e) {
      if (e instanceof StopRound) {
        if (e.code === 'invalid-key') this.keyRejected = true
        else retry = true
        console.error('[metadata] rodada interrompida:', e.code)
      } else {
        console.error('[metadata] erro na rodada:', describe(e))
        retry = true
      }
    }
    if (retry || (!this.keyRejected && meta.countPending(this.db) > 0)) this.schedule()
  }

  /** Converte falhas do TMDB em StopRound; erros não-TMDB passam como estão. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof TmdbError) throw new StopRound(e.code)
      throw e
    }
  }

  private async syncPending(client: TmdbClient): Promise<void> {
    const nowIso = this.now().toISOString()
    for (const t of meta.listPendingTitles(this.db, nowIso, RECHECK_DAYS)) {
      if (this.disposed) return
      const results = await this.guard(() => client.search(t.kind, t.name, t.year))
      const best = pickBest(results, t.name, t.year)
      if (!best) {
        // "sem resultados" é uma resposta válida: reavalia só em 7 dias.
        meta.markChecked(this.db, t.id, nowIso)
        continue
      }
      const posterFile = best.posterPath ? await this.images.ensure('w342', best.posterPath) : undefined
      const backdropFile = best.backdropPath ? await this.images.ensure('w780', best.backdropPath) : undefined
      meta.applyTitleMatch(this.db, t.id, {
        tmdbId: best.id,
        name: best.name,
        year: best.year,
        overview: best.overview,
        posterFile,
        backdropFile,
        source: 'auto'
      })
      this.triedImages.add(t.id)
      this.onChange()
      if (t.kind === 'series') await this.guard(() => this.fillEpisodes(t.id, best.id))
    }
  }

  private async syncMissingImages(client: TmdbClient): Promise<void> {
    for (const t of meta.listMissingImages(this.db)) {
      if (this.disposed) return
      if (this.triedImages.has(t.id)) continue
      this.triedImages.add(t.id)
      let found: TmdbTitle
      try {
        found = await client.details(t.kind, t.tmdbId)
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

  private async syncLinkedSeries(): Promise<void> {
    for (const s of meta.listLinkedSeries(this.db)) {
      if (this.disposed) return
      await this.guard(() => this.fillEpisodes(s.id, s.tmdbId))
    }
  }

  /** Uma tentativa por temporada por execução do app. Falhas de rede/chave propagam. */
  private async fillEpisodes(titleId: number, tmdbId: number): Promise<void> {
    const client = this.getClient()
    if (!client) return
    let changed = false
    for (const season of meta.listSeasonsNeedingEpisodes(this.db, titleId)) {
      const key = `${titleId}:${season}`
      if (this.triedSeasons.has(key)) continue
      this.triedSeasons.add(key)
      try {
        const eps = await client.season(tmdbId, season)
        meta.applyEpisodes(this.db, titleId, season, eps)
        changed = true
      } catch (e) {
        if (e instanceof TmdbError && e.code === 'bad-response') continue // temporada que o TMDB não conhece
        this.triedSeasons.delete(key) // falha transitória: a próxima rodada tenta de novo
        throw e
      }
    }
    if (changed) this.onChange()
  }
}
