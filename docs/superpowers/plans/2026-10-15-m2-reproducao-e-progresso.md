# M2: Reprodução e progresso. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicar em um episódio ou filme abre um painel de play (versão, áudio, legenda, "Continuar de 30:34"), o vídeo toca em tela cheia no mpv (com a interface uosc), o ponto onde parou é gravado (no máximo 5 s de perda) e o catálogo mostra barras de progresso, "Continuar assistindo" e o selo "assistido".

**Architecture:** O app Electron continua dono do catálogo e do banco; o mpv é um processo separado controlado por JSON IPC (named pipe). `MpvClient` fala o protocolo, `ProgressTracker` decide quando gravar, `PlayerService` orquestra uma sessão de reprodução (lança o mpv, aplica as faixas escolhidas, grava progresso e preferências, avisa a interface). As regras (assistido, retomar, próximo episódio, escolha de faixas) são funções puras testadas sem Electron. O mpv oficial e o uosc vão dentro do instalador, com versão e SHA-256 fixados.

**Tech Stack:** Electron 44, TypeScript, React 19, Vitest, `node:sqlite`, `node:net` (named pipe), mpv v0.41.0 (build oficial mingw x64), uosc 5.13.0.

**Spec:** `docs/superpowers/specs/2026-10-14-brammp4-player-design.md` (seções 8, 11, 12, 13, 14, 15). Plano anterior: `docs/superpowers/plans/2026-10-14-m1-catalogo-local.md`.

> **Aviso de ambiente (aprendido no M1):** as ferramentas de shell desta máquina estragam barras invertidas. Escreva e edite arquivos com as ferramentas de arquivo (não com `echo`/`sed`), escreva caminhos do Windows nos fontes com barra dupla (`'E:\\Videos\\Series'`) e confira textos com barras usando Grep/Read, não `grep` do bash.

## Global Constraints

- Plataforma: Windows x64. Node 24 no desenvolvimento e no CI. Banco: `node:sqlite` com parâmetros posicionais `?`.
- Reprodução em processo separado: `mpv --input-ipc-server=\\.\pipe\brammp4-<aleatório> --fullscreen --force-window=yes --start=<posição> --aid=<n> --sid=<n|no> [--sub-file=<externa>] --config-dir=<app>/mpv-config "<caminho do arquivo>"` (spec 8). O app observa `time-pos`, `duration` e `pause` pelo IPC.
- Quando salvar: a cada 5 s durante a reprodução; ao pausar; ao fechar o mpv (`end-file` ou saída do processo, usando a última posição conhecida). Perda máxima: 5 s.
- Assistido: posição maior ou igual a 90% da duração, ou faltando menos de 2 min. Marca `watched = 1`.
- Retomar: se a posição salva for menor que 30 s, começa do zero; senão, começa 5 s antes do ponto salvo.
- Próximo episódio: o menor `(temporada, episódio)` maior que o atual com arquivo disponível (online e não ausente).
- "Continuar assistindo": um card por título, com o item atualizado mais recentemente. Se ele estiver assistido, o card mostra o próximo episódio; se não houver próximo, o título sai da fileira.
- Escolha de faixas: o padrão vem de `prefs` da série (último idioma de áudio e legenda); se não houver, usa a faixa marcada como padrão no arquivo. Toda escolha nova é salva em `prefs`.
- Barra de progresso: `position_s / duration_s`, parte assistida colorida e restante em cinza; itens assistidos mostram a barra cheia e o selo "Assistido".
- O progresso pertence ao item (`progress.item_key`), nunca ao arquivo, ao caminho ou à letra do disco.
- Painel de play (spec 11.3): seletores de áudio, legenda (inclui "Desligada") e versão (só quando houver mais de uma disponível); botões "Continuar de 30:34" e "Começar do início".
- Binários fora do git; `scripts/fetch-binaries.mjs` baixa versões fixadas e confere o SHA-256 antes de extrair. Tudo que o app usa vai dentro do instalador (`resources/`). No app instalado, nunca cair no PATH.
- A interface só passa ao processo principal identificadores (`itemKey`, `fileId`, índices de faixa); caminhos de arquivo e de legenda são resolvidos pelo processo principal a partir do banco. Argumentos do mpv sempre em array (sem shell).
- Textos da interface em português do Brasil. Commits terminam com a mesma linha `Co-Authored-By:` dos commits anteriores da branch (`git log -3`). Uma branch por tarefa de entrega, PR para `main`; não fazer push direto na `main`.

## Desvios da spec (com motivo)

1. **Gravação ao desligar.** A spec manda usar o evento `shutdown` do `powerMonitor`; ele só existe em Linux e macOS. No Windows o app grava a cada 5 s e, como reforço de melhor esforço: `powerMonitor` `suspend` (notebook indo dormir), `session-end` da janela (fim de sessão do Windows, se existir na tipagem do Electron instalado) e `before-quit` (grava e encerra o mpv). A Task 12 corrige a spec.
2. **Regra dos 2 minutos.** "Faltando menos de 2 min" só vale depois da metade do vídeo; sem isso um clipe de 100 s seria "assistido" ao abrir.
3. **Faixas externas.** O `--sid` de uma legenda externa depende da ordem em que o mpv a registra; por isso a legenda externa escolhida é selecionada depois do `file-loaded`, procurando o arquivo na `track-list` do mpv.
4. **mpv.** A spec deixava a origem do binário em aberto (seção 16): usar o build de CI oficial do projeto mpv (`mpv-player/mpv` v0.41.0, `x86_64-w64-mingw32`), não builds de terceiros.

## Review Focus

1. **Retomar nunca pode sobrescrever o progresso salvo com ~0.** Ao abrir um episódio com ponto salvo, nada é gravado antes de o mpv confirmar que a reprodução começou (`playback-restart`); se o mpv morrer antes disso, o progresso antigo fica intacto. Testes: Task 5 (rastreador) e Task 6 (sessão que nunca armou).
2. **Disco removido durante a reprodução.** O último ponto é salvo, o episódio não é marcado como assistido por causa do corte e a interface avisa. Testes: Task 6 e Task 10.
3. **Fechar o app ou suspender o notebook com um vídeo tocando.** Grava a última posição e não deixa o mpv órfão. Testes: Task 6 (`flushAndStop`) e revisão da fiação na Task 8.
4. **Episódio com versões em duas bibliotecas ou só em disco desconectado.** Versão padrão = maior resolução online; sem nenhuma online, o botão fica desabilitado e o pedido é recusado com mensagem clara. Testes: Task 3 e Task 6.
5. **Nomes de arquivo e de legenda com acento, espaço, `[ ]`, `&`, `=`.** Chegam ao mpv intactos (array de argumentos, `--` antes do arquivo). Testes: Task 6 (argumentos) e Task 7 (mpv real abrindo um arquivo em pasta com esses caracteres).
6. **Pedido forjado ou desatualizado vindo da interface** (caminho de legenda que não pertence ao arquivo, `fileId` de outro item, números absurdos): recusado sem lançar o mpv. Testes: Task 6.

---

## Estrutura de arquivos

```
scripts/binaries.json                  + mpv, uosc, licenças (Task 7)
scripts/fetch-binaries.mjs             suporta pacote inteiro e arquivo avulso (Task 7)
electron-builder.yml                   + extraResources mpv e mpv-config (Task 7)
src/shared/types.ts                    + tipos de reprodução (Tasks 1, 2, 11)
src/shared/rules.ts                    regras puras: assistido, retomar, próximo (Task 1)
src/main/db/schema.ts                  + migração 2: titles.added_at (Task 11)
src/main/db/progress.ts                progresso, preferências, "continuar assistindo" (Task 2)
src/main/db/repo.ts                    progresso e duração no detalhe do título; recentes (Tasks 2, 11)
src/main/player/tracks.ts              escolha de faixas (puro) (Task 3)
src/main/player/options.ts             dados do painel de play (Task 3)
src/main/player/mpv-client.ts          cliente JSON IPC do mpv (Task 4)
src/main/player/tracker.ts             quando gravar o progresso (Task 5)
src/main/player/args.ts                argumentos do mpv e nome do pipe (Task 6)
src/main/player/request.ts             validação do pedido de play (Task 6)
src/main/player/service.ts             sessão de reprodução (Task 6)
src/main/paths.ts                      + mpvPath, mpvConfigDir (Task 7)
src/main/ipc.ts, src/main/index.ts, src/preload/index.ts   fiação (Task 8)
src/renderer/src/format.ts             + formatClock, progressRatio, rótulos (Task 9)
src/renderer/src/playSelection.ts      valor do <select> de legenda <-> SubChoice (Task 9)
src/renderer/src/components/ProgressBar.tsx, PlayPanel.tsx   (Task 9)
src/renderer/src/components/TitleCardView.tsx   exporta pôster (Task 10)
src/renderer/src/pages/TitlePage.tsx, Home.tsx, Libraries.tsx, App.tsx, styles.css   (Tasks 9, 10, 11)
tests/helpers/seed.ts, fake-mpv.ts, fake-child.ts, wait.ts
tests/shared/rules.test.ts
tests/db/progress.test.ts, migrate.test.ts
tests/player/*.test.ts
tests/renderer/*.test.ts
```

---

### Task 1: Tipos compartilhados e regras puras

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/rules.ts`
- Test: `tests/shared/rules.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usados por todas as tasks seguintes):
  - tipos: `ProgressView`, `ContinueCard`, `AudioOption`, `SubOption`, `SubChoice`, `TrackSelection`, `FileOption`, `PlayOptions`, `PlayRequest`, `PlayError`, `PlayResult`, `PlayerClosedReason`, `PlayerState`; `FileView.durationS?`; `ItemView.progress?`; os 5 métodos novos de `BrammApi`.
  - regras: `WATCHED_RATIO`, `WATCHED_REMAINING_S`, `RESUME_MIN_S`, `RESUME_BACK_S`, `isWatched(positionS, durationS?)`, `resumeStart(positionS | undefined, watched)`, `OrderedItem`, `nextAvailable<T extends OrderedItem>(items, currentKey)`.

- [ ] **Step 1: Escrever os testes das regras**

`tests/shared/rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isWatched, nextAvailable, resumeStart, type OrderedItem } from '../../src/shared/rules'

describe('isWatched', () => {
  it('90% ou mais conta como assistido', () => {
    expect(isWatched(3078, 3420)).toBe(true)
    expect(isWatched(3077, 3420)).toBe(false)
  })
  it('faltando menos de 2 min conta, mas só depois da metade', () => {
    expect(isWatched(481, 600)).toBe(true) // faltam 119 s
    expect(isWatched(479, 600)).toBe(false) // faltam 121 s
    expect(isWatched(10, 100)).toBe(false) // clipe curto não nasce assistido
    expect(isWatched(60, 100)).toBe(true)
  })
  it('sem duração conhecida nunca é assistido', () => {
    expect(isWatched(5000, undefined)).toBe(false)
    expect(isWatched(5000, 0)).toBe(false)
    expect(isWatched(5000, Number.NaN)).toBe(false)
  })
})

describe('resumeStart', () => {
  it('menos de 30 s recomeça do zero', () => {
    expect(resumeStart(undefined, false)).toBe(0)
    expect(resumeStart(10, false)).toBe(0)
    expect(resumeStart(29.9, false)).toBe(0)
  })
  it('volta 5 s a partir de 30 s', () => {
    expect(resumeStart(30, false)).toBe(25)
    expect(resumeStart(1834, false)).toBe(1829)
  })
  it('assistido recomeça do zero', () => {
    expect(resumeStart(1834, true)).toBe(0)
  })
})

describe('nextAvailable', () => {
  const it3: OrderedItem[] = [
    { key: 'e1', season: 1, episode: 1, available: true },
    { key: 'e2', season: 1, episode: 2, available: false },
    { key: 'e3', season: 1, episode: 3, available: true },
    { key: 's2e1', season: 2, episode: 1, available: true }
  ]
  it('pula episódios indisponíveis', () => {
    expect(nextAvailable(it3, 'e1')?.key).toBe('e3')
  })
  it('passa para a próxima temporada', () => {
    expect(nextAvailable(it3, 'e3')?.key).toBe('s2e1')
  })
  it('não há próximo depois do último ou para chave desconhecida', () => {
    expect(nextAvailable(it3, 's2e1')).toBeUndefined()
    expect(nextAvailable(it3, 'nao-existe')).toBeUndefined()
  })
  it('ordena por temporada e episódio mesmo com a lista embaralhada; filmes (sem temporada) ficam por último', () => {
    const mixed: OrderedItem[] = [
      { key: 'filme', season: null, episode: null, available: true },
      { key: 's1e2', season: 1, episode: 2, available: true },
      { key: 's1e1', season: 1, episode: 1, available: true }
    ]
    expect(nextAvailable(mixed, 's1e1')?.key).toBe('s1e2')
    expect(nextAvailable(mixed, 's1e2')?.key).toBe('filme')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/shared/rules.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/shared/rules.ts`**

```ts
export const WATCHED_RATIO = 0.9
export const WATCHED_REMAINING_S = 120
export const RESUME_MIN_S = 30
export const RESUME_BACK_S = 5

/**
 * 90% ou mais do vídeo, ou faltando menos de 2 min depois da metade.
 * A regra dos 2 min não vale antes da metade: um clipe de 100 s não pode nascer "assistido".
 */
export function isWatched(positionS: number, durationS?: number): boolean {
  if (durationS === undefined || !Number.isFinite(durationS) || durationS <= 0) return false
  if (positionS >= durationS * WATCHED_RATIO) return true
  return positionS >= durationS * 0.5 && durationS - positionS < WATCHED_REMAINING_S
}

/** De onde "Continuar" começa: 0 se não há o que continuar, senão 5 s antes do ponto salvo. */
export function resumeStart(positionS: number | undefined, watched: boolean): number {
  if (watched || positionS === undefined || !Number.isFinite(positionS) || positionS < RESUME_MIN_S) return 0
  return Math.max(0, positionS - RESUME_BACK_S)
}

export interface OrderedItem {
  key: string
  season: number | null
  episode: number | null
  available: boolean
}

function compareItems(a: OrderedItem, b: OrderedItem): number {
  const sa = a.season ?? Number.MAX_SAFE_INTEGER
  const sb = b.season ?? Number.MAX_SAFE_INTEGER
  if (sa !== sb) return sa - sb
  return (a.episode ?? Number.MAX_SAFE_INTEGER) - (b.episode ?? Number.MAX_SAFE_INTEGER)
}

/** O menor (temporada, episódio) depois do atual que tenha arquivo disponível. */
export function nextAvailable<T extends OrderedItem>(items: T[], currentKey: string): T | undefined {
  const sorted = [...items].sort(compareItems)
  const i = sorted.findIndex((x) => x.key === currentKey)
  if (i < 0) return undefined
  return sorted.slice(i + 1).find((x) => x.available)
}
```

- [ ] **Step 4: Acrescentar os tipos em `src/shared/types.ts`**

Em `FileView`, adicionar `durationS?: number` depois de `videoCodec?: string`. Em `ItemView`, adicionar `progress?: ProgressView`. Acrescentar antes de `export interface BrammApi`:

```ts
export interface ProgressView {
  positionS: number
  durationS?: number
  watched: boolean
  updatedAt: string
}

export interface ContinueCard {
  titleId: number
  titleName: string
  kind: 'series' | 'movie'
  itemKey: string
  season: number | null
  episode: number | null
  episodeName?: string
  positionS: number
  durationS?: number
  available: boolean
}

export interface AudioOption {
  /** posição 1-based entre as faixas de áudio do arquivo; é o --aid do mpv */
  typeIndex: number
  lang?: string
  title?: string
  codec: string
  isDefault: boolean
}

export interface SubOption {
  source: 'embedded' | 'external'
  /** só embutidas: posição 1-based entre as legendas do arquivo; é o --sid do mpv */
  typeIndex?: number
  /** só externas: caminho relativo à pasta da biblioteca */
  externalPath?: string
  lang?: string
  title?: string
  codec: string
  isDefault: boolean
  isForced: boolean
  isSdh: boolean
}

export type SubChoice =
  | { kind: 'off' }
  | { kind: 'embedded'; typeIndex: number }
  | { kind: 'external'; relPath: string }

export interface TrackSelection {
  audioTypeIndex: number | null
  sub: SubChoice
}

export interface FileOption {
  fileId: number
  libraryLabel: string
  height?: number
  videoCodec?: string
  available: boolean
  audio: AudioOption[]
  subs: SubOption[]
  defaults: TrackSelection
}

export interface PlayOptions {
  itemKey: string
  titleId: number
  titleName: string
  kind: 'series' | 'movie'
  season: number | null
  episode: number | null
  episodeName?: string
  files: FileOption[]
  defaultFileId: number | null
  progress?: ProgressView
  /** de onde "Continuar" começa; 0 quando não há o que continuar */
  resumeFromS: number
}

export interface PlayRequest {
  itemKey: string
  fileId: number
  startS: number
  selection: TrackSelection
}

export type PlayError = 'invalid' | 'already-playing' | 'offline' | 'missing-file' | 'mpv-missing' | 'start-failed'
export type PlayResult = { ok: true } | { ok: false; error: PlayError }
export type PlayerClosedReason = 'ended' | 'closed' | 'disconnected' | 'error'

export interface PlayerState {
  playing: boolean
  itemKey?: string
  /** ex.: "Dark · S01E03" */
  label?: string
  closedReason?: PlayerClosedReason
}
```

E dentro de `BrammApi`, depois de `getTitle`:
```ts
  getContinueWatching(): Promise<ContinueCard[]>
  getPlayOptions(itemKey: string): Promise<PlayOptions | null>
  play(req: PlayRequest): Promise<PlayResult>
  getPlayerState(): Promise<PlayerState>
  onPlayerState(cb: (s: PlayerState) => void): () => void
```

- [ ] **Step 5: Rodar os testes e o typecheck**

Run: `npx vitest run tests/shared/rules.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: erros SÓ no `src/preload/index.ts` (o objeto `api` não implementa os 5 métodos novos). Isso é esperado e será resolvido na Task 8; para manter o typecheck verde até lá, adicione provisoriamente no objeto `api` do preload:
```ts
  getContinueWatching: () => ipcRenderer.invoke('continue:list'),
  getPlayOptions: (itemKey) => ipcRenderer.invoke('play:options', itemKey),
  play: (req) => ipcRenderer.invoke('play:start', req),
  getPlayerState: () => ipcRenderer.invoke('play:state'),
  onPlayerState: (cb) => on('player:state', cb),
```
(os canais passam a existir na Task 8; até lá a interface não os chama).

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/shared tests/shared src/preload/index.ts
git commit -m "feat(player): tipos de reprodução e regras de assistido, retomar e próximo episódio"
```

---

### Task 2: Progresso, preferências e "continuar assistindo" no banco

**Files:**
- Create: `src/main/db/progress.ts`, `tests/helpers/seed.ts`
- Modify: `src/main/db/repo.ts` (getTitleDetail)
- Test: `tests/db/progress.test.ts`, `tests/db/repo.test.ts` (um teste novo)

**Interfaces:**
- Consumes: `OrderedItem`, `nextAvailable` (Task 1); `ContinueCard`, `ProgressView` (Task 1); tabelas `progress`, `prefs`, `settings` (migração 1).
- Produces:
  - `SaveProgressInput = { itemKey: string; positionS: number; durationS?: number; watched: boolean; updatedAt?: string }`
  - `saveProgress(db, p)`, `getProgress(db, itemKey): ProgressView | undefined`, `getDeviceId(db): string`
  - `type Prefs = { audioLang?: string; subLang?: string }` (`subLang` pode ser `'off'`); `getPrefs(db, titleId): Prefs`; `setPrefs(db, titleId, p)` (campo ausente mantém o valor antigo)
  - `listContinueWatching(db): ContinueCard[]`
  - `getTitleDetail` passa a devolver `ItemView.progress` e `FileView.durationS`
  - helpers de teste: `seedSeries(opts?: { online?: boolean })` → `{ db, titleId, keys, fileIds }` (série "Dark", S01E01..E03, 1380 s, 1080p, biblioteca `lib1` "HD Séries" em `E:\Videos\Series`); `seedMovie(db, name?, year?)` → `{ titleId, key, fileId }`.

- [ ] **Step 1: Criar o helper de teste `tests/helpers/seed.ts`**

```ts
import { openDatabase, type Db } from '../../src/main/db/database'
import * as repo from '../../src/main/db/repo'

/** Série "Dark" com S01E01..S01E03, um arquivo por episódio (1080p, 1380 s) na biblioteca lib1. */
export function seedSeries(opts: { online?: boolean } = {}): { db: Db; titleId: number; keys: string[]; fileIds: number[] } {
  const db = openDatabase(':memory:')
  repo.upsertLibrary(db, { id: 'lib1', label: 'HD Séries', rootPath: 'E:\\Videos\\Series' })
  if (opts.online === false) repo.setLibraryStatus(db, 'lib1', 'offline')
  const titleId = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark' })
  const keys: string[] = []
  const fileIds: number[] = []
  for (const e of [1, 2, 3]) {
    const key = `local:dark:S01E0${e}`
    repo.upsertItem(db, { key, titleId, season: 1, episode: e })
    fileIds.push(
      repo.upsertFile(db, {
        itemKey: key,
        libraryId: 'lib1',
        relPath: `Dark/Season 1/Dark.S01E0${e}.mkv`,
        size: 1,
        mtimeMs: 1,
        probe: { durationS: 1380, height: 1080, videoCodec: 'hevc', tracks: [] }
      })
    )
    keys.push(key)
  }
  return { db, titleId, keys, fileIds }
}

export function seedMovie(db: Db, name = 'Dune', year = 2021): { titleId: number; key: string; fileId: number } {
  const titleId = repo.upsertTitle(db, { kind: 'movie', localKey: `movie:${name.toLowerCase()}-${year}`, name, year })
  const key = `local:${name.toLowerCase()}-${year}`
  repo.upsertItem(db, { key, titleId, season: null, episode: null })
  const fileId = repo.upsertFile(db, {
    itemKey: key,
    libraryId: 'lib1',
    relPath: `Filmes/${name}.mkv`,
    size: 1,
    mtimeMs: 1,
    probe: { durationS: 9000, height: 1080, videoCodec: 'h264', tracks: [] }
  })
  return { titleId, key, fileId }
}
```

- [ ] **Step 2: Escrever os testes**

`tests/db/progress.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { getDeviceId, getPrefs, getProgress, listContinueWatching, saveProgress, setPrefs } from '../../src/main/db/progress'
import { seedMovie, seedSeries } from '../helpers/seed'

describe('progresso', () => {
  it('grava e relê; a duração antiga é mantida quando a nova não vem', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, durationS: 1380, watched: false })
    saveProgress(db, { itemKey: keys[0]!, positionS: 200, watched: false })
    expect(getProgress(db, keys[0]!)).toMatchObject({ positionS: 200, durationS: 1380, watched: false })
    expect(getProgress(db, 'inexistente')).toBeUndefined()
  })

  it('o id do aparelho é gerado uma vez e fica estável', () => {
    const { db } = seedSeries()
    const a = getDeviceId(db)
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(getDeviceId(db)).toBe(a)
  })

  it('preferências: campo ausente mantém o valor antigo; "off" é guardado', () => {
    const { db, titleId } = seedSeries()
    expect(getPrefs(db, titleId)).toEqual({})
    setPrefs(db, titleId, { audioLang: 'jpn' })
    setPrefs(db, titleId, { subLang: 'por' })
    expect(getPrefs(db, titleId)).toEqual({ audioLang: 'jpn', subLang: 'por' })
    setPrefs(db, titleId, { subLang: 'off' })
    expect(getPrefs(db, titleId)).toEqual({ audioLang: 'jpn', subLang: 'off' })
  })
})

describe('listContinueWatching', () => {
  it('um card por título, com o item atualizado mais recentemente', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, durationS: 1380, watched: false, updatedAt: '2026-10-01T10:00:00.000Z' })
    saveProgress(db, { itemKey: keys[1]!, positionS: 400, durationS: 1380, watched: false, updatedAt: '2026-10-02T10:00:00.000Z' })
    const cards = listContinueWatching(db)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ titleName: 'Dark', itemKey: keys[1], season: 1, episode: 2, positionS: 400, durationS: 1380, available: true })
  })

  it('item assistido mostra o próximo episódio, sem progresso', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 1370, durationS: 1380, watched: true })
    const cards = listContinueWatching(db)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ itemKey: keys[1], episode: 2, positionS: 0 })
  })

  it('o próximo episódio pula os que não têm arquivo (ausentes)', () => {
    const { db, keys, fileIds } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 1370, durationS: 1380, watched: true })
    repo.markMissing(db, 'lib1', new Set([fileIds[0]!, fileIds[2]!])) // E02 sumiu do disco
    expect(listContinueWatching(db)[0]).toMatchObject({ itemKey: keys[2], episode: 3 })
  })

  it('assistiu o último episódio: o título sai da fileira', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[2]!, positionS: 1370, durationS: 1380, watched: true })
    expect(listContinueWatching(db)).toEqual([])
  })

  it('filme: aparece enquanto não terminou e some depois de assistido', () => {
    const { db } = seedSeries()
    const m = seedMovie(db)
    saveProgress(db, { itemKey: m.key, positionS: 3000, durationS: 9000, watched: false })
    expect(listContinueWatching(db).map((c) => [c.kind, c.titleName, c.positionS])).toEqual([['movie', 'Dune', 3000]])
    saveProgress(db, { itemKey: m.key, positionS: 8900, durationS: 9000, watched: true })
    expect(listContinueWatching(db)).toEqual([])
  })

  it('biblioteca offline: o card continua, marcado como indisponível', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, durationS: 1380, watched: false })
    repo.setLibraryStatus(db, 'lib1', 'offline')
    expect(listContinueWatching(db)[0]).toMatchObject({ itemKey: keys[0], available: false })
  })

  it('item cujos arquivos foram todos removidos não aparece', () => {
    const { db, keys, fileIds } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, durationS: 1380, watched: false })
    repo.markMissing(db, 'lib1', new Set([fileIds[1]!, fileIds[2]!]))
    expect(listContinueWatching(db)).toEqual([])
  })

  it('sem duração gravada, usa a duração lida do arquivo', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 100, watched: false })
    expect(listContinueWatching(db)[0]?.durationS).toBe(1380)
  })
})
```

Acrescentar ao final de `tests/db/repo.test.ts` (importando no topo `import { saveProgress } from '../../src/main/db/progress'` e `import { seedSeries } from '../helpers/seed'`):
```ts
describe('detalhe do título com progresso', () => {
  it('traz o progresso do episódio e a duração do arquivo', () => {
    const { db, titleId, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[1]!, positionS: 400, durationS: 1380, watched: false })
    const detail = repo.getTitleDetail(db, titleId)!
    expect(detail.items[0]!.progress).toBeUndefined()
    expect(detail.items[1]!.progress).toMatchObject({ positionS: 400, durationS: 1380, watched: false })
    expect(detail.items[0]!.files[0]!.durationS).toBe(1380)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/db`
Expected: FAIL (módulo `progress` inexistente e `progress`/`durationS` ausentes).

- [ ] **Step 4: Implementar `src/main/db/progress.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { ContinueCard, ProgressView } from '../../shared/types'
import { nextAvailable, type OrderedItem } from '../../shared/rules'
import type { Db } from './database'

const nowIso = () => new Date().toISOString()

export interface SaveProgressInput {
  itemKey: string
  positionS: number
  durationS?: number
  watched: boolean
  /** só para testes e para a mescla do backup (M4); o padrão é agora */
  updatedAt?: string
}

export function getDeviceId(db: Db): string {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'device_id'`).get() as unknown as { value: string } | undefined
  if (row) return row.value
  const id = randomUUID()
  db.prepare(`INSERT INTO settings (key, value) VALUES ('device_id', ?)`).run(id)
  return id
}

export function saveProgress(db: Db, p: SaveProgressInput): void {
  db.prepare(
    `INSERT INTO progress (item_key, position_s, duration_s, watched, updated_at, device_id) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_key) DO UPDATE SET position_s = excluded.position_s,
       duration_s = COALESCE(excluded.duration_s, progress.duration_s), watched = excluded.watched,
       updated_at = excluded.updated_at, device_id = excluded.device_id`
  ).run(p.itemKey, p.positionS, p.durationS ?? null, p.watched ? 1 : 0, p.updatedAt ?? nowIso(), getDeviceId(db))
}

export function getProgress(db: Db, itemKey: string): ProgressView | undefined {
  const r = db.prepare('SELECT position_s, duration_s, watched, updated_at FROM progress WHERE item_key = ?').get(itemKey) as unknown as
    | { position_s: number; duration_s: number | null; watched: number; updated_at: string }
    | undefined
  if (!r) return undefined
  return {
    positionS: r.position_s,
    ...(r.duration_s !== null ? { durationS: r.duration_s } : {}),
    watched: r.watched === 1,
    updatedAt: r.updated_at
  }
}

/** subLang 'off' = legenda desligada. */
export type Prefs = { audioLang?: string; subLang?: string }

export function getPrefs(db: Db, titleId: number): Prefs {
  const r = db.prepare('SELECT audio_lang, sub_lang FROM prefs WHERE title_id = ?').get(titleId) as unknown as
    | { audio_lang: string | null; sub_lang: string | null }
    | undefined
  const out: Prefs = {}
  if (r?.audio_lang) out.audioLang = r.audio_lang
  if (r?.sub_lang) out.subLang = r.sub_lang
  return out
}

/** Campo ausente mantém o valor que já estava gravado. */
export function setPrefs(db: Db, titleId: number, p: Prefs): void {
  db.prepare(
    `INSERT INTO prefs (title_id, audio_lang, sub_lang) VALUES (?, ?, ?)
     ON CONFLICT(title_id) DO UPDATE SET audio_lang = COALESCE(excluded.audio_lang, prefs.audio_lang),
       sub_lang = COALESCE(excluded.sub_lang, prefs.sub_lang)`
  ).run(titleId, p.audioLang ?? null, p.subLang ?? null)
}

interface ProgressRow {
  title_id: number
  kind: 'series' | 'movie'
  title_name: string
  item_key: string
  season: number | null
  episode: number | null
  item_name: string | null
  position_s: number
  duration_s: number | null
  watched: number
  file_duration: number | null
}

interface TitleItemRow {
  key: string
  season: number | null
  episode: number | null
  name: string | null
  available: number
}

export function listContinueWatching(db: Db): ContinueCard[] {
  const rows = db.prepare(
    `SELECT t.id AS title_id, t.kind, t.name AS title_name, i.key AS item_key, i.season, i.episode, i.name AS item_name,
            p.position_s, p.duration_s, p.watched,
            (SELECT MAX(f.duration_s) FROM files f WHERE f.item_key = i.key AND f.missing = 0) AS file_duration
     FROM progress p
     JOIN items i ON i.key = p.item_key
     JOIN titles t ON t.id = i.title_id
     WHERE EXISTS (SELECT 1 FROM files f WHERE f.item_key = i.key AND f.missing = 0)
     ORDER BY p.updated_at DESC, p.rowid DESC`
  ).all() as unknown as ProgressRow[]
  const itemsStmt = db.prepare(
    `SELECT i.key, i.season, i.episode, i.name,
            EXISTS (SELECT 1 FROM files f JOIN libraries l ON l.id = f.library_id
                    WHERE f.item_key = i.key AND f.missing = 0 AND l.status = 'online') AS available
     FROM items i
     WHERE i.title_id = ? AND EXISTS (SELECT 1 FROM files f WHERE f.item_key = i.key AND f.missing = 0)`
  )
  const seen = new Set<number>()
  const cards: ContinueCard[] = []
  for (const r of rows) {
    if (seen.has(r.title_id)) continue
    seen.add(r.title_id)
    const items = (itemsStmt.all(r.title_id) as unknown as TitleItemRow[]).map((x) => ({
      key: x.key,
      season: x.season,
      episode: x.episode,
      name: x.name,
      available: x.available === 1
    }))
    const base = { titleId: r.title_id, titleName: r.title_name, kind: r.kind }
    if (r.watched !== 1) {
      const duration = r.duration_s ?? r.file_duration ?? undefined
      cards.push({
        ...base,
        itemKey: r.item_key,
        season: r.season,
        episode: r.episode,
        ...(r.item_name ? { episodeName: r.item_name } : {}),
        positionS: r.position_s,
        ...(duration !== undefined ? { durationS: duration } : {}),
        available: items.find((x) => x.key === r.item_key)?.available ?? false
      })
      continue
    }
    if (r.kind !== 'series') continue
    const next = nextAvailable<OrderedItem & { name: string | null }>(items, r.item_key)
    if (!next) continue
    cards.push({
      ...base,
      itemKey: next.key,
      season: next.season,
      episode: next.episode,
      ...(next.name ? { episodeName: next.name } : {}),
      positionS: 0,
      available: true
    })
  }
  return cards
}
```

- [ ] **Step 5: Ajustar `getTitleDetail` em `src/main/db/repo.ts`**

(a) Na consulta de arquivos, depois de `f.video_codec,` incluir `f.duration_s,` e acrescentar `duration_s: number | null` ao tipo da linha (`id: number; item_key: string; rel_path: string; height: number | null; video_codec: string | null; duration_s: number | null; missing: number ...`).

(b) Na criação do `view: FileView`, acrescentar `durationS: opt(f.duration_s),`.

(c) Antes de montar `itemViews`, buscar o progresso:
```ts
  const progressRows = db.prepare(
    `SELECT p.item_key, p.position_s, p.duration_s, p.watched, p.updated_at
     FROM progress p JOIN items i ON i.key = p.item_key WHERE i.title_id = ?`
  ).all(id) as unknown as { item_key: string; position_s: number; duration_s: number | null; watched: number; updated_at: string }[]
  const progressByItem = new Map(
    progressRows.map((r) => [
      r.item_key,
      {
        positionS: r.position_s,
        ...(r.duration_s !== null ? { durationS: r.duration_s } : {}),
        watched: r.watched === 1,
        updatedAt: r.updated_at
      } satisfies ProgressView
    ])
  )
```
(d) No `map` de `itemViews`, acrescentar `...(progressByItem.has(i.key) ? { progress: progressByItem.get(i.key)! } : {}),` antes de `files:`. Importar `ProgressView` do `../../shared/types`.

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/db && npm run typecheck`
Expected: PASS e sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add src/main/db tests/db tests/helpers/seed.ts
git commit -m "feat(db): progresso, preferências e continuar assistindo"
```

---

### Task 3: Escolha de faixas e dados do painel de play

**Files:**
- Create: `src/main/player/tracks.ts`, `src/main/player/options.ts`
- Test: `tests/player/tracks.test.ts`, `tests/player/options.test.ts`

**Interfaces:**
- Consumes: `AudioOption`, `SubOption`, `SubChoice`, `TrackSelection`, `FileOption`, `PlayOptions` (Task 1); `Prefs`, `getPrefs`, `getProgress` (Task 2); `resumeStart` (Task 1); `normalizeLang` (`src/main/parser/subtitle.ts`); `seedSeries` (Task 2).
- Produces:
  - `defaultSelection(audio, subs, prefs): TrackSelection`
  - `prefsFromSelection(audio, subs, sel): Prefs`
  - `interface MpvTrack { id: number; type: string; lang?: string; title?: string; default?: boolean; forced?: boolean; external?: boolean; 'external-filename'?: string; selected?: boolean }`
  - `findExternalSubId(trackList: MpvTrack[], absPath: string): number | undefined`
  - `prefsFromMpv(trackList: MpvTrack[], aid: unknown, sid: unknown): Prefs`
  - `buildFileOptions(db, itemKey, titleId): FileOption[]` (online primeiro, maior altura primeiro)
  - `getPlayOptions(db, itemKey): PlayOptions | null`

- [ ] **Step 1: Escrever os testes de `tracks`**

`tests/player/tracks.test.ts`:
```ts
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
```

- [ ] **Step 2: Escrever os testes de `options`**

`tests/player/options.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { saveProgress, setPrefs } from '../../src/main/db/progress'
import { getPlayOptions } from '../../src/main/player/options'
import { seedSeries } from '../helpers/seed'

describe('getPlayOptions', () => {
  it('item desconhecido ou sem arquivos devolve null', () => {
    const { db } = seedSeries()
    expect(getPlayOptions(db, 'nao-existe')).toBeNull()
  })

  it('lista faixas, escolhe os padrões pelas preferências e calcula de onde continuar', () => {
    const { db, titleId, keys, fileIds } = seedSeries()
    repo.replaceEmbeddedTracks(db, fileIds[0]!, [
      { type: 'audio', streamIndex: 1, typeIndex: 1, codec: 'aac', lang: 'jpn', isDefault: true, isForced: false },
      { type: 'audio', streamIndex: 2, typeIndex: 2, codec: 'ac3', lang: 'por', isDefault: false, isForced: false },
      { type: 'sub', streamIndex: 3, typeIndex: 1, codec: 'subrip', lang: 'eng', isDefault: false, isForced: false }
    ])
    repo.replaceExternalSubs(db, fileIds[0]!, [{ relPath: 'Dark/Season 1/Dark.S01E01.por.srt', lang: 'por', forced: false, sdh: false, codec: 'srt' }])
    setPrefs(db, titleId, { audioLang: 'por', subLang: 'por' })
    saveProgress(db, { itemKey: keys[0]!, positionS: 1834, durationS: 1380 * 2, watched: false })

    const o = getPlayOptions(db, keys[0]!)!
    expect(o).toMatchObject({ itemKey: keys[0], titleName: 'Dark', kind: 'series', season: 1, episode: 1, resumeFromS: 1829, defaultFileId: fileIds[0] })
    expect(o.files).toHaveLength(1)
    const f = o.files[0]!
    expect(f.audio.map((a) => [a.typeIndex, a.lang])).toEqual([[1, 'jpn'], [2, 'por']])
    expect(f.subs.map((s) => [s.source, s.typeIndex ?? s.externalPath])).toEqual([['embedded', 1], ['external', 'Dark/Season 1/Dark.S01E01.por.srt']])
    expect(f.defaults).toEqual({ audioTypeIndex: 2, sub: { kind: 'external', relPath: 'Dark/Season 1/Dark.S01E01.por.srt' } })
  })

  it('assistido recomeça do zero', () => {
    const { db, keys } = seedSeries()
    saveProgress(db, { itemKey: keys[0]!, positionS: 1370, durationS: 1380, watched: true })
    expect(getPlayOptions(db, keys[0]!)!.resumeFromS).toBe(0)
  })

  it('duas versões: a online de maior resolução vem primeiro e é a padrão; a offline fica listada como indisponível', () => {
    const { db, keys } = seedSeries()
    repo.upsertLibrary(db, { id: 'lib2', label: 'HD Filmes', rootPath: 'F:\\Videos' })
    repo.setLibraryStatus(db, 'lib2', 'offline')
    const offlineId = repo.upsertFile(db, { itemKey: keys[0]!, libraryId: 'lib2', relPath: 'Dark.S01E01.2160p.mkv', size: 1, mtimeMs: 1, probe: { height: 2160, tracks: [] } })
    const onlineLow = repo.upsertFile(db, { itemKey: keys[0]!, libraryId: 'lib1', relPath: 'Dark/Dark.S01E01.720p.mkv', size: 1, mtimeMs: 1, probe: { height: 720, tracks: [] } })
    const o = getPlayOptions(db, keys[0]!)!
    expect(o.files.map((f) => [f.fileId === offlineId ? 'off2160' : f.height, f.available])).toEqual([[1080, true], [720, true], ['off2160', false]])
    expect(o.defaultFileId).not.toBe(offlineId)
    expect(o.defaultFileId).not.toBe(onlineLow)
  })

  it('só versões em disco desconectado: nenhuma é padrão', () => {
    const { db, keys } = seedSeries({ online: false })
    const o = getPlayOptions(db, keys[0]!)!
    expect(o.defaultFileId).toBeNull()
    expect(o.files.every((f) => !f.available)).toBe(true)
  })

  it('arquivos marcados como ausentes não entram', () => {
    const { db, keys, fileIds } = seedSeries()
    repo.markMissing(db, 'lib1', new Set([fileIds[1]!, fileIds[2]!]))
    expect(getPlayOptions(db, keys[0]!)).toBeNull()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/player`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 4: Implementar `src/main/player/tracks.ts`**

```ts
import type { AudioOption, SubChoice, SubOption, TrackSelection } from '../../shared/types'
import type { Prefs } from '../db/progress'
import { normalizeLang } from '../parser/subtitle'

/** Normal (0) < SDH (1) < forçada (2) < forçada e SDH (3). */
function subRank(s: SubOption): number {
  return (s.isForced ? 2 : 0) + (s.isSdh ? 1 : 0)
}

function bestSub(candidates: SubOption[]): SubOption | undefined {
  return [...candidates].sort((a, b) => subRank(a) - subRank(b) || (a.source === b.source ? 0 : a.source === 'embedded' ? -1 : 1))[0]
}

function toChoice(s: SubOption): SubChoice {
  return s.source === 'embedded' ? { kind: 'embedded', typeIndex: s.typeIndex ?? 1 } : { kind: 'external', relPath: s.externalPath ?? '' }
}

export function defaultSelection(audio: AudioOption[], subs: SubOption[], prefs: Prefs): TrackSelection {
  const audioPick =
    (prefs.audioLang ? audio.find((a) => a.lang === prefs.audioLang) : undefined) ?? audio.find((a) => a.isDefault) ?? audio[0]

  let sub: SubChoice = { kind: 'off' }
  if (prefs.subLang !== 'off') {
    const preferred = prefs.subLang ? bestSub(subs.filter((s) => s.lang === prefs.subLang)) : undefined
    const flagged = subs.find((s) => s.source === 'embedded' && s.isDefault)
    const pick = preferred ?? flagged
    if (pick) sub = toChoice(pick)
  }
  return { audioTypeIndex: audioPick ? audioPick.typeIndex : null, sub }
}

/** Idiomas da escolha feita (painel de play), para gravar em `prefs`. Faixa sem idioma conhecido não vira preferência. */
export function prefsFromSelection(audio: AudioOption[], subs: SubOption[], sel: TrackSelection): Prefs {
  const out: Prefs = {}
  const a = audio.find((x) => x.typeIndex === sel.audioTypeIndex)
  if (a?.lang) out.audioLang = a.lang
  const choice = sel.sub
  if (choice.kind === 'off') out.subLang = 'off'
  else {
    const s = subs.find((x) =>
      choice.kind === 'embedded' ? x.source === 'embedded' && x.typeIndex === choice.typeIndex : x.source === 'external' && x.externalPath === choice.relPath
    )
    if (s?.lang) out.subLang = s.lang
  }
  return out
}

export interface MpvTrack {
  id: number
  type: string
  lang?: string
  title?: string
  default?: boolean
  forced?: boolean
  external?: boolean
  'external-filename'?: string
  selected?: boolean
}

const normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/** Id (para `sid`) da legenda externa que o mpv carregou a partir deste caminho absoluto. */
export function findExternalSubId(trackList: MpvTrack[], absPath: string): number | undefined {
  const want = normPath(absPath)
  return trackList.find((t) => t.type === 'sub' && t.external === true && typeof t['external-filename'] === 'string' && normPath(t['external-filename']) === want)?.id
}

/** Idiomas escolhidos pelo usuário dentro do mpv (menu do uosc), a partir de `aid` e `sid`. */
export function prefsFromMpv(trackList: MpvTrack[], aid: unknown, sid: unknown): Prefs {
  const out: Prefs = {}
  const a = typeof aid === 'number' ? trackList.find((t) => t.type === 'audio' && t.id === aid) : undefined
  const al = normalizeLang(a?.lang)
  if (al) out.audioLang = al
  if (sid === false || sid === 'no') out.subLang = 'off'
  else if (typeof sid === 'number') {
    const sl = normalizeLang(trackList.find((t) => t.type === 'sub' && t.id === sid)?.lang)
    if (sl) out.subLang = sl
  }
  return out
}
```

- [ ] **Step 5: Implementar `src/main/player/options.ts`**

```ts
import type { AudioOption, FileOption, PlayOptions, SubOption } from '../../shared/types'
import { resumeStart } from '../../shared/rules'
import type { Db } from '../db/database'
import { getPrefs, getProgress } from '../db/progress'
import { defaultSelection } from './tracks'

interface FileRow {
  id: number
  height: number | null
  video_codec: string | null
  label: string
  status: 'online' | 'offline'
}

interface TrackRow {
  file_id: number
  source: 'embedded' | 'external'
  type: 'audio' | 'sub'
  type_index: number | null
  codec: string | null
  lang: string | null
  title: string | null
  is_default: number
  is_forced: number
  is_sdh: number
  external_path: string | null
}

function optionsFromTracks(rows: TrackRow[]): { audio: AudioOption[]; subs: SubOption[] } {
  const audio: AudioOption[] = []
  const embedded: SubOption[] = []
  const external: SubOption[] = []
  for (const r of rows) {
    const common = { ...(r.lang ? { lang: r.lang } : {}), ...(r.title ? { title: r.title } : {}), codec: r.codec ?? 'desconhecido' }
    if (r.type === 'audio') audio.push({ typeIndex: r.type_index ?? 0, ...common, isDefault: r.is_default === 1 })
    else if (r.source === 'embedded')
      embedded.push({ source: 'embedded', typeIndex: r.type_index ?? 0, ...common, isDefault: r.is_default === 1, isForced: r.is_forced === 1, isSdh: false })
    else
      external.push({ source: 'external', externalPath: r.external_path ?? '', ...common, isDefault: false, isForced: r.is_forced === 1, isSdh: r.is_sdh === 1 })
  }
  audio.sort((a, b) => a.typeIndex - b.typeIndex)
  embedded.sort((a, b) => (a.typeIndex ?? 0) - (b.typeIndex ?? 0))
  return { audio, subs: [...embedded, ...external] }
}

/** Arquivos (versões) do item que ainda existem, online primeiro e depois a maior resolução. */
export function buildFileOptions(db: Db, itemKey: string, titleId: number): FileOption[] {
  const files = db.prepare(
    `SELECT f.id, f.height, f.video_codec, l.label, l.status
     FROM files f JOIN libraries l ON l.id = f.library_id
     WHERE f.item_key = ? AND f.missing = 0
     ORDER BY (l.status = 'online') DESC, f.height DESC, f.id`
  ).all(itemKey) as unknown as FileRow[]
  if (files.length === 0) return []
  const marks = files.map(() => '?').join(',')
  const tracks = db.prepare(
    `SELECT file_id, source, type, type_index, codec, lang, title, is_default, is_forced, is_sdh, external_path
     FROM tracks WHERE file_id IN (${marks}) ORDER BY id`
  ).all(...files.map((f) => f.id)) as unknown as TrackRow[]
  const prefs = getPrefs(db, titleId)
  return files.map((f) => {
    const { audio, subs } = optionsFromTracks(tracks.filter((t) => t.file_id === f.id))
    return {
      fileId: f.id,
      libraryLabel: f.label,
      ...(f.height !== null ? { height: f.height } : {}),
      ...(f.video_codec !== null ? { videoCodec: f.video_codec } : {}),
      available: f.status === 'online',
      audio,
      subs,
      defaults: defaultSelection(audio, subs, prefs)
    }
  })
}

export function getPlayOptions(db: Db, itemKey: string): PlayOptions | null {
  const item = db.prepare(
    `SELECT i.season, i.episode, i.name, i.title_id, t.name AS title_name, t.kind
     FROM items i JOIN titles t ON t.id = i.title_id WHERE i.key = ?`
  ).get(itemKey) as unknown as
    | { season: number | null; episode: number | null; name: string | null; title_id: number; title_name: string; kind: 'series' | 'movie' }
    | undefined
  if (!item) return null
  const files = buildFileOptions(db, itemKey, item.title_id)
  if (files.length === 0) return null
  const progress = getProgress(db, itemKey)
  return {
    itemKey,
    titleId: item.title_id,
    titleName: item.title_name,
    kind: item.kind,
    season: item.season,
    episode: item.episode,
    ...(item.name ? { episodeName: item.name } : {}),
    files,
    defaultFileId: files.find((f) => f.available)?.fileId ?? null,
    ...(progress ? { progress } : {}),
    resumeFromS: resumeStart(progress?.positionS, progress?.watched ?? false)
  }
}
```

- [ ] **Step 6: Rodar os testes e o typecheck**

Run: `npx vitest run tests/player && npm run typecheck`
Expected: PASS. Se o teste "duas versões" falhar na ordem, confirme que `ORDER BY (l.status = 'online') DESC, f.height DESC, f.id` está exatamente assim.

- [ ] **Step 7: Commit**

```bash
git add src/main/player tests/player
git commit -m "feat(player): escolha de faixas por preferência e dados do painel de play"
```

---

### Task 4: Cliente do JSON IPC do mpv

**Files:**
- Create: `src/main/player/mpv-client.ts`, `tests/helpers/fake-mpv.ts`, `tests/helpers/wait.ts`
- Test: `tests/player/mpv-client.test.ts`

**Interfaces:**
- Consumes: nada (só `node:net` e `node:events`).
- Produces:
  - `interface ConnectOptions { retries?: number; delayMs?: number; shouldAbort?: () => boolean; commandTimeoutMs?: number }` (padrões: 100 tentativas, 50 ms, 5000 ms)
  - `class MpvClient extends EventEmitter` com `static connect(pipePath, opts?): Promise<MpvClient>` (devolve o cliente **parado**), `start()` (começa a ler; chamar depois de registrar os handlers), `command(...args): Promise<unknown>`, `observe(name): Promise<void>`, `getProperty(name)`, `setProperty(name, value)`, `close()`. Eventos: `'property'` `(name: string, data: unknown)`, `'event'` `(msg: MpvMessage)`, `'close'`.
  - helpers de teste: `FakeMpv` (`static async start(path?)`, `path`, `props`, `commands`, `silentCommands`, `emitEvent(ev)`, `setProp(name, value)`, `dropClients()`, `close()`), `uniquePipePath()`, `waitFor(cond, timeoutMs?)`, `sleep(ms)`.

**Por que `start()` separado:** o mpv começa a mandar eventos assim que a conexão abre. Se o cliente lesse na hora, eventos como `playback-restart` chegariam antes de os handlers existirem e se perderiam. Sem `data` listener o socket fica pausado e o Node guarda os bytes.

- [ ] **Step 1: Criar os helpers de teste**

`tests/helpers/wait.ts`:
```ts
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Espera até `cond()` ser verdadeira; falha com erro claro se estourar o tempo. */
export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: tempo esgotado')
    await sleep(5)
  }
}
```

`tests/helpers/fake-mpv.ts`:
```ts
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let counter = 0
export function uniquePipePath(): string {
  const name = `brammp4-test-${process.pid}-${Date.now()}-${counter++}`
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`)
}

/** Servidor que fala o JSON IPC do mpv o suficiente para os testes. */
export class FakeMpv {
  readonly path: string
  readonly props = new Map<string, unknown>()
  readonly commands: unknown[][] = []
  /** comandos a que o servidor não responde (para testar o tempo limite) */
  readonly silentCommands = new Set<string>()
  private readonly server: net.Server
  private readonly sockets = new Set<net.Socket>()
  private readonly observed = new Set<string>()
  readonly ready: Promise<void>

  constructor(path: string = uniquePipePath()) {
    this.path = path
    this.server = net.createServer((s) => this.onConnection(s))
    this.ready = new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(path, () => resolve())
    })
  }

  static async start(path?: string): Promise<FakeMpv> {
    const m = new FakeMpv(path)
    await m.ready
    return m
  }

  private onConnection(s: net.Socket): void {
    this.sockets.add(s)
    s.setEncoding('utf8')
    let buf = ''
    s.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.trim()) this.handle(s, JSON.parse(line) as { command: unknown[]; request_id: number })
      }
    })
    s.on('close', () => this.sockets.delete(s))
    s.on('error', () => {})
  }

  private handle(s: net.Socket, msg: { command: unknown[]; request_id: number }): void {
    const [name, ...rest] = msg.command as [string, ...unknown[]]
    this.commands.push(msg.command)
    if (this.silentCommands.has(name)) return
    const reply = (error: string, data?: unknown) => s.write(JSON.stringify({ error, data, request_id: msg.request_id }) + '\n')
    switch (name) {
      case 'observe_property': {
        const prop = String(rest[1])
        this.observed.add(prop)
        reply('success')
        if (this.props.has(prop)) this.broadcast({ event: 'property-change', id: rest[0], name: prop, data: this.props.get(prop) })
        return
      }
      case 'get_property': {
        const p = String(rest[0])
        if (this.props.has(p)) reply('success', this.props.get(p))
        else reply('property unavailable')
        return
      }
      case 'set_property':
        this.setProp(String(rest[0]), rest[1])
        reply('success')
        return
      case 'quit':
        reply('success')
        this.emitEvent({ event: 'end-file', reason: 'quit' })
        return
      default:
        reply('success')
    }
  }

  private broadcast(obj: unknown): void {
    const line = JSON.stringify(obj) + '\n'
    for (const s of this.sockets) s.write(line)
  }

  emitEvent(ev: Record<string, unknown>): void {
    this.broadcast(ev)
  }

  /** Muda uma propriedade; se alguém a observa, manda o property-change. */
  setProp(name: string, value: unknown): void {
    this.props.set(name, value)
    if (this.observed.has(name)) this.broadcast({ event: 'property-change', id: 1, name, data: value })
  }

  dropClients(): void {
    for (const s of this.sockets) s.destroy()
  }

  async close(): Promise<void> {
    this.dropClients()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}
```

- [ ] **Step 2: Escrever os testes do cliente**

`tests/player/mpv-client.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import { MpvClient } from '../../src/main/player/mpv-client'
import { FakeMpv, uniquePipePath } from '../helpers/fake-mpv'
import { sleep, waitFor } from '../helpers/wait'

let fake: FakeMpv | undefined
let client: MpvClient | undefined
afterEach(async () => {
  client?.close()
  await fake?.close()
  fake = undefined
  client = undefined
})

async function setup(): Promise<{ fake: FakeMpv; client: MpvClient }> {
  fake = await FakeMpv.start()
  client = await MpvClient.connect(fake.path)
  client.start()
  return { fake, client }
}

describe('MpvClient', () => {
  it('command resolve com o dado da resposta', async () => {
    const { fake, client } = await setup()
    fake.props.set('duration', 1380.5)
    expect(await client.getProperty('duration')).toBe(1380.5)
  })

  it('command rejeita com o texto de erro do mpv', async () => {
    const { client } = await setup()
    await expect(client.getProperty('nao-existe')).rejects.toThrow('property unavailable')
  })

  it('setProperty chega ao mpv com os argumentos certos', async () => {
    const { fake, client } = await setup()
    await client.setProperty('sid', 3)
    expect(fake.commands).toContainEqual(['set_property', 'sid', 3])
  })

  it('observe entrega o valor atual e as mudanças como evento "property"', async () => {
    const { fake, client } = await setup()
    fake.props.set('time-pos', 10)
    const got: [string, unknown][] = []
    client.on('property', (name: string, data: unknown) => got.push([name, data]))
    await client.observe('time-pos')
    fake.setProp('time-pos', 15)
    await waitFor(() => got.length === 2)
    expect(got).toEqual([['time-pos', 10], ['time-pos', 15]])
  })

  it('eventos que não são de propriedade saem em "event"', async () => {
    const { fake, client } = await setup()
    const events: Record<string, unknown>[] = []
    client.on('event', (m: Record<string, unknown>) => events.push(m))
    fake.emitEvent({ event: 'end-file', reason: 'eof' })
    await waitFor(() => events.length === 1)
    expect(events[0]).toMatchObject({ event: 'end-file', reason: 'eof' })
  })

  it('eventos enviados antes de start() não se perdem', async () => {
    fake = await FakeMpv.start()
    client = await MpvClient.connect(fake.path)
    await sleep(30) // dá tempo de o servidor registrar a conexão antes de transmitir
    fake.emitEvent({ event: 'playback-restart' })
    await sleep(30)
    const events: Record<string, unknown>[] = []
    client.on('event', (m: Record<string, unknown>) => events.push(m))
    client.start()
    await waitFor(() => events.length === 1)
    expect(events[0]).toMatchObject({ event: 'playback-restart' })
  })

  it('quando o mpv cai: emite "close", rejeita o que estava pendente e os próximos comandos', async () => {
    const { fake, client } = await setup()
    fake.silentCommands.add('get_property')
    let closed = false
    client.on('close', () => (closed = true))
    const pending = client.getProperty('duration')
    const assertion = expect(pending).rejects.toThrow('mpv desconectado')
    fake.dropClients()
    await assertion
    await waitFor(() => closed)
    await expect(client.getProperty('duration')).rejects.toThrow('mpv desconectado')
  })

  it('comando sem resposta estoura o tempo limite', async () => {
    fake = await FakeMpv.start()
    client = await MpvClient.connect(fake.path, { commandTimeoutMs: 50 })
    client.start()
    fake.silentCommands.add('get_property')
    await expect(client.getProperty('duration')).rejects.toThrow('mpv não respondeu')
  })

  it('connect tenta de novo até o mpv criar o pipe', async () => {
    const path = uniquePipePath()
    const connecting = MpvClient.connect(path, { delayMs: 20, retries: 100 })
    await sleep(120)
    fake = await FakeMpv.start(path)
    client = await connecting
    client.start()
    fake.props.set('pause', true)
    expect(await client.getProperty('pause')).toBe(true)
  })

  it('connect desiste quando shouldAbort manda (o processo do mpv já morreu)', async () => {
    const t0 = Date.now()
    await expect(MpvClient.connect(uniquePipePath(), { delayMs: 10, retries: 1000, shouldAbort: () => true })).rejects.toThrow('não foi possível conectar ao mpv')
    expect(Date.now() - t0).toBeLessThan(500)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/player/mpv-client.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 4: Implementar `src/main/player/mpv-client.ts`**

```ts
import { EventEmitter } from 'node:events'
import net from 'node:net'

export interface MpvMessage {
  event?: string
  name?: string
  data?: unknown
  request_id?: number
  error?: string
  [k: string]: unknown
}

export interface ConnectOptions {
  /** tentativas de conexão enquanto o mpv ainda não criou o pipe (padrão 100) */
  retries?: number
  /** pausa entre tentativas, em ms (padrão 50) */
  delayMs?: number
  /** devolva true para parar de tentar (ex.: o processo do mpv já terminou) */
  shouldAbort?: () => boolean
  /** tempo máximo de espera por uma resposta, em ms (padrão 5000) */
  commandTimeoutMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Cliente do JSON IPC do mpv (um objeto JSON por linha). Eventos: 'property' (name, data),
 * 'event' (mensagem) e 'close'. O cliente nasce parado: registre os handlers e só então chame start(),
 * assim nenhum evento enviado logo na conexão se perde.
 */
export class MpvClient extends EventEmitter {
  private buf = ''
  private nextRequestId = 1
  private nextObserveId = 1
  private started = false
  private closed = false
  private readonly pending = new Map<number, Pending>()

  private constructor(
    private readonly socket: net.Socket,
    private readonly commandTimeoutMs: number
  ) {
    super()
    socket.on('close', () => this.onClose())
    socket.on('error', () => {
      /* o 'close' que vem em seguida trata */
    })
  }

  static async connect(pipePath: string, opts: ConnectOptions = {}): Promise<MpvClient> {
    const retries = opts.retries ?? 100
    const delay = opts.delayMs ?? 50
    let lastErr: unknown
    for (let i = 0; i < retries; i++) {
      if (opts.shouldAbort?.()) break
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.createConnection(pipePath)
          s.once('connect', () => {
            s.removeListener('error', reject)
            resolve(s)
          })
          s.once('error', reject)
        })
        return new MpvClient(socket, opts.commandTimeoutMs ?? 5000)
      } catch (e) {
        lastErr = e
        await sleep(delay)
      }
    }
    throw new Error('não foi possível conectar ao mpv' + (lastErr instanceof Error ? `: ${lastErr.message}` : ''))
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => this.onData(chunk))
  }

  command(...args: unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('mpv desconectado'))
    const id = this.nextRequestId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('mpv não respondeu'))
      }, this.commandTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.write(JSON.stringify({ command: args, request_id: id }) + '\n')
    })
  }

  async observe(name: string): Promise<void> {
    await this.command('observe_property', this.nextObserveId++, name)
  }

  getProperty(name: string): Promise<unknown> {
    return this.command('get_property', name)
  }

  setProperty(name: string, value: unknown): Promise<unknown> {
    return this.command('set_property', name, value)
  }

  close(): void {
    this.socket.destroy()
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let msg: MpvMessage
      try {
        msg = JSON.parse(line) as MpvMessage
      } catch {
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: MpvMessage): void {
    if (typeof msg.request_id === 'number') {
      const p = this.pending.get(msg.request_id)
      if (!p) return
      this.pending.delete(msg.request_id)
      clearTimeout(p.timer)
      if (msg.error === 'success') p.resolve(msg.data)
      else p.reject(new Error(String(msg.error)))
      return
    }
    if (msg.event === 'property-change' && typeof msg.name === 'string') this.emit('property', msg.name, msg.data)
    if (typeof msg.event === 'string') this.emit('event', msg)
  }

  private onClose(): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('mpv desconectado'))
    }
    this.pending.clear()
    this.emit('close')
  }
}
```

- [ ] **Step 5: Rodar os testes**

Run: `npx vitest run tests/player/mpv-client.test.ts && npm run typecheck`
Expected: PASS (9 testes). Se o teste de "eventos antes de start()" falhar em Linux/macOS, ignore: o foco é Windows (o CI é `windows-latest`).

- [ ] **Step 6: Commit**

```bash
git add src/main/player/mpv-client.ts tests/helpers tests/player/mpv-client.test.ts
git commit -m "feat(player): cliente do JSON IPC do mpv com servidor falso para testes"
```

---

### Task 5: Rastreador de progresso

**Files:**
- Create: `src/main/player/tracker.ts`
- Test: `tests/player/tracker.test.ts`

**Interfaces:**
- Consumes: `isWatched` (Task 1).
- Produces:
  - `interface SavedProgress { positionS: number; durationS?: number; watched: boolean }`
  - `class ProgressTracker` com `constructor({ save, now, intervalMs? })`, `arm()`, `isArmed`, `positionS`, `onTimePos(v)`, `onDuration(v)`, `onPause(v)`, `onEnd(reason)`, `flush()`.

**Regra central:** nada é gravado antes de `arm()` (o `playback-restart` do mpv). Isso impede que a posição ~0 de um mpv que ainda está carregando sobrescreva o ponto salvo (Review Focus 1).

- [ ] **Step 1: Escrever os testes**

`tests/player/tracker.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ProgressTracker, type SavedProgress } from '../../src/main/player/tracker'

function make() {
  const saved: SavedProgress[] = []
  let clock = 0
  const tracker = new ProgressTracker({ save: (p) => saved.push(p), now: () => clock })
  return { tracker, saved, tick: (ms: number) => (clock += ms) }
}

describe('ProgressTracker', () => {
  it('antes de armar nada é gravado (retomar nunca sobrescreve o ponto salvo com ~0)', () => {
    const { tracker, saved, tick } = make()
    tracker.onTimePos(0)
    tick(10000)
    tracker.onTimePos(0.4)
    tracker.onPause(true)
    tracker.flush()
    tracker.onEnd('quit')
    expect(saved).toEqual([])
  })

  it('depois de armar grava logo a primeira posição, e a cada 5 s', () => {
    const { tracker, saved, tick } = make()
    tracker.arm()
    tracker.onTimePos(1829)
    expect(saved.map((s) => s.positionS)).toEqual([1829]) // o ponto retomado, nunca 0
    tick(4999)
    tracker.onTimePos(1834)
    expect(saved).toHaveLength(1)
    tick(1)
    tracker.onTimePos(1835)
    expect(saved.map((s) => s.positionS)).toEqual([1829, 1835])
  })

  it('pausar grava na hora; repetir a mesma posição não grava de novo', () => {
    const { tracker, saved, tick } = make()
    tracker.arm()
    tracker.onTimePos(100)
    tick(1000)
    tracker.onTimePos(103)
    tracker.onPause(false)
    expect(saved).toHaveLength(1)
    tracker.onPause(true)
    expect(saved.map((s) => s.positionS)).toEqual([100, 103])
    tracker.onPause(true)
    tracker.flush()
    expect(saved).toHaveLength(2)
  })

  it('valores inválidos de posição e duração são ignorados', () => {
    const { tracker, saved } = make()
    tracker.arm()
    tracker.onTimePos(null)
    tracker.onTimePos(Number.NaN)
    tracker.onTimePos(-3)
    tracker.onTimePos('10')
    tracker.onDuration(0)
    tracker.onDuration('x')
    tracker.flush()
    expect(saved).toEqual([])
    expect(tracker.positionS).toBeUndefined()
  })

  it('inclui a duração depois que ela é conhecida e marca assistido pela regra', () => {
    const { tracker, saved, tick } = make()
    tracker.arm()
    tracker.onTimePos(500)
    expect(saved[0]).toEqual({ positionS: 500, watched: false })
    tracker.onDuration(1380)
    tick(5000)
    tracker.onTimePos(1300)
    expect(saved[1]).toEqual({ positionS: 1300, durationS: 1380, watched: true })
  })

  it('fim por eof: vai até a duração e conta como assistido', () => {
    const { tracker, saved } = make()
    tracker.arm()
    tracker.onDuration(1380)
    tracker.onTimePos(1370)
    tracker.onEnd('eof')
    expect(saved.at(-1)).toEqual({ positionS: 1380, durationS: 1380, watched: true })
  })

  it('fim por quit/stop/error: grava a última posição, sem forçar o fim', () => {
    for (const reason of ['quit', 'stop', 'error']) {
      const { tracker, saved } = make()
      tracker.arm()
      tracker.onDuration(1380)
      tracker.onTimePos(600)
      tracker.onEnd(reason)
      expect(saved.at(-1)).toEqual({ positionS: 600, durationS: 1380, watched: false })
    }
  })

  it('flush grava a última posição conhecida mesmo dentro dos 5 s', () => {
    const { tracker, saved, tick } = make()
    tracker.arm()
    tracker.onTimePos(100)
    tick(1000)
    tracker.onTimePos(101)
    expect(saved).toHaveLength(1)
    tracker.flush()
    expect(saved.at(-1)?.positionS).toBe(101)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/player/tracker.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/main/player/tracker.ts`**

```ts
import { isWatched } from '../../shared/rules'

export interface SavedProgress {
  positionS: number
  durationS?: number
  watched: boolean
}

export interface TrackerOptions {
  save: (p: SavedProgress) => void
  now: () => number
  /** intervalo mínimo entre gravações periódicas (padrão 5000 ms) */
  intervalMs?: number
}

const same = (a: SavedProgress, b: SavedProgress) => a.positionS === b.positionS && a.durationS === b.durationS && a.watched === b.watched

/**
 * Decide quando gravar o progresso. Nada é gravado antes de arm() (o `playback-restart` do mpv):
 * enquanto o mpv carrega, `time-pos` pode valer ~0 e apagar o ponto que o usuário tinha salvo.
 */
export class ProgressTracker {
  private armed = false
  private position: number | undefined
  private duration: number | undefined
  private lastSaveAt = Number.NEGATIVE_INFINITY
  private lastSaved: SavedProgress | undefined
  private readonly intervalMs: number

  constructor(private readonly opts: TrackerOptions) {
    this.intervalMs = opts.intervalMs ?? 5000
  }

  arm(): void {
    this.armed = true
  }

  get isArmed(): boolean {
    return this.armed
  }

  get positionS(): number | undefined {
    return this.position
  }

  onTimePos(v: unknown): void {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return
    this.position = v
    if (this.armed && this.opts.now() - this.lastSaveAt >= this.intervalMs) this.saveNow()
  }

  onDuration(v: unknown): void {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) this.duration = v
  }

  onPause(v: unknown): void {
    if (v === true) this.saveNow()
  }

  /** `eof` leva a posição até o fim (assistido); qualquer outro motivo só grava onde estava. */
  onEnd(reason: unknown): void {
    if (reason === 'eof' && this.armed && this.duration !== undefined) this.position = this.duration
    this.saveNow()
  }

  flush(): void {
    this.saveNow()
  }

  private saveNow(): void {
    if (!this.armed || this.position === undefined) return
    const next: SavedProgress = {
      positionS: this.position,
      ...(this.duration !== undefined ? { durationS: this.duration } : {}),
      watched: isWatched(this.position, this.duration)
    }
    this.lastSaveAt = this.opts.now()
    if (this.lastSaved && same(this.lastSaved, next)) return
    this.lastSaved = next
    this.opts.save(next)
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run tests/player/tracker.test.ts && npm run typecheck`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add src/main/player/tracker.ts tests/player/tracker.test.ts
git commit -m "feat(player): rastreador de progresso que só grava depois do playback-restart"
```

---

### Task 6: Argumentos do mpv, validação do pedido e sessão de reprodução

**Files:**
- Create: `src/main/player/args.ts`, `src/main/player/request.ts`, `src/main/player/service.ts`, `tests/helpers/fake-child.ts`
- Test: `tests/player/args.test.ts`, `tests/player/request.test.ts`, `tests/player/service.test.ts`

**Interfaces:**
- Consumes: `MpvClient`, `ConnectOptions` (Task 4); `ProgressTracker` (Task 5); `saveProgress`, `setPrefs` (Task 2); `buildFileOptions`, `findExternalSubId`, `prefsFromMpv`, `prefsFromSelection`, `MpvTrack` (Task 3); `PlayRequest`, `PlayResult`, `PlayerState` (Task 1); helpers `FakeMpv`, `uniquePipePath`, `waitFor`, `sleep`, `seedSeries`.
- Produces:
  - `newPipePath(): string`; `interface MpvLaunch { pipePath; configDir; filePath; title; startS; audioId: number | null; sid: number | 'no' | null; externalSubs: string[] }`; `buildMpvArgs(l): string[]`
  - `parsePlayRequest(raw: unknown): PlayRequest | null`
  - `interface ChildLike { on(event: string, listener: (...args: any[]) => void): unknown; kill(): boolean }`
  - `interface PlayerDeps { db; mpvExe(): string; configDir(): string; spawn(exe, args): ChildLike; connect(pipe, opts): Promise<MpvClient>; newPipePath(): string; exists(path): boolean; now(): number; onState(s: PlayerState): void }`
  - `class PlayerService` com `play(req): Promise<PlayResult>`, `state(): PlayerState`, `flush(): void`, `flushAndStop(): Promise<void>`.

- [ ] **Step 1: Escrever os testes de argumentos e de validação**

`tests/player/args.test.ts`:
```ts
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
```

`tests/player/request.test.ts`:
```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/player/args.test.ts tests/player/request.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `src/main/player/args.ts` e `src/main/player/request.ts`**

`src/main/player/args.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function newPipePath(): string {
  const id = randomBytes(6).toString('hex')
  return process.platform === 'win32' ? `\\\\.\\pipe\\brammp4-${id}` : join(tmpdir(), `brammp4-${id}.sock`)
}

export interface MpvLaunch {
  pipePath: string
  configDir: string
  filePath: string
  title: string
  startS: number
  audioId: number | null
  /** número = legenda embutida; 'no' = desligada; null = deixa o mpv/uosc decidir (externa é aplicada depois do file-loaded) */
  sid: number | 'no' | null
  /** caminhos absolutos; todas entram no menu do uosc */
  externalSubs: string[]
}

/** Sempre em array (sem shell). O arquivo vai depois de "--" para nunca ser lido como opção. */
export function buildMpvArgs(l: MpvLaunch): string[] {
  const args = [
    `--input-ipc-server=${l.pipePath}`,
    `--config-dir=${l.configDir}`,
    '--fullscreen',
    '--force-window=yes',
    '--osc=no',
    '--osd-bar=no',
    '--border=no',
    '--keep-open=no',
    // o mpv expande ${...} e escapes no título; tira o que poderia virar expressão
    `--title=${l.title.replace(/[$\\]/g, '')}`
  ]
  if (l.startS > 0) args.push(`--start=${l.startS.toFixed(3)}`)
  if (l.audioId !== null) args.push(`--aid=${l.audioId}`)
  if (l.sid === 'no') args.push('--sid=no')
  else if (l.sid !== null) args.push(`--sid=${l.sid}`)
  for (const s of l.externalSubs) args.push(`--sub-file=${s}`)
  args.push('--', l.filePath)
  return args
}
```

`src/main/player/request.ts`:
```ts
import type { PlayRequest, SubChoice } from '../../shared/types'

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

function parseSub(v: unknown): SubChoice | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (o.kind === 'off') return { kind: 'off' }
  if (o.kind === 'embedded' && isInt(o.typeIndex, 1, 999)) return { kind: 'embedded', typeIndex: o.typeIndex }
  if (o.kind === 'external' && typeof o.relPath === 'string' && o.relPath.length > 0 && o.relPath.length <= 1000) {
    return { kind: 'external', relPath: o.relPath }
  }
  return null
}

/** O que vem da interface é dado não confiável: só números e identificadores, nunca caminhos de arquivo. */
export function parsePlayRequest(raw: unknown): PlayRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.itemKey !== 'string' || r.itemKey.length === 0 || r.itemKey.length > 500) return null
  if (!isInt(r.fileId, 1, Number.MAX_SAFE_INTEGER)) return null
  if (typeof r.startS !== 'number' || !Number.isFinite(r.startS) || r.startS < 0 || r.startS > 1_000_000) return null
  const sel = r.selection
  if (typeof sel !== 'object' || sel === null) return null
  const s = sel as Record<string, unknown>
  const audio = s.audioTypeIndex
  if (audio !== null && !isInt(audio, 1, 999)) return null
  const sub = parseSub(s.sub)
  if (!sub) return null
  return { itemKey: r.itemKey, fileId: r.fileId, startS: r.startS, selection: { audioTypeIndex: audio as number | null, sub } }
}
```

- [ ] **Step 4: Rodar os testes de argumentos e validação**

Run: `npx vitest run tests/player/args.test.ts tests/player/request.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar `tests/helpers/fake-child.ts`**

```ts
import { EventEmitter } from 'node:events'

/** Faz o papel do processo do mpv: kill() encerra, exitNow() simula o usuário fechando o player. */
export class FakeChild extends EventEmitter {
  killed = false
  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('exit', null))
    return true
  }
  exitNow(code = 0): void {
    this.emit('exit', code)
  }
}
```

- [ ] **Step 6: Escrever os testes da sessão**

`tests/player/service.test.ts`:
```ts
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { getPrefs, getProgress } from '../../src/main/db/progress'
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

function harness(over: { online?: boolean; exists?: (p: string) => boolean; mpvExe?: () => string } = {}) {
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
      fakes.mpv = new FakeMpv(pipe)
      created.mpv.push(fakes.mpv)
      fakes.child = new FakeChild()
      return fakes.child
    },
    connect: (pipe, o) => MpvClient.connect(pipe, { ...o, delayMs: 5 }),
    newPipePath: uniquePipePath,
    exists: over.exists ?? (() => present),
    now: () => clock,
    onState: (s) => states.push(s)
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
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('duration', 1380)
    mpv.setProp('time-pos', 605)
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
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('time-pos', 605)
    await waitFor(() => saved(h)?.positionS === 605)
    h.tick(1000)
    mpv.setProp('time-pos', 607)
    mpv.setProp('pause', true)
    await waitFor(() => saved(h)?.positionS === 607)
  })

  it('usuário fecha o player: última posição salva e estado "closed"', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('time-pos', 605)
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
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('duration', 1380)
    mpv.setProp('time-pos', 1370)
    await waitFor(() => saved(h)?.positionS === 1370)
    mpv.emitEvent({ event: 'end-file', reason: 'eof' })
    h.fakes.child!.exitNow(0)
    await waitFor(() => h.states.at(-1)?.playing === false)
    expect(h.states.at(-1)?.closedReason).toBe('ended')
    expect(saved(h)).toMatchObject({ positionS: 1380, durationS: 1380, watched: true })
  })

  it('disco removido durante a reprodução: ponto salvo, não vira assistido, estado "disconnected"', async () => {
    const h = harness()
    const mpv = await start(h)
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('duration', 1380)
    mpv.setProp('time-pos', 700)
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
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('time-pos', 605)
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
    mpv.emitEvent({ event: 'playback-restart' })
    mpv.setProp('time-pos', 605)
    await waitFor(() => saved(h)?.positionS === 605)
    h.tick(1000)
    mpv.setProp('time-pos', 650)
    await sleep(30)
    h.service.flush()
    expect(saved(h)?.positionS).toBe(650)
    expect(h.service.state().playing).toBe(true)
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
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run tests/player/service.test.ts`
Expected: FAIL (módulo `service` inexistente).

- [ ] **Step 8: Implementar `src/main/player/service.ts`**

```ts
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
      tracker,
      live: false,
      closed: false,
      trackList: []
    }
    this.session = session
    let exited = false
    const gone = () => {
      exited = true
      this.finalize(session)
    }
    child.on('exit', gone)
    child.on('error', gone)

    let client: MpvClient
    try {
      client = await this.deps.connect(pipePath, { shouldAbort: () => exited })
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
    this.deps.onState(this.state())
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
    if (typeof pos === 'number' && seeking === false) s.tracker.arm()
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
        return
      case 'end-file': {
        s.endReason = String(ev.reason)
        // se o arquivo sumiu, "eof" foi só a leitura falhando: não conta como terminou
        s.tracker.onEnd(this.deps.exists(s.absPath) ? ev.reason : 'error')
        return
      }
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
    s.tracker.flush()
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
    this.deps.onState({ playing: false, itemKey: s.itemKey, closedReason: reason })
  }
}
```

- [ ] **Step 9: Rodar os testes e o typecheck**

Run: `npx vitest run tests/player && npm run typecheck`
Expected: PASS. Pontos que costumam dar trabalho:
- se um `waitFor` estourar, confira a ordem: `observe` precisa terminar antes de o teste emitir propriedades (o `play()` já espera por isso);
- no teste "o que o usuário troca dentro do mpv", o `sleep(50)` depois do `file-loaded` dá tempo de o `track-list` chegar ao serviço antes do `aid`.

- [ ] **Step 10: Commit**

```bash
git add src/main/player tests/player tests/helpers
git commit -m "feat(player): sessão de reprodução com mpv, progresso, preferências e recusa de pedidos forjados"
```

---

### Task 7: mpv e uosc dentro do instalador, e teste com o mpv de verdade

**Files:**
- Modify: `scripts/binaries.json`, `scripts/fetch-binaries.mjs`, `electron-builder.yml`, `src/main/paths.ts`
- Create: `tests/player/mpv-real.test.ts`

**Interfaces:**
- Consumes: `MpvClient` (Task 4), `findExternalSubId` (Task 3), `tests/fixtures/tiny.mkv` (M1: 1 s, 320x240, áudio AAC `por` padrão, legenda SRT `eng`).
- Produces: `vendor/mpv/mpv.exe`, `vendor/mpv-config/{scripts,fonts,script-opts/uosc.conf}`; `mpvPath(): string` e `mpvConfigDir(): string` (lançam se ausentes); instalador com `resources/mpv/` e `resources/mpv-config/`.

- [ ] **Step 1: Reescrever `scripts/fetch-binaries.mjs`**

Substituir o arquivo inteiro por:
```js
#!/usr/bin/env node
// Baixa os binários fixados em scripts/binaries.json para vendor/ e confere o SHA-256 antes de usar.
// Tipos de entrada:
//   files:      extrai o pacote e copia só os arquivos listados para vendor/<dest ou "bin">/
//   extractAll: extrai o pacote inteiro (achatando uma única pasta raiz) para vendor/<dest>/; "probe" é um arquivo que deve existir depois
//   raw:        salva o arquivo baixado como está em vendor/<raw>
// Uso: node scripts/fetch-binaries.mjs          (falha se o hash não conferir)
//      node scripts/fetch-binaries.mjs --lock   (grava o hash de entradas com sha256 vazio)
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'scripts', 'binaries.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const lock = process.argv.includes('--lock')
const vendor = join(root, 'vendor')
// tar do Windows (bsdtar) abre zip e 7z; o tar do Git Bash não abre zip.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
await mkdir(vendor, { recursive: true })

async function findFile(dir, name) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const r = await findFile(p, name)
      if (r) return r
    } else if (e.name.toLowerCase() === name.toLowerCase()) return p
  }
  return null
}

function isPresent(entry) {
  if (entry.raw) return existsSync(join(vendor, entry.raw))
  if (entry.extractAll) return existsSync(join(vendor, entry.dest, entry.probe))
  return entry.files.every((f) => existsSync(join(vendor, entry.dest ?? 'bin', f)))
}

let changed = false
for (const [name, entry] of Object.entries(manifest)) {
  const stamp = join(vendor, `${name}.sha256`)
  if (entry.sha256 && isPresent(entry) && existsSync(stamp) && (await readFile(stamp, 'utf8')).trim() === entry.sha256) {
    console.log(`${name}: já presente`)
    continue
  }
  console.log(`${name}: baixando ${entry.url}`)
  const res = await fetch(entry.url)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const sha = createHash('sha256').update(buf).digest('hex')
  if (!entry.sha256) {
    if (!lock) throw new Error(`${name}: sha256 vazio em binaries.json; rode com --lock uma vez e commite`)
    entry.sha256 = sha
    changed = true
  } else if (entry.sha256 !== sha) {
    throw new Error(`${name}: SHA-256 não confere (esperado ${entry.sha256}, obtido ${sha})`)
  }

  if (entry.raw) {
    const target = join(vendor, entry.raw)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, buf)
    console.log(`${name}: ok (${entry.raw})`)
  } else {
    const tmp = join(vendor, `${name}-tmp`)
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    const archive = join(tmp, `pacote${entry.url.slice(entry.url.lastIndexOf('.'))}`)
    await writeFile(archive, buf)
    const out = join(tmp, 'x')
    await mkdir(out)
    execFileSync(tar, ['-xf', archive, '-C', out], { stdio: 'inherit' })
    if (entry.extractAll) {
      let src = out
      const top = await readdir(out, { withFileTypes: true })
      if (top.length === 1 && top[0].isDirectory()) src = join(out, top[0].name)
      const target = join(vendor, entry.dest)
      await rm(target, { recursive: true, force: true })
      await cp(src, target, { recursive: true })
      if (!existsSync(join(target, entry.probe))) throw new Error(`${name}: ${entry.probe} não encontrado depois de extrair`)
      console.log(`${name}: ok (${entry.dest}/)`)
    } else {
      const dest = join(vendor, entry.dest ?? 'bin')
      await mkdir(dest, { recursive: true })
      for (const f of entry.files) {
        const found = await findFile(out, f)
        if (!found) throw new Error(`${name}: ${f} não encontrado no pacote`)
        await copyFile(found, join(dest, f))
      }
      console.log(`${name}: ok (${entry.files.join(', ')})`)
    }
    await rm(tmp, { recursive: true, force: true })
  }
  await writeFile(stamp, entry.sha256)
}
if (changed) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
```

- [ ] **Step 2: Atualizar `scripts/binaries.json`**

Manter a entrada `ffmpeg` exatamente como está e acrescentar (a ordem importa: cada licença vem depois do pacote que a recebe):
```json
  "mpv": {
    "url": "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-w64-mingw32.zip",
    "sha256": "a49811c0752c108b8260636f9c6f6fcb97406641c98b30f1e7b500dfb20177de",
    "extractAll": true,
    "dest": "mpv",
    "probe": "mpv.exe",
    "license": "GPL-2.0-or-later (build de CI oficial do mpv-player/mpv v0.41.0)"
  },
  "mpv-license": {
    "url": "https://raw.githubusercontent.com/mpv-player/mpv/v0.41.0/LICENSE.GPL",
    "sha256": "",
    "raw": "mpv/LICENSE.GPL"
  },
  "uosc": {
    "url": "https://github.com/tomasklaen/uosc/releases/download/5.13.0/uosc.zip",
    "sha256": "4be9da3289285300fa374496c3f1bfd7bb20ac08e890d25bd5a06b28eebe4882",
    "extractAll": true,
    "dest": "mpv-config",
    "probe": "scripts/uosc/main.lua",
    "license": "ver LICENSE do projeto tomasklaen/uosc"
  },
  "uosc-conf": {
    "url": "https://github.com/tomasklaen/uosc/releases/download/5.13.0/uosc.conf",
    "sha256": "d956aea5d2e90f7690ede41c6a23f855d045f3aa9b05932df27d8045fa3b3396",
    "raw": "mpv-config/script-opts/uosc.conf"
  },
  "uosc-license": {
    "url": "https://raw.githubusercontent.com/tomasklaen/uosc/5.13.0/LICENSE",
    "sha256": "",
    "raw": "mpv-config/LICENSE-uosc.txt"
  }
```
(os `sha256` do mpv e do uosc vêm do campo `digest` da API de releases do GitHub; as duas licenças ficam vazias para o `--lock` do próximo passo.)

- [ ] **Step 3: Baixar, conferir e travar os hashes das licenças**

Run: `node scripts/fetch-binaries.mjs --lock`
Expected: `ffmpeg: já presente`, depois `mpv`, `mpv-license`, `uosc`, `uosc-conf`, `uosc-license` com `ok`, e `binaries.json` ficando com os dois `sha256` das licenças preenchidos. Cuidados:
- Se uma licença der `HTTP 404`, descubra o nome real do arquivo com `gh api "repos/mpv-player/mpv/contents?ref=v0.41.0" --jq '.[].name'` (ou `repos/tomasklaen/uosc/contents?ref=5.13.0`), ajuste a URL e rode de novo.
- Se `uosc` falhar com "scripts/uosc/main.lua não encontrado", liste o zip (`& "$env:SystemRoot\System32\tar.exe" -tf <zip> | Select-Object -First 30` em PowerShell) e corrija `probe`; a estrutura esperada é `scripts/`, `fonts/` na raiz do zip.
- Se o `mpv` não tiver `mpv.exe` na raiz ou numa única pasta raiz, ajuste `probe`/`dest` conforme o que o zip tiver e registre no commit.

Run: `node scripts/fetch-binaries.mjs`
Expected: todas as entradas `já presente`.

Run (PowerShell) e anote no relatório: `Get-ChildItem vendor\mpv | Select-Object Name, Length` e `Get-ChildItem vendor\mpv-config -Recurse -Depth 2 | Select-Object FullName`.

- [ ] **Step 4: Resolver os caminhos do player em `src/main/paths.ts`**

Acrescentar ao final do arquivo:
```ts
function resource(...parts: string[]): string {
  return app.isPackaged ? join(process.resourcesPath, ...parts) : join(app.getAppPath(), 'vendor', ...parts)
}

/** mpv embutido (resources/mpv/mpv.exe; em desenvolvimento, vendor/mpv/mpv.exe). Nunca cai no PATH. */
export function mpvPath(): string {
  const p = resource('mpv', 'mpv.exe')
  if (!existsSync(p)) throw new Error('mpv ausente')
  return p
}

/** Pasta de configuração própria do app (uosc e opções), separada do mpv que o usuário possa ter. */
export function mpvConfigDir(): string {
  const p = resource('mpv-config')
  if (!existsSync(p)) throw new Error('configuração do mpv ausente')
  return p
}
```

- [ ] **Step 5: Empacotar no instalador**

Em `electron-builder.yml`, acrescentar à lista `extraResources` (depois da entrada de `vendor/bin`):
```yaml
  - from: vendor/mpv
    to: mpv
  - from: vendor/mpv-config
    to: mpv-config
```

- [ ] **Step 6: Escrever o teste com o mpv de verdade**

`tests/player/mpv-real.test.ts`:
```ts
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
```

- [ ] **Step 7: Rodar o teste real e a suíte inteira**

Run: `npx vitest run tests/player/mpv-real.test.ts`
Expected: PASS. Se falhar, **não ajuste o teste para passar**: o objetivo dele é descobrir se alguma suposição do plano sobre o protocolo está errada. Se `sid`/`end-file`/`external-filename` vierem num formato diferente, corrija o código de produção (`tracks.ts`, `service.ts`) e os testes falsos (`FakeMpv`) para refletir o formato real, e descreva a diferença no relatório.

Run: `npm run typecheck && npm test`
Expected: tudo passa.

- [ ] **Step 8: Gerar o instalador e conferir o conteúdo**

Run: `npm run dist`
Expected: `dist/brammp4-Setup-0.1.0.exe`. Conferir (PowerShell):
```powershell
Test-Path dist\win-unpacked\resources\mpv\mpv.exe
Test-Path dist\win-unpacked\resources\mpv-config\scripts\uosc\main.lua
Test-Path dist\win-unpacked\resources\mpv-config\script-opts\uosc.conf
Test-Path dist\win-unpacked\resources\mpv\LICENSE.GPL
(Get-Item dist\brammp4-Setup-0.1.0.exe).Length
```
Expected: quatro `True` e o tamanho do instalador (anote no relatório; deve ficar bem maior que os ~139 MB do M1).

- [ ] **Step 9: Commit**

```bash
git add scripts electron-builder.yml src/main/paths.ts tests/player/mpv-real.test.ts
git commit -m "build: mpv oficial e uosc dentro do instalador, com teste contra o mpv real"
```

---

### Task 8: Fiação no processo principal (IPC, preload, ciclo de vida)

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`

**Interfaces:**
- Consumes: `PlayerService` (Task 6), `parsePlayRequest` (Task 6), `getPlayOptions` (Task 3), `listContinueWatching` (Task 2), `mpvPath`, `mpvConfigDir` (Task 7), `newPipePath` (Task 6), `MpvClient` (Task 4).
- Produces: canais `continue:list`, `play:options`, `play:start`, `play:state` (invoke) e `player:state` (evento); `window.api.getContinueWatching/getPlayOptions/play/getPlayerState/onPlayerState`.

- [ ] **Step 1: Ampliar `src/main/ipc.ts`**

Imports novos: `import { listContinueWatching } from './db/progress'`, `import { getPlayOptions } from './player/options'`, `import { parsePlayRequest } from './player/request'` e, no `import type` de `../shared/types`, acrescentar `PlayerState, PlayRequest, PlayResult`.

`IpcContext` passa a ser:
```ts
export interface IpcContext {
  db: Db
  window: () => BrowserWindow | null
  scan: (libraryId: string) => Promise<ScanSummary>
  player: { play(req: PlayRequest): Promise<PlayResult>; state(): PlayerState }
}
```
E, no fim de `registerIpc` (antes do `}` final), acrescentar:
```ts
  ipcMain.handle('continue:list', () => listContinueWatching(ctx.db))
  ipcMain.handle('play:options', (_e, key: unknown) => (typeof key === 'string' && key.length <= 500 ? getPlayOptions(ctx.db, key) : null))
  ipcMain.handle('play:start', (_e, raw: unknown): Promise<PlayResult> | PlayResult => {
    const req = parsePlayRequest(raw)
    return req ? ctx.player.play(req) : { ok: false, error: 'invalid' }
  })
  ipcMain.handle('play:state', () => ctx.player.state())
```

- [ ] **Step 2: Ligar o `PlayerService` em `src/main/index.ts`**

Imports: `powerMonitor` junto de `app, BrowserWindow, dialog` (de `electron`); `import { spawn } from 'node:child_process'`; `import { existsSync } from 'node:fs'`; `import { mpvConfigDir, mpvPath } from './paths'` (já existe `import { binPath, dbPath } from './paths'`: acrescentar `mpvConfigDir, mpvPath`); `import { newPipePath } from './player/args'`; `import { MpvClient } from './player/mpv-client'`; `import { PlayerService } from './player/service'`.

Trocar a linha `registerIpc({ db, window: () => win, scan })` por:
```ts
    const player = new PlayerService({
      db,
      mpvExe: mpvPath,
      configDir: mpvConfigDir,
      spawn: (exe, args) => spawn(exe, args, { stdio: 'ignore' }),
      connect: (pipe, o) => MpvClient.connect(pipe, o),
      newPipePath,
      exists: existsSync,
      now: Date.now,
      onState: (s) => {
        send('player:state', s)
        if (!s.playing) win?.focus()
      }
    })

    registerIpc({ db, window: () => win, scan, player })

    // reforços além da gravação a cada 5 s (o evento 'shutdown' do powerMonitor não existe no Windows):
    // notebook indo dormir e app sendo fechado com um vídeo tocando
    powerMonitor.on('suspend', () => player.flush())
    let quitting = false
    app.on('before-quit', (e) => {
      if (quitting || !player.state().playing) return
      e.preventDefault()
      quitting = true
      void player.flushAndStop().finally(() => app.quit())
    })
```
Não passar `windowsHide` ao `spawn`: o mpv cria a própria janela e `windowsHide: true` poderia escondê-la.

Depois de `createWindow()` (no fim do `then`), conferir se a tipagem do Electron tem o evento de fim de sessão:
Run: `Select-String -Path node_modules\electron\electron.d.ts -Pattern "'session-end'" | Select-Object -First 3`
- Se aparecer, acrescentar logo após `createWindow()`: `win?.on('session-end', () => player.flush())`.
- Se não aparecer, não registrar nada e anotar no relatório (o `before-quit` e a gravação a cada 5 s cobrem).

- [ ] **Step 3: Atualizar `src/preload/index.ts`**

Os cinco métodos adicionados provisoriamente na Task 1 já cobrem o contrato; confirme que estão no objeto `api` com exatamente estes canais: `getContinueWatching → 'continue:list'`, `getPlayOptions → 'play:options'`, `play → 'play:start'`, `getPlayerState → 'play:state'`, `onPlayerState → on('player:state', cb)`. Se faltar algum, adicione.

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa.

Run (smoke, sem interação): `npm run dev` em segundo plano com a saída num arquivo, esperar ~25 s, conferir que não há erro do processo principal e encerrar o Electron (`taskkill /F /T /PID <pid>`). Não deixar processos soltos. O fluxo de reprodução em si é verificado na Task 10/12 (manual).

- [ ] **Step 5: Commit**

```bash
git add src/main src/preload
git commit -m "feat(main): IPC de reprodução, encerramento seguro do player e reforços de gravação"
```

---

### Task 9: Barras de progresso, painel de play e página do título

**Files:**
- Modify: `src/renderer/src/format.ts`, `src/renderer/src/pages/TitlePage.tsx`, `src/renderer/src/styles.css`
- Create: `src/renderer/src/playSelection.ts`, `src/renderer/src/components/ProgressBar.tsx`, `src/renderer/src/components/PlayPanel.tsx`
- Test: `tests/renderer/format.test.ts` (acrescentar), `tests/renderer/playSelection.test.ts`

**Interfaces:**
- Consumes: `window.api.getPlayOptions/play` (Task 8), tipos da Task 1, `resumeStart` (Task 1).
- Produces: `formatClock(totalS)`, `progressRatio(progress?, fallbackDurationS?)`, `minutesLabel(durationS)`, `langName(code?)`, `audioLabel(a)`, `subLabel(s)`; `choiceToValue(c)`, `valueToChoice(v)`; `<ProgressBar ratio watched?>`; `<PlayPanel itemKey onClose>`; `TitlePage` ganha a prop `onPlay(itemKey: string)`.

- [ ] **Step 1: Escrever os testes**

Acrescentar a `tests/renderer/format.test.ts` (importando os nomes novos de `../../src/renderer/src/format`):
```ts
import { audioLabel, formatClock, langName, minutesLabel, progressRatio, subLabel } from '../../src/renderer/src/format'

describe('relógio e progresso', () => {
  it('formatClock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(1834)).toBe('30:34')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(-4)).toBe('0:00')
  })
  it('minutesLabel', () => {
    expect(minutesLabel(1380)).toBe('23 min')
    expect(minutesLabel(7260)).toBe('2 h 1 min')
    expect(minutesLabel(20)).toBe('1 min')
  })
  it('progressRatio', () => {
    expect(progressRatio(undefined)).toBeUndefined()
    expect(progressRatio({ positionS: 690, durationS: 1380, watched: false })).toBe(0.5)
    expect(progressRatio({ positionS: 10, watched: false }, 1000)).toBe(0.01)
    expect(progressRatio({ positionS: 10, watched: false })).toBeUndefined()
    expect(progressRatio({ positionS: 5, durationS: 1380, watched: true })).toBe(1)
    expect(progressRatio({ positionS: 2000, durationS: 1380, watched: false })).toBe(1)
  })
  it('rótulos de faixas', () => {
    expect(langName('por')).toBe('Português')
    expect(langName('xyz')).toBe('XYZ')
    expect(langName(undefined)).toBeUndefined()
    expect(audioLabel({ typeIndex: 1, lang: 'jpn', codec: 'eac3', isDefault: true })).toBe('Japonês · EAC3')
    expect(audioLabel({ typeIndex: 2, codec: 'aac', title: 'Dublado', isDefault: false })).toBe('Idioma desconhecido · Dublado · AAC')
    expect(subLabel({ source: 'external', externalPath: 'a.srt', lang: 'por', codec: 'srt', isDefault: false, isForced: false, isSdh: false })).toBe('Português (arquivo)')
    expect(subLabel({ source: 'embedded', typeIndex: 1, lang: 'eng', codec: 'subrip', isDefault: false, isForced: true, isSdh: true })).toBe('Inglês (forçada) (SDH)')
  })
})
```

`tests/renderer/playSelection.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { choiceToValue, valueToChoice } from '../../src/renderer/src/playSelection'

describe('playSelection', () => {
  it('ida e volta', () => {
    for (const c of [{ kind: 'off' as const }, { kind: 'embedded' as const, typeIndex: 3 }, { kind: 'external' as const, relPath: 'Dark/a: b.srt' }]) {
      expect(valueToChoice(choiceToValue(c))).toEqual(c)
    }
  })
  it('valores inválidos viram null', () => {
    for (const v of ['', 'e:', 'e:0', 'e:x', 'x:', 'z:1', 'embedded']) expect(valueToChoice(v)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer`
Expected: FAIL (funções inexistentes).

- [ ] **Step 3: Implementar os helpers**

Acrescentar a `src/renderer/src/format.ts` (e importar `AudioOption`, `ProgressView`, `SubOption` de `../../shared/types`):
```ts
export function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export function minutesLabel(durationS: number): string {
  const min = Math.max(1, Math.round(durationS / 60))
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`
}

/** Fração assistida (0 a 1) para a barra; undefined quando não há como calcular. Assistido = cheia. */
export function progressRatio(p: Pick<ProgressView, 'positionS' | 'durationS' | 'watched'> | undefined, fallbackDurationS?: number): number | undefined {
  if (!p) return undefined
  if (p.watched) return 1
  const d = p.durationS ?? fallbackDurationS
  if (!d || d <= 0) return undefined
  return Math.min(1, Math.max(0, p.positionS / d))
}

const LANGS: Record<string, string> = {
  por: 'Português', eng: 'Inglês', spa: 'Espanhol', fra: 'Francês', deu: 'Alemão', ita: 'Italiano', jpn: 'Japonês'
}

export function langName(code?: string): string | undefined {
  if (!code) return undefined
  return LANGS[code] ?? code.toUpperCase()
}

export function audioLabel(a: AudioOption): string {
  return [langName(a.lang) ?? 'Idioma desconhecido', ...(a.title ? [a.title] : []), a.codec.toUpperCase()].join(' · ')
}

export function subLabel(s: SubOption): string {
  return `${langName(s.lang) ?? 'Idioma desconhecido'}${s.isForced ? ' (forçada)' : ''}${s.isSdh ? ' (SDH)' : ''}${s.source === 'external' ? ' (arquivo)' : ''}`
}
```

`src/renderer/src/playSelection.ts`:
```ts
import type { SubChoice } from '../../shared/types'

/** O <select> de legenda guarda texto; estas duas funções traduzem para a escolha tipada e de volta. */
export function choiceToValue(c: SubChoice): string {
  return c.kind === 'off' ? 'off' : c.kind === 'embedded' ? `e:${c.typeIndex}` : `x:${c.relPath}`
}

export function valueToChoice(v: string): SubChoice | null {
  if (v === 'off') return { kind: 'off' }
  if (v.startsWith('e:')) {
    const n = Number(v.slice(2))
    return Number.isInteger(n) && n >= 1 ? { kind: 'embedded', typeIndex: n } : null
  }
  if (v.startsWith('x:') && v.length > 2) return { kind: 'external', relPath: v.slice(2) }
  return null
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run tests/renderer && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Criar `ProgressBar.tsx` e `PlayPanel.tsx`**

`src/renderer/src/components/ProgressBar.tsx`:
```tsx
export function ProgressBar({ ratio, watched }: { ratio: number; watched?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div className="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={watched ? 'fill done' : 'fill'} style={{ width: `${pct}%` }} />
    </div>
  )
}
```

`src/renderer/src/components/PlayPanel.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { PlayError, PlayOptions } from '../../../shared/types'
import { audioLabel, codecLabel, formatClock, itemLabel, resolutionLabel, subLabel } from '../format'
import { choiceToValue, valueToChoice } from '../playSelection'

const ERRORS: Record<PlayError, string> = {
  invalid: 'Pedido inválido. Feche e tente de novo.',
  'already-playing': 'Já existe um vídeo em reprodução. Feche o player antes de abrir outro.',
  offline: 'O disco desta biblioteca está desconectado. Conecte-o e tente de novo.',
  'missing-file': 'O arquivo não foi encontrado. Revarra a biblioteca em Bibliotecas.',
  'mpv-missing': 'O reprodutor não foi encontrado. Reinstale o brammp4.',
  'start-failed': 'Não foi possível iniciar o reprodutor.'
}

export function PlayPanel({ itemKey, onClose }: { itemKey: string; onClose: () => void }) {
  const [opts, setOpts] = useState<PlayOptions | null | undefined>(undefined)
  const [fileId, setFileId] = useState<number | null>(null)
  const [audio, setAudio] = useState('')
  const [sub, setSub] = useState('off')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function pickFile(o: PlayOptions, id: number | null): void {
    setFileId(id)
    const f = o.files.find((x) => x.fileId === id)
    setAudio(f?.defaults.audioTypeIndex != null ? String(f.defaults.audioTypeIndex) : '')
    setSub(f ? choiceToValue(f.defaults.sub) : 'off')
  }

  useEffect(() => {
    let cancelled = false
    window.api.getPlayOptions(itemKey).then(
      (o) => {
        if (cancelled) return
        setOpts(o)
        if (o) pickFile(o, o.defaultFileId ?? o.files[0]?.fileId ?? null)
      },
      () => !cancelled && setOpts(null)
    )
    return () => {
      cancelled = true
    }
  }, [itemKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const file = opts?.files.find((f) => f.fileId === fileId)
  const versions = opts?.files.filter((f) => f.available) ?? []

  async function start(startS: number): Promise<void> {
    if (!opts || !file) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.play({
        itemKey,
        fileId: file.fileId,
        startS,
        selection: { audioTypeIndex: audio === '' ? null : Number(audio), sub: valueToChoice(sub) ?? { kind: 'off' } }
      })
      if (r.ok) onClose()
      else setError(ERRORS[r.error])
    } catch {
      setError(ERRORS['start-failed'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Painel de play">
        {opts === undefined && <p>Carregando…</p>}
        {opts === null && (
          <>
            <p>Este item não está mais no catálogo.</p>
            <button onClick={onClose}>Fechar</button>
          </>
        )}
        {opts && (
          <>
            <h2>{opts.titleName}</h2>
            <div className="meta">
              {opts.kind === 'series' ? `${itemLabel(opts.season, opts.episode)}${opts.episodeName ? ` · ${opts.episodeName}` : ''}` : 'Filme'}
            </div>

            {opts.defaultFileId === null && (
              <p className="error">O disco desta biblioteca está desconectado. Conecte-o para assistir.</p>
            )}

            {versions.length > 1 && (
              <label className="field">
                Versão
                <select value={fileId ?? ''} onChange={(e) => pickFile(opts, Number(e.target.value))}>
                  {versions.map((f) => (
                    <option key={f.fileId} value={f.fileId}>
                      {[resolutionLabel(f.height), codecLabel(f.videoCodec), f.libraryLabel].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {file && (
              <>
                <label className="field">
                  Áudio
                  <select value={audio} onChange={(e) => setAudio(e.target.value)} disabled={file.audio.length === 0}>
                    {file.audio.length === 0 && <option value="">Padrão do arquivo</option>}
                    {file.audio.map((a) => (
                      <option key={a.typeIndex} value={String(a.typeIndex)}>{audioLabel(a)}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Legenda
                  <select value={sub} onChange={(e) => setSub(e.target.value)}>
                    <option value="off">Desligada</option>
                    {file.subs.map((s) => {
                      const value = choiceToValue(s.source === 'embedded' ? { kind: 'embedded', typeIndex: s.typeIndex ?? 1 } : { kind: 'external', relPath: s.externalPath ?? '' })
                      return <option key={value} value={value}>{subLabel(s)}</option>
                    })}
                  </select>
                </label>
              </>
            )}

            {error && <p className="error">{error}</p>}

            <div className="actions">
              {opts.resumeFromS > 0 ? (
                <>
                  <button className="primary" disabled={busy || !file?.available} onClick={() => void start(opts.resumeFromS)}>
                    Continuar de {formatClock(opts.resumeFromS)}
                  </button>
                  <button disabled={busy || !file?.available} onClick={() => void start(0)}>Começar do início</button>
                </>
              ) : (
                <button className="primary" disabled={busy || !file?.available} onClick={() => void start(0)}>Assistir</button>
              )}
              <button onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Integrar à página do título**

Em `src/renderer/src/pages/TitlePage.tsx`:
- imports: `ProgressBar` de `../components/ProgressBar`; de `../format` acrescentar `minutesLabel, progressRatio`; de `../../../shared/rules` importar `resumeStart`.
- assinatura: `export function TitlePage({ id, refresh, onBack, onPlay }: { id: number; refresh: number; onBack: () => void; onPlay: (itemKey: string) => void })`.
- Substituir o bloco `items.map(...)` por:
```tsx
      {items.map((item) => {
        const best = item.files.find((f) => f.available) ?? item.files[0]
        if (!best) return null
        const offline = !item.files.some((f) => f.available)
        const watched = item.progress?.watched ?? false
        const ratio = progressRatio(item.progress, best.durationS)
        const canResume = resumeStart(item.progress?.positionS, watched) > 0
        return (
          <div key={item.key} className={`episode${offline ? ' unavailable' : ''}`}>
            <div className="code">{itemLabel(item.season, item.episode)}</div>
            <div className="info">
              <div>{item.episode !== null ? `Episódio ${item.episode}${item.name ? ` · ${item.name}` : ''}` : detail.name}</div>
              <div>
                <FileBadges f={best} />
                {best.durationS ? <span className="badge">{minutesLabel(best.durationS)}</span> : null}
                {item.files.length > 1 && <span className="badge">{item.files.length} versões</span>}
                {watched && <span className="badge done">Assistido</span>}
                {offline && <span className="badge">conecte {best.libraryLabel}</span>}
              </div>
              {ratio !== undefined && <ProgressBar ratio={ratio} watched={watched} />}
            </div>
            <button className="primary" disabled={offline} onClick={() => onPlay(item.key)}>
              {canResume ? 'Continuar' : watched ? 'Assistir de novo' : 'Assistir'}
            </button>
          </div>
        )
      })}
```

- [ ] **Step 7: Estilos**

Acrescentar ao final de `src/renderer/src/styles.css`:
```css
.pbar { height: 4px; background: #555; border-radius: 2px; overflow: hidden; margin-top: 8px; max-width: 320px; }
.pbar .fill { height: 100%; background: var(--accent); }
.pbar .fill.done { background: var(--ok); }
.badge.done { color: var(--ok); border-color: var(--ok); }
.episode button { flex: none; }
.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center; z-index: 10; padding: 16px; }
.modal { background: var(--panel); border-radius: 8px; padding: 24px; width: min(520px, 100%); max-height: 90vh; overflow: auto; }
.modal h2 { margin: 0 0 4px; }
.field { display: flex; flex-direction: column; gap: 4px; margin: 14px 0; font-size: 13px; color: var(--muted); }
.field select { font: inherit; padding: 8px 10px; border-radius: 4px; border: 1px solid #444; background: #000; color: var(--text); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 20px; }
.banner.now-playing { border-left-color: var(--ok); }
.banner.warn { cursor: pointer; }
.card.wide { flex-basis: 240px; }
.card .pbar { max-width: none; }
```

- [ ] **Step 8: Verificar**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa (o App ainda não passa `onPlay` ao `TitlePage`: o typecheck vai acusar; para manter o verde, a Task 10 faz essa ligação; **então faça a ligação mínima agora**: em `App.tsx`, trocar `<TitlePage id={view.id} refresh={refresh} onBack={...} />` por `<TitlePage id={view.id} refresh={refresh} onBack={...} onPlay={() => {}} />` e a Task 10 substitui o arquivo inteiro).

- [ ] **Step 9: Commit**

```bash
git add src/renderer tests/renderer
git commit -m "feat(ui): painel de play, barras de progresso e botão de assistir nos episódios"
```

---

### Task 10: Início com "Continuar assistindo", aviso do player e fluxo completo no App

**Files:**
- Modify: `src/renderer/src/App.tsx` (substituir o arquivo), `src/renderer/src/pages/Home.tsx`, `src/renderer/src/components/TitleCardView.tsx`

**Interfaces:**
- Consumes: `window.api.getContinueWatching/getPlayerState/onPlayerState` (Task 8), `PlayPanel` (Task 9), `ProgressBar`, `progressRatio`, `formatClock`, `itemLabel` (Task 9).
- Produces: `Home` ganha a prop `onPlay(itemKey)`; `TitleCardView.tsx` passa a exportar `posterStyle(name)` e `initials(name)`.

- [ ] **Step 1: Exportar o pôster em `TitleCardView.tsx`**

Substituir o arquivo por:
```tsx
import type { CSSProperties } from 'react'
import type { TitleCard } from '../../../shared/types'

function hue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]!.toUpperCase()).join('')
}

export function posterStyle(name: string): CSSProperties {
  const h = hue(name)
  return { background: `linear-gradient(160deg, hsl(${h} 45% 35%), hsl(${(h + 40) % 360} 50% 15%))` }
}

export function TitleCardView({ card, onOpen }: { card: TitleCard; onOpen: (id: number) => void }) {
  return (
    <div className={`card${card.available ? '' : ' unavailable'}`} onClick={() => onOpen(card.id)} title={card.name}>
      <div className="poster" style={posterStyle(card.name)}>{initials(card.name)}</div>
      <div className="name">{card.name}</div>
      <div className="meta">
        {card.year ?? ''}
        {!card.available && card.offlineLabels.length > 0 && ` · conecte ${card.offlineLabels.join(' ou ')}`}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Atualizar `Home.tsx`**

Substituir o arquivo por:
```tsx
import { useEffect, useState } from 'react'
import type { Catalog, ContinueCard, LibraryView, TitleCard } from '../../../shared/types'
import { ProgressBar } from '../components/ProgressBar'
import { initials, posterStyle, TitleCardView } from '../components/TitleCardView'
import { formatClock, itemLabel, progressRatio } from '../format'

function Row({ title, cards, onOpen }: { title: string; cards: TitleCard[]; onOpen: (id: number) => void }) {
  if (cards.length === 0) return null
  return (
    <section className="row">
      <h2>{title}</h2>
      <div className="cards">{cards.map((c) => <TitleCardView key={c.id} card={c} onOpen={onOpen} />)}</div>
    </section>
  )
}

function ContinueCardView({ card, onPlay }: { card: ContinueCard; onPlay: (itemKey: string) => void }) {
  const ratio = progressRatio({ positionS: card.positionS, durationS: card.durationS, watched: false })
  const remaining = card.durationS ? Math.max(0, card.durationS - card.positionS) : undefined
  return (
    <div className={`card wide${card.available ? '' : ' unavailable'}`} onClick={() => onPlay(card.itemKey)} title={card.titleName}>
      <div className="poster" style={posterStyle(card.titleName)}>{initials(card.titleName)}</div>
      <div className="name">{card.titleName}</div>
      <div className="meta">
        {card.kind === 'series' ? `${itemLabel(card.season, card.episode)}${card.episodeName ? ` · ${card.episodeName}` : ''}` : 'Filme'}
        {card.positionS > 0 && remaining !== undefined ? ` · faltam ${formatClock(remaining)}` : ''}
        {!card.available && ' · disco desconectado'}
      </div>
      {ratio !== undefined && ratio > 0 && <ProgressBar ratio={ratio} />}
    </div>
  )
}

export function Home({
  refresh,
  libraries,
  onOpen,
  onPlay
}: {
  refresh: number
  libraries: LibraryView[]
  onOpen: (id: number) => void
  onPlay: (itemKey: string) => void
}) {
  const [catalog, setCatalog] = useState<Catalog>({ series: [], movies: [] })
  const [continueCards, setContinueCards] = useState<ContinueCard[]>([])
  useEffect(() => {
    let cancelled = false
    void window.api.getCatalog().then((c) => !cancelled && setCatalog(c))
    void window.api.getContinueWatching().then((c) => !cancelled && setContinueCards(c), () => {})
    return () => {
      cancelled = true
    }
  }, [refresh])
  const offline = libraries.filter((l) => l.status === 'offline')
  const empty = catalog.series.length === 0 && catalog.movies.length === 0
  return (
    <main>
      {offline.length > 0 && <div className="banner">Desconectado: {offline.map((l) => l.label).join(', ')}. Os títulos continuam aqui, acinzentados.</div>}
      {empty && <p>Nenhum título ainda. Se a varredura estiver em andamento, aguarde; senão, confira a pasta em Bibliotecas.</p>}
      {continueCards.length > 0 && (
        <section className="row">
          <h2>Continuar assistindo</h2>
          <div className="cards">{continueCards.map((c) => <ContinueCardView key={c.titleId} card={c} onPlay={onPlay} />)}</div>
        </section>
      )}
      <Row title="Séries" cards={catalog.series} onOpen={onOpen} />
      <Row title="Filmes" cards={catalog.movies} onOpen={onOpen} />
    </main>
  )
}
```

- [ ] **Step 3: Substituir `App.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { LibraryView, PlayerState, ScanProgress, ScanSummary } from '../../shared/types'
import { PlayPanel } from './components/PlayPanel'
import { Home } from './pages/Home'
import { Libraries } from './pages/Libraries'
import { TitlePage } from './pages/TitlePage'

type View = { name: 'home' } | { name: 'title'; id: number } | { name: 'libraries' }

const CLOSED_NOTICES: Partial<Record<NonNullable<PlayerState['closedReason']>, string>> = {
  disconnected: 'O disco foi desconectado durante a reprodução. Seu ponto foi salvo.',
  error: 'Não foi possível reproduzir este vídeo.'
}

export function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const [libraries, setLibraries] = useState<LibraryView[]>([])
  const [progress, setProgress] = useState<Record<string, ScanProgress>>({})
  const [summaries, setSummaries] = useState<Record<string, ScanSummary>>({})
  const [refresh, setRefresh] = useState(0)
  const [playItem, setPlayItem] = useState<string | null>(null)
  const [player, setPlayer] = useState<PlayerState>({ playing: false })
  const [notice, setNotice] = useState<string | null>(null)

  const reloadLibraries = () => void window.api.listLibraries().then(setLibraries)
  const closePanel = useCallback(() => setPlayItem(null), [])

  useEffect(() => {
    void window.api.listLibraries().then((libs) => {
      setLibraries(libs)
      if (libs.length === 0) setView({ name: 'libraries' })
    })
    void window.api.getPlayerState().then(setPlayer, () => {})
    const offs = [
      window.api.onLibraryStatus(() => {
        reloadLibraries()
        setRefresh((r) => r + 1)
      }),
      window.api.onScanProgress((p) => setProgress((cur) => ({ ...cur, [p.libraryId]: p }))),
      window.api.onScanDone((s) => {
        setSummaries((cur) => ({ ...cur, [s.libraryId]: s }))
        setProgress((cur) => {
          const { [s.libraryId]: _done, ...rest } = cur
          return rest
        })
        reloadLibraries()
        setRefresh((r) => r + 1)
      }),
      window.api.onPlayerState((s) => {
        setPlayer(s)
        if (!s.playing) {
          setRefresh((r) => r + 1) // barras e "Continuar assistindo" mudaram
          setNotice((s.closedReason && CLOSED_NOTICES[s.closedReason]) || null)
        } else setNotice(null)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 10000)
    return () => clearTimeout(t)
  }, [notice])

  return (
    <>
      <header className="top">
        <span className="logo" onClick={() => setView({ name: 'home' })}>brammp4</span>
        <span className="spacer" />
        <button onClick={() => setView({ name: 'libraries' })}>Bibliotecas</button>
      </header>
      {player.playing && (
        <div className="banner now-playing">Reproduzindo: {player.label}. Feche o player (tecla Q ou o X da janela) para voltar ao catálogo.</div>
      )}
      {notice && <div className="banner warn" onClick={() => setNotice(null)}>{notice}</div>}
      {view.name === 'home' && (
        <Home refresh={refresh} libraries={libraries} onOpen={(id) => setView({ name: 'title', id })} onPlay={setPlayItem} />
      )}
      {view.name === 'title' && (
        <TitlePage id={view.id} refresh={refresh} onBack={() => setView({ name: 'home' })} onPlay={setPlayItem} />
      )}
      {view.name === 'libraries' && (
        <Libraries libraries={libraries} progress={progress} summaries={summaries} onChanged={reloadLibraries} />
      )}
      {playItem && <PlayPanel itemKey={playItem} onClose={closePanel} />}
    </>
  )
}
```

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa.

- [ ] **Step 5: Roteiro manual (para o relatório; o agente executa o que for possível e lista o que ficou para a pessoa)**

Com `npm run dev`, a pasta de teste `%TEMP%\brammp4-demo` (ou a biblioteca real) e o mpv em `vendor/mpv`:
1. Abrir um episódio: o painel mostra versão (só se houver mais de uma), áudio, legenda e "Assistir".
2. Assistir 1 minuto, fechar o player (tecla Q): o painel do título mostra a barra, e o Início mostra o card em "Continuar assistindo".
3. Reabrir: o painel oferece "Continuar de 0:55" e "Começar do início".
4. Fechar o app com o vídeo tocando: reabrir e conferir que o ponto foi salvo e que não ficou `mpv.exe` no Gerenciador de Tarefas.
5. Desconectar o disco com o vídeo tocando (ou renomear a pasta): aviso "disco desconectado" e o ponto salvo.
6. Ver se o uosc aparece (barra moderna de controles; menus de áudio e legenda).

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat(ui): continuar assistindo, aviso do player e fluxo de reprodução no App"
```

---

### Task 11: Pendências de tela adiadas do M1 ("Adicionados recentemente" e temporadas no resumo)

**Files:**
- Modify: `src/main/db/schema.ts`, `src/main/db/repo.ts`, `src/shared/types.ts`, `src/main/scanner/scan.ts`, `src/main/index.ts`, `src/renderer/src/pages/Home.tsx`, `src/renderer/src/pages/Libraries.tsx`, `tests/db/repo.test.ts`
- Test: `tests/db/migrate.test.ts`, `tests/db/repo.test.ts`

**Interfaces:**
- Consumes: `MIGRATIONS`, `migrate` (`src/main/db/schema.ts`, `database.ts`), `getCatalog`, `librarySummary`.
- Produces: `titles.added_at`; `Catalog.recent: TitleCard[]` (até 12, mais novos primeiro); `ScanSummary.seasons: number`.

- [ ] **Step 1: Escrever os testes**

`tests/db/migrate.test.ts`:
```ts
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import { MIGRATIONS } from '../../src/main/db/schema'

describe('migrações', () => {
  it('banco novo chega na versão atual com titles.added_at', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const { user_version } = db.prepare('PRAGMA user_version').get() as unknown as { user_version: number }
    expect(user_version).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT added_at FROM titles').all()).toEqual([])
  })

  it('banco do M1 (versão 1) é atualizado e títulos antigos ganham uma data', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(MIGRATIONS[0]!)
    db.exec('PRAGMA user_version = 1')
    db.prepare(`INSERT INTO titles (kind, local_key, name) VALUES ('movie', 'movie:x', 'X')`).run()
    migrate(db)
    const row = db.prepare('SELECT added_at FROM titles').get() as unknown as { added_at: string | null }
    expect(row.added_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
```

Acrescentar a `tests/db/repo.test.ts`:
```ts
describe('adicionados recentemente e temporadas', () => {
  it('catalog.recent traz os títulos mais novos primeiro (no máximo 12)', () => {
    const { db } = seedSeries()
    const m = seedMovie(db)
    db.prepare('UPDATE titles SET added_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', m.titleId)
    const cat = repo.getCatalog(db)
    expect(cat.recent.map((c) => c.name)).toEqual(['Dark', 'Dune'])
    for (let i = 0; i < 20; i++) seedMovie(db, `Filme ${i}`, 2000 + i)
    expect(repo.getCatalog(db).recent).toHaveLength(12)
  })

  it('o resumo da biblioteca conta as temporadas', () => {
    const { db, titleId } = seedSeries()
    repo.upsertItem(db, { key: 'local:dark:S02E01', titleId, season: 2, episode: 1 })
    repo.upsertFile(db, { itemKey: 'local:dark:S02E01', libraryId: 'lib1', relPath: 'Dark/Season 2/e1.mkv', size: 1, mtimeMs: 1 })
    expect(repo.librarySummary(db, 'lib1')).toMatchObject({ series: 1, seasons: 2, episodes: 4 })
  })
})
```
(importar `seedMovie` e `seedSeries` de `../helpers/seed` no topo do arquivo, se ainda não estiverem importados). Em `tests/db/repo.test.ts`, o teste existente "resumo da biblioteca" usa `toEqual({ series: 1, movies: 0, episodes: 1, subtitles: 1, unmatched: 1 })`: acrescentar `seasons: 1` a esse objeto.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/db`
Expected: FAIL (`added_at`, `recent`, `seasons` inexistentes).

- [ ] **Step 3: Migração 2**

Em `src/main/db/schema.ts`, acrescentar um segundo elemento ao array `MIGRATIONS` (depois da string existente, separado por vírgula):
```ts
  `
  ALTER TABLE titles ADD COLUMN added_at TEXT;
  UPDATE titles SET added_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE added_at IS NULL;
  `
```

- [ ] **Step 4: `repo.ts` e tipos**

(a) `upsertTitle`: trocar o `INSERT` por
```ts
    `INSERT INTO titles (kind, local_key, name, year, added_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(local_key) DO UPDATE SET name = excluded.name, year = COALESCE(excluded.year, titles.year)
     WHERE titles.tmdb_id IS NULL`
```
e `.run(t.kind, t.localKey, t.name, t.year ?? null, now())`.

(b) `getCatalog`: acrescentar `t.added_at` à lista do `SELECT`; no tipo `CatalogRow` incluir `added_at: string | null`; no mapa de cards guardar `addedAt` (`const c = cards.get(r.id) ?? { ..., addedAt: r.added_at ?? '' }`, e o tipo do mapa passa a `TitleCard & { visible: boolean; addedAt: string }`). Ao montar o resultado:
```ts
  const all = [...cards.values()].filter((c) => c.visible)
  const strip = ({ visible: _v, addedAt: _a, ...c }: TitleCard & { visible: boolean; addedAt: string }): TitleCard => c
  const list = all.map(strip).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const recent = [...all].sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 12).map(strip)
  return { series: list.filter((c) => c.kind === 'series'), movies: list.filter((c) => c.kind === 'movie'), recent }
```

(c) `librarySummary`: acrescentar ao objeto devolvido
```ts
    seasons: count(`SELECT COUNT(DISTINCT t.id || ':' || i.season) AS n ${base} AND t.kind = 'series' AND i.season IS NOT NULL`),
```

(d) `src/shared/types.ts`: `Catalog` vira `{ series: TitleCard[]; movies: TitleCard[]; recent: TitleCard[] }` e `ScanSummary` ganha `seasons: number` (depois de `episodes`).

(e) `src/main/scanner/scan.ts` (função `aborted`) e `src/main/index.ts` (resumo do `.catch`): acrescentar `seasons: 0` aos objetos de resumo zerados. Outros usos aparecem no typecheck.

- [ ] **Step 5: Interface**

`Home.tsx`: no estado inicial do catálogo usar `{ series: [], movies: [], recent: [] }`, e, antes da linha de "Séries", acrescentar
```tsx
      <Row title="Adicionados recentemente" cards={catalog.recent} onOpen={onOpen} />
```
`Libraries.tsx`: na linha do resumo (`SummaryLine`), incluir as temporadas, ex.: `{plural(s.series, 'série', 'séries')} · {plural(s.seasons, 'temporada', 'temporadas')} · {plural(s.episodes, 'episódio', 'episódios')} · ...` (mantendo o que já existe para filmes, legendas e não identificados).

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa. Se algum teste antigo comparar o catálogo ou o resumo com `toEqual`, atualize-o para incluir `recent`/`seasons` (a mudança é o objetivo da task).

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: adicionados recentemente e temporadas no resumo (pendências do M1)"
```

---

### Task 12: Documentação, correção da spec e versão 0.2.0

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-brammp4-player-design.md`, `README.md`, `CLAUDE.md`, `package.json`, `package-lock.json`

**Interfaces:** nenhuma (só documentação e versão).

- [ ] **Step 1: Corrigir a spec**

Localize os trechos com `Grep` (`shutdown`, `Fontes exatas`, `Assistido: posição`) e edite com a ferramenta de edição:
1. Seção 8, "Quando salvar": substituir o item sobre o `powerMonitor` `shutdown` por:
   `- como reforço de melhor esforço: ao suspender o notebook (`powerMonitor` `suspend`), no fim de sessão do Windows (`session-end` da janela, quando a tipagem do Electron tiver o evento) e ao fechar o app (`before-quit`, que grava e encerra o mpv). O evento `shutdown` do `powerMonitor` só existe em Linux e macOS.`
2. Seção 8, "Regras", item "Assistido": acrescentar ao final: `A regra dos 2 min só vale depois da metade do vídeo (um clipe de 100 s não nasce assistido).`
3. Seção 8: acrescentar uma linha depois do bloco de argumentos do mpv: `A legenda externa escolhida é selecionada depois do `file-loaded`, procurando o arquivo na `track-list` do mpv (o id depende da ordem em que o mpv registra as legendas).`
4. Seção 16: substituir o item "Fontes exatas e versões fixadas das builds portáteis do mpv e do ffmpeg..." por: `- Resolvido no M2: mpv = build de CI oficial do `mpv-player/mpv` v0.41.0 (`x86_64-w64-mingw32`, SHA-256 fixado em `scripts/binaries.json`); uosc 5.13.0. Os textos de licença (mpv GPL e uosc) vão dentro do instalador.`

- [ ] **Step 2: Atualizar README e CLAUDE.md**

`README.md`: trocar o parágrafo "Status:" por um que diga que M1 (catálogo local) e M2 (reprodução e progresso com mpv + uosc) estão implementados, que backup (M4), metadados (M3) e acabamento (M5) vêm depois; manter a seção de instalação e o aviso do TMDB; acrescentar uma linha "O instalador já contém ffprobe, mpv e uosc (licenças em `resources/`)".

`CLAUDE.md`: acrescentar em "Convenções": `- Reprodução: `src/main/player/` (mpv por JSON IPC). `MpvClient`/`ProgressTracker`/regras são testáveis sem Electron; `npm run binaries` baixa mpv e uosc para `vendor/`. Teste contra o mpv real em `tests/player/mpv-real.test.ts` (roda quando `vendor/mpv/mpv.exe` existe).`

- [ ] **Step 3: Versão**

Run: `npm version 0.2.0 --no-git-tag-version`
Expected: `package.json` e `package-lock.json` em `0.2.0`, sem criar tag nem commit. (A tag `v0.2.0` é criada pela pessoa responsável, depois do merge.)

- [ ] **Step 4: Verificar tudo**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add docs README.md CLAUDE.md package.json package-lock.json
git commit -m "docs: spec corrigida para o Windows, README e CLAUDE.md do M2, versão 0.2.0"
```

---

## Entrega do M2

1. Branch `feat/m2-reproducao` (ou uma branch por grupo de tasks, a critério de quem executar) → PR para `main` com o checklist manual da Task 10 no corpo e a lista do que **não** foi verificado por uma pessoa (GUI, instalador, o uosc aparecendo, vídeo real com HEVC/AC3/DTS dos HDs).
2. Depois do merge, a pessoa decide a tag `v0.2.0` (publica a release).
3. Riscos conhecidos a conferir à mão antes da tag: (a) a janela do mpv abre em tela cheia e o uosc aparece; (b) `mpv.exe` não fica órfão ao fechar o app; (c) reproduzir um arquivo x265 com áudio AC3/DTS do seu HD; (d) o instalador cresceu (anotado na Task 7).
