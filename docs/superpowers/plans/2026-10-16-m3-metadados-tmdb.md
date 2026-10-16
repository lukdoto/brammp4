# M3: Metadados (TMDB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O catálogo ganha capas, fundos, sinopses e nomes de episódios vindos do TMDB (com cache em disco, funcionando offline), correção manual da identificação, e a tela "Não identificados" para arquivos que o parser não classificou.

**Architecture:** Um `MetadataService` no processo principal varre os títulos sem vínculo, busca no TMDB (cliente com `fetch` injetável), grava texto no SQLite e baixa imagens para `userData/images/`; o renderer lê imagens por um protocolo próprio `brammp-img://` restrito a essa pasta. A chave do TMDB fica no `settings` cifrada com `safeStorage`. A identidade dos itens **não muda**: a chave `local:` continua sendo a chave do banco e o progresso nunca é migrado (ver Desvio 1).

**Tech Stack:** Electron 44 (`safeStorage`, `protocol`, `net`), `node:sqlite`, React 19, Vitest. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-10-14-brammp4-player-design.md` (seções 5 "Identidade", 9 "Metadados", 11 telas 4 e 5, 12 erros, 15 M3).

## Desvios da spec (decididos neste plano; registrar na spec no Task 11)

1. **A chave do item não vira `tmdb:...`.** A spec (seção 5) manda migrar `local:` para `tmdb:` ao associar. Mas o scanner recalcula `local:<slug>:SxxExx` a partir do nome do arquivo a cada varredura; migrar a chave faria a varredura seguinte recriar os itens `local:` (duplicados, sem progresso). Decisão: `items.key` fica `local:` para sempre; `titles.tmdb_id` guarda o vínculo. O M4 (backup) monta o identificador `tmdb:tv:<id>:S01E03` na hora de exportar, a partir de `titles.tmdb_id`. Custo se errado: o M4 precisa dessa tradução; nenhum dado de usuário é perdido.
2. **Sem frame de vídeo como capa offline.** A spec (seção 9) cita um frame via ffmpeg; só embutimos o ffprobe. A capa sem TMDB é o placeholder gerado (iniciais + cor por nome) que já existe. Custo se errado: títulos não identificados ficam sem imagem real.
3. **Logo do TMDB não entra no M3.** Só o texto de atribuição obrigatório, na tela Configurações. O logo aprovado entra com a tela "Sobre" no M5 (exige baixar o arquivo oficial). Custo se errado: atribuição incompleta até o M5.
4. **Idioma fixo `pt-BR`** nas consultas; se a sinopse vier vazia, fica vazia (sem segunda consulta em inglês). Custo se errado: alguns títulos sem sinopse.
5. **Candidatos da correção manual aparecem sem pôster** (nome, ano, trecho da sinopse). Mostrar imagens remotas exigiria afrouxar a CSP. Custo se errado: escolher entre homônimos pelo ano e pela sinopse.

## Global Constraints

- Renderer: CSP `img-src 'self' data:` passa a `img-src 'self' data: brammp-img:`; nenhuma outra origem.
- A chave do TMDB nunca sai do processo principal: o renderer só recebe `hasKey: boolean`. Nunca em log, erro ou URL de mensagem. Se `safeStorage.isEncryptionAvailable()` for falso, recusar salvar (`encryption-unavailable`); jamais gravar em texto puro.
- Download de imagem somente de `https://image.tmdb.org/t/p/` com tamanhos fixos `w342` (pôster) e `w780` (fundo). Arquivo no cache = `<tamanho>-<nome>.jpg`, regex `^w(342|780)-[A-Za-z0-9_-]+\.jpg$`; gravar em arquivo temporário e renomear.
- Todo texto vindo do TMDB é renderizado como texto React (nunca `dangerouslySetInnerHTML`).
- `fetch` com `AbortSignal.timeout(15000)`; 429 respeita `Retry-After` (máx. 30 s) e tenta de novo uma vez.
- Sem internet ou sem chave: o catálogo funciona como no M2; nada de erro bloqueante (spec seção 12).
- Banco: parâmetros posicionais `?`; migração nova = novo item no fim de `MIGRATIONS` (a 3ª).
- Textos de interface em português do Brasil. Branch `feat/m3-metadados`, PR para `main`.
- Versão do pacote sobe para `0.3.0` no último task.

## Review Focus

1. **Sem chave / sem internet / TMDB fora do ar:** o app abre e navega normalmente, nada fica marcado como "verificado" por causa de falha de rede (tenta de novo depois), e nenhuma promessa rejeitada fica sem tratamento. Teste no Task 5.
2. **Varredura depois de identificar:** reescanear não duplica itens, não troca chaves, não perde progresso e não sobrescreve o nome do episódio vindo do TMDB. Testes nos Tasks 1 e 5.
3. **Corrigir a identificação de um título:** o vínculo manual nunca é sobrescrito pelo automático, e os nomes/sinopses de episódios do vínculo anterior somem (senão "Dark" mostraria episódios de outra série). Teste no Task 5.
4. **Entradas hostis:** nome de imagem com `..`, barra ou tipo errado no protocolo; payload de IPC inválido; resposta do TMDB sem `poster_path`, sem `overview`, sem data, com `results: []`. Testes nos Tasks 2, 4 e 6.
5. **Download interrompido ou 404 de imagem:** não deixa arquivo parcial no cache nem impede de gravar o texto do título; a próxima rodada tenta de novo. Teste no Task 4.

---

## Estrutura de arquivos

Criar:
- `src/main/metadata/tmdb.ts`: cliente TMDB (fetch injetável) e tipos normalizados.
- `src/main/metadata/match.ts`: `pickBest` (puro).
- `src/main/metadata/secrets.ts`: guarda/lê a chave com cifra injetável.
- `src/main/metadata/images.ts`: cache de imagens + `isSafeImageName`.
- `src/main/metadata/service.ts`: `MetadataService`.
- `src/main/db/metadata.ts`: consultas e gravações de metadados e atribuições.
- `src/main/metadata/requests.ts`: validação dos payloads de IPC (`parseSearchRequest`, `parseAssignTmdbRequest`, `parseReclassifyRequest`).
- `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/pages/Unmatched.tsx`, `src/renderer/src/components/MatchDialog.tsx`, `src/renderer/src/components/Poster.tsx`.
- Testes em `tests/metadata/` e extensões em `tests/db/`, `tests/scanner/`, `tests/renderer/`.

Modificar: `src/main/db/schema.ts`, `src/main/db/repo.ts`, `src/main/scanner/scan.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/index.html`, `src/renderer/src/{App.tsx,format.ts,styles.css}`, `src/renderer/src/pages/{Home,TitlePage}.tsx`, `src/renderer/src/components/TitleCardView.tsx`, docs e `package.json`.

---

### Task 1: Migração 3 e leitura de metadados no catálogo

**Files:**
- Modify: `src/main/db/schema.ts`, `src/main/db/repo.ts` (`getCatalog`, `getTitleDetail`), `src/shared/types.ts`
- Test: `tests/db/migrate.test.ts`, `tests/db/repo.test.ts`

**Interfaces:**
- Produces (migração 3): `titles.match_source TEXT` (`NULL` | `'auto'` | `'manual'`), `titles.tmdb_checked_at TEXT`, `items.tmdb_name TEXT`; tabela `assignments (library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, rel_path TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY (library_id, rel_path))` onde `target` é JSON de `ReclassifyTarget`.
- Produces (tipos em `shared/types.ts`):
  - `TitleCard` ganha `posterFile?: string`.
  - `TitleDetail` ganha `overview?: string; posterFile?: string; backdropFile?: string; matchSource?: 'auto' | 'manual'`.
  - `ItemView` ganha `overview?: string`; `ItemView.name` passa a ser `COALESCE(items.tmdb_name, items.name)`.
  - `ReclassifyTarget = { kind: 'movie'; title: string; year?: number } | { kind: 'episode'; series: string; season: number; episode: number }`.

- [ ] **Step 1: testes que falham**
  - `migrate.test.ts`: `'migração 3 cria match_source, tmdb_checked_at, tmdb_name e assignments'` (banco novo tem `user_version = 3` e `PRAGMA table_info` mostra as colunas); `'banco na versão 2 com dados migra para 3 sem perder títulos'`.
  - `repo.test.ts`: `'getCatalog devolve posterFile quando titles.poster_cache está preenchido'`; `'getTitleDetail devolve overview, posterFile, backdropFile e matchSource'`; `'nome do episódio prefere tmdb_name ao name do arquivo'`; `'upsertItem do scanner não apaga tmdb_name'`; `'título sem metadados continua sem campos opcionais'`.
- [ ] **Step 2:** `npx vitest run tests/db` → FAIL.
- [ ] **Step 3:** Adicionar a 3ª entrada em `MIGRATIONS` com `ALTER TABLE ... ADD COLUMN` e o `CREATE TABLE assignments`. Estender `getCatalog` (`t.poster_cache`) e `getTitleDetail` (colunas novas; `items.overview` já existe). Estender os tipos.
- [ ] **Step 4:** `npx vitest run tests/db && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(db): migração 3 e leitura de capas, sinopses e nomes do TMDB`

### Task 2: Cliente TMDB e escolha do melhor resultado

**Files:**
- Create: `src/main/metadata/tmdb.ts`, `src/main/metadata/match.ts`
- Test: `tests/metadata/tmdb.test.ts`, `tests/metadata/match.test.ts`

**Interfaces:**
- Produces em `tmdb.ts`:
  - `interface TmdbTitle { id: number; name: string; year?: number; overview?: string; posterPath?: string; backdropPath?: string }`
  - `interface TmdbEpisode { season: number; episode: number; name?: string; overview?: string }`
  - `class TmdbError extends Error { readonly code: 'invalid-key' | 'network' | 'rate-limit' | 'bad-response' }`
  - `interface TmdbClient { validate(): Promise<void>; search(kind: 'series' | 'movie', query: string, year?: number): Promise<TmdbTitle[]>; details(kind: 'series' | 'movie', id: number): Promise<TmdbTitle>; season(tvId: number, season: number): Promise<TmdbEpisode[]> }`
  - `createTmdbClient(opts: { key: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): TmdbClient`
  - `authFor(key: string): { query?: Record<string, string>; headers?: Record<string, string> }`: chave que começa com `eyJ` é token v4 (`Authorization: Bearer`); senão `api_key` na query.
- Produces em `match.ts`: `pickBest(results: TmdbTitle[], name: string, year?: number): TmdbTitle | undefined`.

- [ ] **Step 1: testes que falham** (com `fetch` falso que registra as URLs):
  - `tmdb.test.ts`: `'search de série usa /3/search/tv, language=pt-BR, include_adult=false, first_air_date_year'`; `'search de filme usa /3/search/movie e year'`; `'chave v3 vai em api_key; token eyJ vai em Authorization Bearer e não na URL'`; `'normaliza ano de first_air_date/release_date e ignora data vazia'`; `'poster_path e overview nulos viram undefined'`; `'results vazio devolve []'`; `'401 vira TmdbError invalid-key'`; `'fetch que lança vira TmdbError network'`; `'JSON inesperado vira bad-response'`; `'429 espera Retry-After (máx 30 s, via sleep injetado) e repete uma vez; segundo 429 vira rate-limit'`; `'season devolve episódios com número, nome e sinopse'`; `'validate usa /3/authentication e 401 vira invalid-key'`; `'a mensagem de TmdbError nunca contém a chave'`.
  - `match.test.ts`: `'prefere nome igual (sem acento/caixa) com o mesmo ano'`; `'sem ano usa o primeiro com nome igual'`; `'sem nome igual cai no primeiro resultado (spec seção 9)'`; `'lista vazia devolve undefined'`.
- [ ] **Step 2:** `npx vitest run tests/metadata` → FAIL.
- [ ] **Step 3:** Implementar. Base `https://api.themoviedb.org/3`. `AbortSignal.timeout(15000)`. Normalização de nome via `slugify` de `src/main/parser/keys.ts`.
- [ ] **Step 4:** testes e `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(metadata): cliente TMDB e escolha do melhor resultado`

### Task 3: Chave do TMDB guardada com cifra

**Files:**
- Create: `src/main/metadata/secrets.ts`
- Test: `tests/metadata/secrets.test.ts`

**Interfaces:**
- Consumes: tabela `settings (key, value)`.
- Produces: `interface Cipher { available(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string }`; `saveTmdbKey(db: Db, cipher: Cipher, key: string): 'ok' | 'encryption-unavailable'`; `loadTmdbKey(db: Db, cipher: Cipher): string | null`; `clearTmdbKey(db: Db): void`; `hasTmdbKey(db: Db): boolean`. Valor em `settings.key = 'tmdb_key'`, base64 do cifrado. Em `index.ts` o `Cipher` real usa `safeStorage`.

- [ ] **Step 1: testes** (cifra falsa que inverte a string): `'salva cifrado: o valor no banco não contém a chave em texto'`; `'load devolve a chave original'`; `'sem cifra disponível não grava nada e devolve encryption-unavailable'`; `'chave corrompida no banco devolve null em vez de lançar'`; `'clear remove'`; `'save apara espaços e recusa string vazia'`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** `feat(metadata): chave do TMDB cifrada com safeStorage`

### Task 4: Cache de imagens e protocolo `brammp-img://`

**Files:**
- Create: `src/main/metadata/images.ts`
- Modify: `src/main/paths.ts` (`imagesDir(): string` = `join(app.getPath('userData'), 'images')`)
- Test: `tests/metadata/images.test.ts`

**Interfaces:**
- Produces: `isSafeImageName(name: string): boolean`; `imageFileName(size: 'w342' | 'w780', tmdbPath: string): string | undefined` (`'/abc.jpg'` → `'w342-abc.jpg'`; caminho fora de `^/[A-Za-z0-9_-]+\.jpg$` → `undefined`); `interface ImageCache { ensure(size: 'w342' | 'w780', tmdbPath: string): Promise<string | undefined> }` (devolve o nome do arquivo, baixando se faltar; `undefined` se falhar); `createImageCache(opts: { dir: string; fetch?: typeof fetch }): ImageCache`; `resolveImagePath(dir: string, url: string): string | undefined` (de `brammp-img://img/<nome>` para caminho absoluto, só se o nome for seguro).

- [ ] **Step 1: testes** (pasta temporária): `'baixa de image.tmdb.org/t/p/w342/abc.jpg e grava w342-abc.jpg'`; `'segunda chamada não baixa de novo'`; `'404 devolve undefined e não deixa arquivo'`; `'download que lança no meio não deixa arquivo parcial nem .tmp'`; `'corpo vazio não vira arquivo'`; `'caminho TMDB com .., barra extra ou extensão errada é rejeitado sem chamar fetch'`; `isSafeImageName`: aceita `w342-abc_D-1.jpg`, rejeita `../x.jpg`, `w342-a/b.jpg`, `w500-a.jpg`, `w342-a.png`, string vazia, nome com `%2e`; `resolveImagePath`: rejeita `brammp-img://img/..%2f..%2fx.jpg` e outro host/esquema.
- [ ] **Step 2:** FAIL. **Step 3:** escrever em `<nome>.tmp` e `rename`; checar `Content-Type` começa com `image/`.
- [ ] **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** `feat(metadata): cache de imagens do TMDB e resolução segura de caminho`

### Task 5: Gravações no banco e `MetadataService`

**Files:**
- Create: `src/main/db/metadata.ts`, `src/main/metadata/service.ts`
- Test: `tests/db/metadata.test.ts`, `tests/metadata/service.test.ts`

**Interfaces:**
- Consumes: `TmdbClient`, `ImageCache`, `Db`, `loadTmdbKey` via função injetada.
- Produces em `db/metadata.ts`:
  - `listPendingTitles(db: Db, nowIso: string, retryAfterDays: number): { id: number; kind: 'series' | 'movie'; name: string; year?: number }[]`: `tmdb_id IS NULL AND match_source IS NULL` e (`tmdb_checked_at IS NULL` ou mais antigo que `retryAfterDays`); só títulos com ao menos um arquivo não-`missing`.
  - `applyTitleMatch(db: Db, titleId: number, m: { tmdbId: number; name: string; year?: number; overview?: string; posterFile?: string; backdropFile?: string; source: 'auto' | 'manual' }): void`: grava vínculo; **se o `tmdbId` mudou, zera `items.tmdb_name` e `items.overview` de todos os itens do título** (Review Focus 3); atualiza `titles.name` e `year`.
  - `markChecked(db: Db, titleId: number, nowIso: string): void`.
  - `listSeasonsNeedingEpisodes(db: Db, titleId: number): number[]`: temporadas com algum item de `tmdb_name IS NULL`.
  - `applyEpisodes(db: Db, titleId: number, season: number, eps: { episode: number; name?: string; overview?: string }[]): void`: só atualiza itens existentes (não cria).
  - `getTitleForAssign(db: Db, id: number): { kind: 'series' | 'movie'; tmdbId?: number; matchSource?: 'auto' | 'manual' } | undefined`.
  - `countPending(db: Db): number`.
- Produces em `service.ts`: `class MetadataService { constructor(deps: { db: Db; client: () => TmdbClient | null; images: ImageCache; now: () => Date; onChange: () => void; retryMs?: number }); sync(): Promise<void>; assign(titleId: number, tmdbId: number): Promise<'ok' | 'no-key' | TmdbError['code'] | 'not-found' | 'kind-mismatch'>; search(kind, query, year?): Promise<TmdbTitle[]>; status(): { hasKey: boolean; syncing: boolean; pending: number }; start(): void; stop(): void }`.
  - `sync()` é single-flight (chamadas concorrentes devolvem a mesma promessa), processa títulos em série, nunca lança.
  - Falha de rede/`rate-limit` encerra a rodada e **não** chama `markChecked`; `invalid-key` encerra e desliga o timer até a chave mudar; busca sem resultado chama `markChecked` (reavalia em 7 dias); `retryMs` padrão 600000 reagenda enquanto houver pendentes ou falha de rede.
  - Para séries, depois do vínculo busca `season()` de cada temporada em `listSeasonsNeedingEpisodes` (uma tentativa por temporada por execução do app).
  - Falha ao baixar imagem não impede gravar o texto (`posterFile` fica ausente e será tentado na próxima rodada se `poster_cache IS NULL` e `tmdb_id` existe: incluir esses títulos em uma segunda lista `listMissingImages`).

- [ ] **Step 1: testes de banco**: `'listPendingTitles ignora títulos vinculados, manuais e já verificados há menos de 7 dias'`; `'ignora título cujos arquivos estão todos missing'`; `'applyTitleMatch grava e atualiza name/year'`; `'applyTitleMatch com tmdbId diferente apaga tmdb_name e overview dos itens'`; `'applyTitleMatch com o mesmo tmdbId preserva os nomes dos episódios'`; `'applyEpisodes não cria itens novos'`; `'o scanner (upsertItem) depois de applyEpisodes não apaga tmdb_name nem o progresso'`; `'chave do item e progresso permanecem após vincular'`.
- [ ] **Step 2: testes do serviço** (cliente e cache falsos, banco em memória via `seedSeries`/`seedMovie`): `'vincula série, grava pôster e fundo, busca episódios e chama onChange'`; `'sem chave (client() null): não faz nada e status.hasKey false'`; `'rede caindo: não marca verificado e tenta na próxima rodada'`; `'sem resultados: marca verificado e não repete na mesma semana'`; `'invalid-key encerra a rodada sem lançar'`; `'sync concorrente roda uma vez'`; `'imagem que falha não impede gravar sinopse e é refeita depois'`; `'assign manual troca o vínculo, vira manual e o automático nunca mais mexe'`; `'assign de série com tmdbId de filme (details 404) devolve not-found'`; `'assign para título filme usa kind movie'`; `'assign sem chave devolve no-key'`; `'search rejeita query vazia'`; `'status.pending conta os pendentes'`.
- [ ] **Step 3:** FAIL. **Step 4:** implementar. **Step 5:** PASS + typecheck.
- [ ] **Step 6: Commit** `feat(metadata): serviço de sincronização com o TMDB`

### Task 6: Atribuições (Não identificados) no scanner e validação dos payloads

**Files:**
- Create: `src/main/metadata/requests.ts`
- Modify: `src/main/db/metadata.ts` (ou `repo.ts`), `src/main/scanner/scan.ts`
- Test: `tests/metadata/requests.test.ts`, `tests/scanner/scan.test.ts`

**Interfaces:**
- Produces: `listUnmatched(db: Db): { libraryId: string; libraryLabel: string; relPath: string; reason: string }[]` (só `reason = 'nome não reconhecido'`, ordenado); `setAssignment(db: Db, libraryId: string, relPath: string, target: ReclassifyTarget): void`; `listAssignments(db: Db, libraryId: string): Map<string, ReclassifyTarget>`; `reclassifyToParsed(t: ReclassifyTarget): ParsedVideo` (`movie` → `{kind:'movie', title, year}`; `episode` → `{kind:'episode', seriesName, season, episodes:[episode]}`).
- Produces em `requests.ts`: `parseSearchRequest(raw: unknown): { kind: 'series' | 'movie'; query: string; year?: number } | null` (query 1–100 chars após trim, ano 1870–2200 inteiro); `parseAssignTmdbRequest(raw): { titleId: number; tmdbId: number } | null` (inteiros positivos); `parseReclassifyRequest(raw): { libraryId: string; relPath: string; target: ReclassifyTarget } | null` (strings ≤ 500, `season` ≥ 0 ≤ 200, `episode` ≥ 1 ≤ 9999, título/série 1–200 chars após trim).
- Consumes (scan): em `scanLibrary`, `parsed = assignments.get(relPath) ? reclassifyToParsed(...) : parseVideoPath(relPath)`; arquivo atribuído deixa de entrar em `unmatchedVideos`.

- [ ] **Step 1: testes** `requests.test.ts` (válidos, e para cada campo: tipo errado, vazio, longo demais, `NaN`, fracionário, objeto extra ignorado, `null`/`undefined`/string no lugar do objeto → `null`). `scan.test.ts`: `'arquivo sem nome reconhecido aparece em unmatched'` (já existe; manter); `'após setAssignment como episódio, a varredura cria a série, o item local:<slug>:S02E05 e remove o arquivo de unmatched'`; `'atribuição como filme com ano gera local:<slug>-<ano>'`; `'reescanear com a atribuição não duplica itens'`; `'atribuição de arquivo que sumiu não quebra a varredura'`; `'atribuir a uma série existente reutiliza o título (mesmo localKey)'`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** `feat(scanner): reclassificação manual de arquivos não identificados`

### Task 7: IPC, preload, protocolo e ligação no processo principal

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/index.html`
- Test: reaproveita `requests.test.ts`; a ligação é verificada por typecheck, build e o passo manual do Task 11

**Interfaces:**
- Produces em `types.ts`:
  - `TmdbStatus { hasKey: boolean; syncing: boolean; pending: number }`
  - `TmdbCandidate { tmdbId: number; name: string; year?: number; overview?: string }`
  - `SetKeyResult = { ok: true } | { ok: false; error: 'invalid' | 'invalid-key' | 'network' | 'encryption-unavailable' }`
  - `AssignResult = { ok: true } | { ok: false; error: 'invalid' | 'no-key' | 'network' | 'rate-limit' | 'invalid-key' | 'bad-response' | 'not-found' | 'kind-mismatch' }`
  - `UnmatchedFile { libraryId: string; libraryLabel: string; relPath: string }`
  - `ReclassifyResult = { ok: true } | { ok: false; error: 'invalid' | 'offline' }`
  - `BrammApi` ganha: `getTmdbStatus(): Promise<TmdbStatus>`, `setTmdbKey(key: string): Promise<SetKeyResult>`, `clearTmdbKey(): Promise<void>`, `searchTmdb(req: { kind: 'series' | 'movie'; query: string; year?: number }): Promise<TmdbCandidate[]>`, `assignTmdb(req: { titleId: number; tmdbId: number }): Promise<AssignResult>`, `listUnmatched(): Promise<UnmatchedFile[]>`, `reclassify(req: { libraryId: string; relPath: string; target: ReclassifyTarget }): Promise<ReclassifyResult>`, `onMetadataChanged(cb: () => void): () => void`.
- Canais: `tmdb:status`, `tmdb:set-key`, `tmdb:clear-key`, `tmdb:search`, `tmdb:assign`, `unmatched:list`, `unmatched:reclassify`; evento `metadata:changed`.

- [ ] **Step 1:** Em `index.ts`: `protocol.registerSchemeAsPrivileged([{ scheme: 'brammp-img', privileges: { secure: true, supportFetchAPI: true } }])` **antes** de `app.whenReady`; dentro do ready, `protocol.handle('brammp-img', (req) => { const p = resolveImagePath(imagesDir(), req.url); return p ? net.fetch(pathToFileURL(p).toString()) : new Response(null, { status: 404 }) })`. Criar `MetadataService` com `client` que lê `loadTmdbKey(db, safeStorageCipher)` a cada chamada, `onChange` debounced a 500 ms enviando `metadata:changed`; chamar `metadata.start()` no ready, `metadata.sync()` no fim de cada varredura (`scan:done`) e depois de salvar a chave; `metadata.stop()` no `before-quit`.
- [ ] **Step 2:** Em `ipc.ts` adicionar os handlers; todo payload passa pelos `parse*` do Task 6 e resposta inválida é `{ ok: false, error: 'invalid' }`. `tmdb:set-key`: salvar só depois de `createTmdbClient({ key }).validate()` passar; erro mapeado sem expor a chave. `unmatched:reclassify`: exige a biblioteca `online`; grava `setAssignment` e chama `ctx.scan(libraryId)`. `IpcContext` ganha `metadata` e `cipher`.
- [ ] **Step 3:** `preload/index.ts` expõe os métodos novos; `index.html` com `img-src 'self' data: brammp-img:`.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(metadata): IPC, protocolo de imagens e ligação no processo principal`

### Task 8: Capas, fundo, sinopse e nomes de episódios no catálogo

**Files:**
- Create: `src/renderer/src/components/Poster.tsx`
- Modify: `src/renderer/src/components/TitleCardView.tsx`, `src/renderer/src/pages/TitlePage.tsx`, `src/renderer/src/format.ts`, `src/renderer/src/App.tsx` (assinar `onMetadataChanged` → `setRefresh`), `src/renderer/src/styles.css`
- Test: `tests/renderer/format.test.ts`

**Interfaces:**
- Produces: `imageUrl(file: string | undefined): string | undefined` em `format.ts` (`'w342-abc.jpg'` → `'brammp-img://img/w342-abc.jpg'`; `undefined` ou nome fora do padrão → `undefined`); `<Poster name posterFile />` (imagem quando houver, senão o placeholder atual de `posterStyle`/`initials`; `onError` troca para o placeholder).

- [ ] **Step 1: testes** `format.test.ts`: `'imageUrl monta a URL do protocolo'`; `'imageUrl devolve undefined para vazio, ../ e tipo errado'`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. `TitleCardView` usa `Poster`. `TitlePage`: fundo (`backdropFile`) atrás do cabeçalho com gradiente para legibilidade, sinopse do título, `Episódio N · {nome}` já usa `item.name`, sinopse do episódio abaixo (texto simples, 2 linhas com reticências), selo "Identificado manualmente" quando `matchSource === 'manual'`.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(ui): capas, fundo, sinopses e nomes de episódios`

### Task 9: Configurações (chave do TMDB, atribuição) e correção da identificação

**Files:**
- Create: `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/components/MatchDialog.tsx`
- Modify: `src/renderer/src/App.tsx` (nova view `settings`, botão "Configurações" no cabeçalho; a view `libraries` continua como está e é linkada dentro de Configurações também), `src/renderer/src/pages/TitlePage.tsx` (botão "Corrigir identificação"), `styles.css`
- Test: `tests/renderer/format.test.ts` (o projeto testa só lógica pura no renderer; os componentes não têm teste).

**Interfaces:**
- Produces: `tmdbKeyError(e: 'invalid' | 'invalid-key' | 'network' | 'encryption-unavailable'): string` e `assignError(e: Exclude<AssignResult, { ok: true }>['error']): string` em `format.ts`, com textos em português.

- [ ] **Step 1: testes** `format.test.ts`: `'tmdbKeyError cobre todos os códigos com texto não vazio'`; `'assignError cobre todos os códigos com texto não vazio'`; `'nenhuma mensagem contém a palavra "undefined"'`.
- [ ] **Step 2:** FAIL. **Step 3:** `Settings`: campo de senha para a chave (colar, "Salvar e testar"), estado "Chave configurada" com botão "Remover", explicação de onde obter a chave gratuita (themoviedb.org → Configurações → API), contador "N títulos aguardando identificação", e o texto de atribuição exato: "Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB." `MatchDialog`: campo de busca pré-preenchido com o nome do título, lista de candidatos (nome, ano, trecho da sinopse), escolher → `assignTmdb`, mostrar erro traduzido, fechar e recarregar.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(ui): configurações do TMDB e correção manual da identificação`

### Task 10: Tela "Não identificados"

**Files:**
- Create: `src/renderer/src/pages/Unmatched.tsx`
- Modify: `src/renderer/src/App.tsx` (view `unmatched`, botão no cabeçalho com a contagem), `styles.css`
- Test: `tests/renderer/format.test.ts` (`reclassifyError`, `parseEpisodeInput`)

**Interfaces:**
- Produces em `format.ts`: `reclassifyError(e: 'invalid' | 'offline'): string`; `parseEpisodeInput(season: string, episode: string): { season: number; episode: number } | null` (inteiros; temporada 0–200, episódio 1–9999).

- [ ] **Step 1: testes**: `'parseEpisodeInput aceita "1" "5" e rejeita vazio, negativo, decimal, texto'`; `'reclassifyError tem texto para os dois códigos'`.
- [ ] **Step 2:** FAIL. **Step 3:** Página lista arquivos (biblioteca, caminho). Por arquivo: escolher "Filme" (título + ano opcional) ou "Episódio" (série com `datalist` das séries já existentes via `getCatalog().series`, temporada, episódio) → `reclassify`; erro `offline` mostra "Conecte {biblioteca} para reclassificar". Lista vazia: "Nenhum arquivo para identificar."
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(ui): tela Não identificados`

### Task 11: Documentação, versão e verificação final

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-brammp4-player-design.md` (seção 5: chave nunca migra, M4 traduz; seção 9: desvios 2 a 5; seção 15 M3 concluído), `docs/manual-checks.md` (passos do M3), `README.md` (status e chave do TMDB), `CLAUDE.md` (uma linha: `src/main/metadata/`, chave só no main), `package.json` + `package-lock.json` (`0.3.0`)

- [ ] **Step 1:** Passos manuais do M3 em `docs/manual-checks.md`, cada um com "Passa se": colar chave inválida (mensagem clara, nada salvo); chave válida (capas e sinopses surgem sozinhas); desligar a internet e reabrir (capas continuam, sem erro); título errado corrigido pelo diálogo (nomes de episódios trocam); rescan não muda progresso; arquivo sem nome reconhecido reclassificado; remover a chave.
- [ ] **Step 2:** Atualizar spec, README, CLAUDE.md, versão.
- [ ] **Step 3:** `npm run typecheck && npm test && npm run build && npm run dist` → tudo passa; sem processos `electron`/`mpv` sobrando.
- [ ] **Step 4: Commit** `docs: M3 (spec, checklist manual, README) e versão 0.3.0`

---

## Autorrevisão

- **Cobertura da spec:** seção 9 → Tasks 2 a 5, 7, 8; chave no `safeStorage` → 3; "permite corrigir manualmente" → 5, 9; cache em disco e leitura só do cache → 4, 8; sem internet → 5 (Review Focus 1); atribuição → 9; tela Não identificados (seção 11.5) → 6, 10; Configurações com chave TMDB (11.4) → 9. Fora do M3 por decisão: frame de vídeo (Desvio 2), logo (Desvio 3).
- **Tipos:** `TmdbTitle`, `ReclassifyTarget`, `TmdbClient`, `ImageCache`, `Cipher` definidos uma vez e usados com os mesmos nomes nos tasks seguintes.
- **Proporção:** tarefas listam assinaturas, testes e valores fixos; corpos ficam para o implementador.
