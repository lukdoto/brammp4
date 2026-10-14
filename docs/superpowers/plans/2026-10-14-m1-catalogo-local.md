# M1: Catálogo local instalável. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um app Electron instalável por GitHub Release que cadastra a pasta do catálogo no disco removível, reconhece séries, filmes e legendas, acompanha a conexão do disco e mostra o catálogo (Início e Título, sem capas).

**Architecture:** Processo principal (Node) com módulos puros testáveis (`parser`, `keys`, `subtitle`, `parseFfprobe`, `resolveLibrary`) e módulos com efeitos (`db`, `walk`, `scan`, `monitor`, `ipc`). A janela React conversa só por uma API exposta no `preload`. SQLite embutido no Node (`node:sqlite`) evita módulo nativo e recompilação. O ffprobe é baixado com hash conferido e embutido no instalador NSIS gerado pelo GitHub Actions.

**Tech Stack:** Electron 44, electron-vite 5, React 19, TypeScript, Vitest, `node:sqlite`, ffprobe 9.0.2 (build GyanD), electron-builder (NSIS), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-14-brammp4-player-design.md`

## Global Constraints

- Plataforma: Windows x64. Node local e do CI: 24.
- Instalação sem pré-requisitos: tudo que o app usa em tempo de execução vai dentro do instalador (spec seção 14).
- Binários não entram no git; `scripts/fetch-binaries.mjs` baixa versões fixadas e confere SHA-256.
- Instalador: `brammp4-Setup-${version}.exe`, NSIS, por usuário, sem pedir administrador; dados em `%APPDATA%\brammp4`.
- Progresso e identidade pertencem ao item (`local:<slug>:S01E03`, `local:<slug>-<ano>`), nunca ao caminho ou à letra do disco (spec seção 4).
- Caminhos de arquivos guardados relativos à pasta da biblioteca, com `/` como separador.
- Marcador da biblioteca: `.brammp4.json` dentro da pasta escolhida, com `{ id, label, createdAt }`.
- Verificação de conexão a cada 3 s (spec seção 7).
- Extensões de vídeo: `.mkv .mp4 .avi .m4v .mov .wmv .ts .webm`. Legendas: `.srt .ass .ssa .vtt .idx`.
- Textos da interface em português do Brasil.
- Commits com o e-mail noreply já configurado no repositório; mensagens terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Referência de experiência: Stremio (layout do Início em fileiras, página de título com temporadas e episódios). Só como referência visual e de arquitetura: **não copiar código** (`stremio-web` é GPL-2.0, `stremio-shell` GPL-3.0, `stremio-shell-ng` sem licença declarada).
- `ffmpeg.exe`, mpv e uosc não entram no M1 (são usados a partir do M2/M3); o manifesto de binários já suporta adicioná-los.

## Review Focus

1. **Nomes de release com ruído e anos no nome** (`Doctor.Who.2005.S01E01`, `Blade.Runner.2049.2017.1080p.BluRay.x264`, `1917.2019`): o nome limpo e o ano corretos. Testes na Task 2.
2. **Disco removido no meio da varredura**: nada pode ser marcado como "sumido" nem apagado; o catálogo continua igual e a biblioteca fica offline. Testes na Task 7.
3. **Arquivos de amostra e extras** (`*.sample.mkv`, `Extras/`, `Featurettes/`): ignorados, sem poluir o catálogo nem a lista de não identificados. Testes nas Tasks 2 e 7.
4. **Vídeo corrompido ou ilegível pelo ffprobe**: a varredura continua; o vídeo aparece no catálogo com faixas desconhecidas. Testes nas Tasks 4 e 7.
5. **Acentos e caracteres não latinos** (`Séries/La Casa de Papel`, `進撃の巨人`): reconhecidos, chave estável e não vazia. Testes nas Tasks 2 e 7.

---

## Estrutura de arquivos

```
package.json, package-lock.json, tsconfig.json, electron.vite.config.ts, vitest.config.ts
electron-builder.yml
CLAUDE.md
scripts/binaries.json            manifesto de binários (URL, SHA-256, arquivos)
scripts/fetch-binaries.mjs       baixa e confere binários para vendor/bin
scripts/install.ps1              instalação em um comando no notebook
.github/workflows/ci.yml         typecheck + testes em PR
.github/workflows/release.yml    gera instalador e publica release em tags v*
src/shared/types.ts              tipos compartilhados main/preload/renderer
src/main/index.ts                bootstrap: banco, monitor, IPC, janela
src/main/paths.ts                caminhos de dados e binários (dev vs instalado)
src/main/ipc.ts                  handlers ipcMain
src/main/parser/video.ts         caminho de vídeo para ParsedVideo; isIgnored
src/main/parser/keys.ts          slugify, chaves de título e item
src/main/parser/subtitle.ts      caminho de legenda para ParsedSub; matchSubtitles
src/main/db/schema.ts            migrações SQL
src/main/db/database.ts          openDatabase, migrate, tx
src/main/db/repo.ts              consultas e gravações
src/main/libraries/marker.ts     ler/gravar .brammp4.json
src/main/libraries/resolve.ts    resolveLibrary (endereço guardado e troca de letra)
src/main/libraries/monitor.ts    LibraryMonitor (tick a cada 3 s)
src/main/scanner/probe.ts        parseFfprobe, probeFile
src/main/scanner/walk.ts         walkLibrary
src/main/scanner/scan.ts         scanLibrary (incremental)
src/preload/index.ts             contextBridge.exposeInMainWorld('api', ...)
src/renderer/index.html
src/renderer/src/main.tsx, App.tsx, styles.css, format.ts, env.d.ts
src/renderer/src/pages/Home.tsx, TitlePage.tsx, Libraries.tsx
src/renderer/src/components/TitleCardView.tsx
tests/**                         Vitest (Node), fixtures/tiny.mkv
```

---

### Task 1: Estrutura do projeto e verificação do `node:sqlite` no Electron

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`, `CLAUDE.md`
- Create: `src/main/index.ts` (provisório), `src/preload/index.ts` (provisório), `src/renderer/index.html`, `src/renderer/src/main.tsx` (provisório)
- Test: `tests/sqlite-smoke.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: scripts `npm run dev | build | typecheck | test | binaries | dist`; saída do build em `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "brammp4",
  "version": "0.1.0",
  "description": "Reprodutor estilo streaming para filmes e séries em HDs externos",
  "main": "./out/main/index.js",
  "author": "lukdoto",
  "license": "UNLICENSED",
  "private": true,
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "binaries": "node scripts/fetch-binaries.mjs",
    "dist": "npm run build && electron-builder --win --publish never"
  }
}
```

- [ ] **Step 2: Instalar dependências (todas de desenvolvimento; o renderer é empacotado pelo Vite e o main não tem dependências externas)**

Run:
```bash
npm i -D electron@44 electron-vite@5 electron-builder vite @vitejs/plugin-react typescript vitest @types/node@24 react react-dom @types/react @types/react-dom
```
Expected: `package-lock.json` criado, sem erros.

- [ ] **Step 3: Criar `tsconfig.json`, `electron.vite.config.ts` e `vitest.config.ts`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "electron.vite.config.ts", "vitest.config.ts"]
}
```

`electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: { plugins: [react()] }
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 20000 }
})
```

- [ ] **Step 4: Escrever o teste de fumaça do SQLite**

`tests/sqlite-smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

describe('node:sqlite', () => {
  it('abre banco em memória e executa SQL', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'ok\')')
    expect(db.prepare('SELECT v FROM t').get()).toEqual({ v: 'ok' })
  })
})
```

- [ ] **Step 5: Rodar o teste**

Run: `npm test`
Expected: PASS (1 teste). Se falhar com "Failed to load url node:sqlite", adicionar `server: { deps: { external: [/^node:/] } }` dentro de `test` em `vitest.config.ts` e rodar de novo.

- [ ] **Step 6: Criar o app mínimo que prova o `node:sqlite` dentro do Electron**

`src/main/index.ts` (provisório, substituído na Task 8):
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

app.whenReady().then(() => {
  const row = new DatabaseSync(':memory:').prepare('SELECT sqlite_version() AS v').get()
  console.log('[sqlite-check]', process.versions.node, row)
  const win = new BrowserWindow({ width: 1000, height: 700, webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true } })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts` (provisório):
```ts
export {}
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />
    <title>brammp4</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx` (provisório):
```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<h1>brammp4</h1>)
```

- [ ] **Step 7: Verificar no Electron (dev e build)**

Run: `npm run dev` e observar o terminal.
Expected: linha `[sqlite-check] 24.x.x { v: '3.x.x' }` e janela com "brammp4". Fechar a janela.

Run: `npm run build`
Expected: `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html` gerados.

Se o `[sqlite-check]` falhar com módulo inexistente: parar e trocar para `better-sqlite3` (`npm i better-sqlite3` como dependência de produção, `npm i -D @types/better-sqlite3`, adicionar `"postinstall": "electron-builder install-app-deps"`); a API `prepare/run/get/all/exec` usada nas próximas tasks é a mesma. Registrar a troca no `CLAUDE.md`.

- [ ] **Step 8: Criar `CLAUDE.md` do projeto**

```markdown
# brammp4

Reprodutor estilo streaming (Electron + TS + React) para filmes/séries em discos removíveis. Spec: `docs/superpowers/specs/`. Planos: `docs/superpowers/plans/`.

## Comandos
- `npm run dev`: app em desenvolvimento
- `npm test`: Vitest (Node, sem Electron)
- `npm run typecheck`: TypeScript
- `npm run binaries`: baixa ffprobe etc. para `vendor/bin` (Windows)
- `npm run dist`: instalador em `dist/`

## Convenções
- Módulos de `src/main/parser`, `keys`, `parseFfprobe`, `resolveLibrary` são puros: sem Electron, testados em `tests/`.
- Banco: `node:sqlite` (`DatabaseSync`), parâmetros posicionais `?`.
- Caminhos relativos à biblioteca usam `/`. Progresso pertence ao item, nunca ao caminho.
- Uma branch por tarefa, PR para `main`. Release: tag `vX.Y.Z` igual a `version` do package.json.
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json electron.vite.config.ts vitest.config.ts CLAUDE.md src tests
git commit -m "chore: estrutura Electron + Vite + Vitest e verificação do node:sqlite"
```

---

### Task 2: Reconhecimento de vídeos (parser e chaves)

**Files:**
- Create: `src/shared/types.ts`, `src/main/parser/video.ts`, `src/main/parser/keys.ts`
- Test: `tests/parser/video.test.ts`, `tests/parser/keys.test.ts`

**Interfaces:**
- Produces:
  - `type ParsedVideo = { kind: 'episode'; seriesName: string; year?: number; season: number; episodes: number[] } | { kind: 'movie'; title: string; year?: number }`
  - `parseVideoPath(relPath: string): ParsedVideo | null`
  - `isIgnored(relPath: string): boolean`
  - `extOf(path: string): string`, `splitPath(relPath: string): string[]`, `stripExt(name: string): string`
  - `VIDEO_EXTS: Set<string>`, `SXE: RegExp`
  - `slugify(s: string): string`, `episodeCode(season: number, episode: number): string`
  - `titleOf(p: ParsedVideo): { kind: 'series' | 'movie'; localKey: string; name: string; year?: number }`
  - `itemsOf(p: ParsedVideo): { key: string; season: number | null; episode: number | null }[]`
  - `episodeCodesOf(p: ParsedVideo): string[]`

- [ ] **Step 1: Criar `src/shared/types.ts` (tipos usados por todas as tasks)**

```ts
export type ParsedVideo =
  | { kind: 'episode'; seriesName: string; year?: number; season: number; episodes: number[] }
  | { kind: 'movie'; title: string; year?: number }

export interface ProbeTrack {
  type: 'audio' | 'sub'
  streamIndex: number
  /** posição 1-based dentro do tipo; é o número que o mpv usa em --aid/--sid */
  typeIndex: number
  codec: string
  lang?: string
  title?: string
  isDefault: boolean
  isForced: boolean
}

export interface ProbeResult {
  durationS?: number
  width?: number
  height?: number
  videoCodec?: string
  tracks: ProbeTrack[]
}

export type LibraryStatus = 'online' | 'offline'

export interface LibraryView {
  id: string
  label: string
  rootPath: string
  status: LibraryStatus
  lastScanAt?: string
}

export interface ScanProgress { libraryId: string; done: number; total: number; current?: string }

export interface ScanSummary {
  libraryId: string
  aborted: boolean
  videos: number
  probed: number
  series: number
  movies: number
  episodes: number
  subtitles: number
  unmatched: number
}

export interface TitleCard {
  id: number
  kind: 'series' | 'movie'
  name: string
  year?: number
  available: boolean
  offlineLabels: string[]
}

export interface Catalog { series: TitleCard[]; movies: TitleCard[] }

export interface FileView {
  id: number
  relPath: string
  libraryLabel: string
  available: boolean
  height?: number
  videoCodec?: string
  audioCount: number
  subCount: number
}

export interface ItemView { key: string; season: number | null; episode: number | null; files: FileView[] }

export interface TitleDetail {
  id: number
  kind: 'series' | 'movie'
  name: string
  year?: number
  items: ItemView[]
}

export interface BrammApi {
  listLibraries(): Promise<LibraryView[]>
  addLibrary(label: string): Promise<LibraryView | null>
  rescanLibrary(id: string): Promise<ScanSummary>
  getCatalog(): Promise<Catalog>
  getTitle(id: number): Promise<TitleDetail | null>
  onLibraryStatus(cb: (lib: LibraryView) => void): () => void
  onScanProgress(cb: (p: ScanProgress) => void): () => void
  onScanDone(cb: (s: ScanSummary) => void): () => void
}
```

- [ ] **Step 2: Escrever os testes do parser**

`tests/parser/video.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseVideoPath, isIgnored } from '../../src/main/parser/video'

describe('parseVideoPath', () => {
  const cases: [string, unknown][] = [
    ['Dark/Season 1/Dark.S01E03.1080p.WEB.x265-GROUP.mkv', { kind: 'episode', seriesName: 'Dark', season: 1, episodes: [3] }],
    ['Series/Dark.S01E03.mkv', { kind: 'episode', seriesName: 'Dark', season: 1, episodes: [3] }],
    ['Doctor.Who.2005.S01E01.mkv', { kind: 'episode', seriesName: 'Doctor Who', year: 2005, season: 1, episodes: [1] }],
    ['Friends/Temporada 02/Friends 2x05 - Nome.avi', { kind: 'episode', seriesName: 'Friends', season: 2, episodes: [5] }],
    ['The Office/Season 03/03 - The Coup.mkv', { kind: 'episode', seriesName: 'The Office', season: 3, episodes: [3] }],
    ['Breaking Bad/S05/E14.mkv', { kind: 'episode', seriesName: 'Breaking Bad', season: 5, episodes: [14] }],
    ['Dark/Season 1/Dark.S01E01E02.mkv', { kind: 'episode', seriesName: 'Dark', season: 1, episodes: [1, 2] }],
    ['show_s1e3.mkv', { kind: 'episode', seriesName: 'show', season: 1, episodes: [3] }],
    ['Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E01.mkv', { kind: 'episode', seriesName: 'La Casa de Papel', season: 1, episodes: [1] }],
    ['進撃の巨人/Season 1/進撃の巨人 S01E01.mkv', { kind: 'episode', seriesName: '進撃の巨人', season: 1, episodes: [1] }],
    ['Filmes/Interestelar (2014) [1080p].mkv', { kind: 'movie', title: 'Interestelar', year: 2014 }],
    ['Blade.Runner.2049.2017.1080p.BluRay.x264.mkv', { kind: 'movie', title: 'Blade Runner 2049', year: 2017 }],
    ['1917.2019.1080p.mkv', { kind: 'movie', title: '1917', year: 2019 }],
    ['Filmes/Cidade de Deus (2002)/Cidade.de.Deus.2002.DUAL.mkv', { kind: 'movie', title: 'Cidade de Deus', year: 2002 }],
    ['Filmes/Blade Runner 2049.mkv', { kind: 'movie', title: 'Blade Runner 2049' }]
  ]
  for (const [path, expected] of cases) {
    it(path, () => expect(parseVideoPath(path)).toEqual(expected))
  }

  it('arquivo em pasta de temporada sem número de episódio não é reconhecido', () => {
    expect(parseVideoPath('Dark/Season 1/notes episode.mkv')).toBeNull()
  })
})

describe('isIgnored', () => {
  it.each([
    ['Dark/Extras/Making of.mkv', true],
    ['Dark/Featurettes/x.mkv', true],
    ['Filme/Filme.sample.mkv', true],
    ['Samples/x.mkv', true],
    ['$RECYCLE.BIN/x.mkv', true],
    ['System Volume Information/x.mkv', true],
    ['.brammp4.json', true],
    ['Dark/Season 1/Dark.S01E01.mkv', false],
    ['Sampler (2020).mkv', false]
  ])('%s -> %s', (path, expected) => expect(isIgnored(path)).toBe(expected))
})
```

`tests/parser/keys.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { slugify, titleOf, itemsOf, episodeCode, episodeCodesOf } from '../../src/main/parser/keys'

describe('keys', () => {
  it('slugify remove acentos e mantém letras não latinas', () => {
    expect(slugify('La Casa de Papel')).toBe('la-casa-de-papel')
    expect(slugify('Pokémon: A Série!')).toBe('pokemon-a-serie')
    expect(slugify('進撃の巨人')).toBe('進撃の巨人')
  })
  it('episodeCode com zero à esquerda', () => expect(episodeCode(1, 3)).toBe('S01E03'))
  it('chaves de episódio duplo', () => {
    const p = { kind: 'episode' as const, seriesName: 'Dark', season: 1, episodes: [1, 2] }
    expect(titleOf(p)).toEqual({ kind: 'series', localKey: 'series:dark', name: 'Dark', year: undefined })
    expect(itemsOf(p)).toEqual([
      { key: 'local:dark:S01E01', season: 1, episode: 1 },
      { key: 'local:dark:S01E02', season: 1, episode: 2 }
    ])
    expect(episodeCodesOf(p)).toEqual(['S01E01', 'S01E02'])
  })
  it('chave de filme inclui ano quando existe', () => {
    expect(itemsOf({ kind: 'movie', title: 'Interestelar', year: 2014 })).toEqual([{ key: 'local:interestelar-2014', season: null, episode: null }])
    expect(titleOf({ kind: 'movie', title: 'Interestelar' }).localKey).toBe('movie:interestelar')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/parser`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 4: Implementar `src/main/parser/video.ts`**

```ts
import type { ParsedVideo } from '../../shared/types'

export const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.webm'])

const IGNORED_DIR = /^(extras?|featurettes?|samples?|behind the scenes|bonus|trailers?)$/i
const SYSTEM_DIR = /^(\$RECYCLE\.BIN|System Volume Information)$/i
const SAMPLE_FILE = /(^|[ ._-])sample([ ._-]|$)/i
const SEASON_DIR = /^(?:season|temporada|s)[ ._-]*0*(\d{1,2})$/i
export const SXE = /(?<![a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})((?:[ ._-]?e\d{1,3})*)/i
const NXN = /(?<![a-z0-9])(\d{1,2})x(\d{2,3})(?![a-z0-9])/i
const LEADING_EP = /^(?:e|ep|episode|epis[oó]dio|cap[ií]tulo)?[ ._-]*0*(\d{1,3})(?![0-9])/i
const QUALITY =
  /(?<![a-z0-9])(2160p|1080p|720p|576p|480p|4k|uhd|x ?26[45]|h ?26[45]|hevc|avc|web ?dl|webrip|blu ?ray|brrip|bdrip|hdtv|dvdrip|hdrip|remux|dual|dublado|legendado|nacional|proper|repack|10bit|hdr)(?![a-z0-9])/i
const YEAR = /(?:^|[ ([-])((?:19|20)\d{2})(?=$|[ )\]-])/g

export function extOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i).toLowerCase()
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? name : name.slice(0, i)
}

export function splitPath(relPath: string): string[] {
  return relPath.split(/[\\/]/).filter(Boolean)
}

export function isIgnored(relPath: string): boolean {
  const parts = splitPath(relPath)
  if (parts.some((p) => p.startsWith('.') || SYSTEM_DIR.test(p))) return true
  if (parts.slice(0, -1).some((d) => IGNORED_DIR.test(d))) return true
  const last = parts[parts.length - 1] ?? ''
  if (IGNORED_DIR.test(last) && extOf(last) === '') return true
  return SAMPLE_FILE.test(stripExt(last))
}

export function cleanName(raw: string): { name: string; year?: number } {
  let s = raw.replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  const q = s.search(QUALITY)
  if (q > 0) s = s.slice(0, q)
  const maxYear = new Date().getFullYear() + 1
  let year: number | undefined
  let cut = -1
  for (const m of s.matchAll(YEAR)) {
    const idx = (m.index ?? 0) + m[0].indexOf(m[1]!)
    const y = Number(m[1])
    if (idx > 0 && y <= maxYear) {
      year = y
      cut = idx
    }
  }
  if (cut > 0) s = s.slice(0, cut)
  s = s.replace(/[\s([{-]+$/, '').replace(/^[\s-]+/, '').trim()
  return year === undefined ? { name: s } : { name: s, year }
}

function nearestSeriesDir(dirs: string[]): string | undefined {
  for (let i = dirs.length - 1; i >= 0; i--) if (!SEASON_DIR.test(dirs[i]!)) return dirs[i]
  return undefined
}

function episode(name: { name: string; year?: number }, season: number, episodes: number[]): ParsedVideo | null {
  if (!name.name) return null
  const p: ParsedVideo = { kind: 'episode', seriesName: name.name, season, episodes }
  if (name.year !== undefined) p.year = name.year
  return p
}

export function parseVideoPath(relPath: string): ParsedVideo | null {
  const parts = splitPath(relPath)
  const file = stripExt(parts[parts.length - 1] ?? '')
  const dirs = parts.slice(0, -1)
  const inSeasonDir = dirs.length > 0 && SEASON_DIR.test(dirs[dirs.length - 1]!)

  // Regra de nome da série: dentro de pasta de temporada, usa a pasta acima dela;
  // fora, usa o texto antes do código do episódio ou, se vazio, a pasta mais próxima.
  const seriesName = (prefix: string) => {
    if (inSeasonDir) {
      const dir = nearestSeriesDir(dirs)
      if (dir) return cleanName(dir)
    }
    const fromPrefix = cleanName(prefix)
    if (fromPrefix.name) return fromPrefix
    const dir = nearestSeriesDir(dirs)
    return dir ? cleanName(dir) : { name: '' }
  }

  const sxe = file.match(SXE)
  if (sxe) {
    const eps = [Number(sxe[2]), ...[...(sxe[3] ?? '').matchAll(/e(\d{1,3})/gi)].map((m) => Number(m[1]))]
    return episode(seriesName(file.slice(0, sxe.index)), Number(sxe[1]), eps)
  }

  const nxn = file.match(NXN)
  if (nxn) return episode(seriesName(file.slice(0, nxn.index)), Number(nxn[1]), [Number(nxn[2])])

  if (inSeasonDir) {
    const season = Number(dirs[dirs.length - 1]!.match(SEASON_DIR)![1])
    const ep = file.match(LEADING_EP)
    if (!ep) return null
    return episode(seriesName(''), season, [Number(ep[1])])
  }

  let named = cleanName(file)
  if (!named.name) named = cleanName(dirs[dirs.length - 1] ?? '')
  if (!named.name) return null
  const year = named.year ?? (dirs.length ? cleanName(dirs[dirs.length - 1]!).year : undefined)
  return year === undefined ? { kind: 'movie', title: named.name } : { kind: 'movie', title: named.name, year }
}
```

- [ ] **Step 5: Implementar `src/main/parser/keys.ts`**

```ts
import type { ParsedVideo } from '../../shared/types'

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

const pad = (n: number) => String(n).padStart(2, '0')

export function episodeCode(season: number, episode: number): string {
  return `S${pad(season)}E${pad(episode)}`
}

export function titleOf(p: ParsedVideo): { kind: 'series' | 'movie'; localKey: string; name: string; year?: number } {
  if (p.kind === 'episode') return { kind: 'series', localKey: `series:${slugify(p.seriesName)}`, name: p.seriesName, year: p.year }
  const slug = slugify(p.title)
  return { kind: 'movie', localKey: `movie:${p.year ? `${slug}-${p.year}` : slug}`, name: p.title, year: p.year }
}

export function itemsOf(p: ParsedVideo): { key: string; season: number | null; episode: number | null }[] {
  if (p.kind === 'episode') {
    const slug = slugify(p.seriesName)
    return p.episodes.map((e) => ({ key: `local:${slug}:${episodeCode(p.season, e)}`, season: p.season, episode: e }))
  }
  const slug = slugify(p.title)
  return [{ key: `local:${p.year ? `${slug}-${p.year}` : slug}`, season: null, episode: null }]
}

export function episodeCodesOf(p: ParsedVideo): string[] {
  return p.kind === 'episode' ? p.episodes.map((e) => episodeCode(p.season, e)) : []
}
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/parser`
Expected: PASS. Se algum caso de nome falhar, ajustar a regex em `video.ts` (não o teste), rodando de novo até passar.

- [ ] **Step 7: Commit**

```bash
git add src/shared src/main/parser tests/parser
git commit -m "feat(parser): reconhece episódios e filmes pelo caminho e gera chaves estáveis"
```

---

### Task 3: Legendas externas

**Files:**
- Create: `src/main/parser/subtitle.ts`
- Test: `tests/parser/subtitle.test.ts`

**Interfaces:**
- Consumes: `splitPath`, `stripExt`, `SXE` (Task 2), `episodeCode` (Task 2).
- Produces:
  - `SUB_EXTS: Set<string>`
  - `interface ParsedSub { relPath: string; dir: string; base: string; lang?: string; forced: boolean; sdh: boolean; episodeCode?: string }`
  - `parseSubtitlePath(relPath: string): ParsedSub`
  - `interface VideoRef { relPath: string; episodeCodes: string[] }`
  - `matchSubtitles(videos: VideoRef[], subs: ParsedSub[]): { matches: Map<string, ParsedSub[]>; unmatched: ParsedSub[] }`
  - `normalizeLang(code?: string): string | undefined`
  - `LANG_LABEL: Record<string, string>`

- [ ] **Step 1: Escrever os testes**

`tests/parser/subtitle.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseSubtitlePath, matchSubtitles, normalizeLang } from '../../src/main/parser/subtitle'

describe('parseSubtitlePath', () => {
  it('extrai idioma e marcadores do sufixo', () => {
    expect(parseSubtitlePath('Dark/Season 1/Dark.S01E03.pt-BR.forced.srt')).toMatchObject({
      dir: 'Dark/Season 1', base: 'Dark.S01E03', lang: 'por', forced: true, sdh: false, episodeCode: 'S01E03'
    })
    expect(parseSubtitlePath('Dark.S01E03.eng.sdh.srt')).toMatchObject({ base: 'Dark.S01E03', lang: 'eng', sdh: true })
  })
  it('sem idioma conhecido mantém o nome inteiro como base', () => {
    expect(parseSubtitlePath('Filmes/Interestelar.srt')).toMatchObject({ base: 'Interestelar', lang: undefined })
  })
  it('em pasta de legendas, detecta idioma pelo nome do arquivo', () => {
    expect(parseSubtitlePath('Filme/Subs/Filme.2014/2_Portuguese.srt').lang).toBe('por')
  })
  it('fora de pasta de legendas, não adivinha idioma por palavra do título', () => {
    expect(parseSubtitlePath('The.Italian.Job.2003.srt').lang).toBeUndefined()
  })
})

describe('normalizeLang', () => {
  it.each([['pt-BR', 'por'], ['pob', 'por'], ['fre', 'fra'], ['jpn', 'jpn'], ['und', undefined], [undefined, undefined]])(
    '%s -> %s', (input, out) => expect(normalizeLang(input)).toBe(out)
  )
})

describe('matchSubtitles', () => {
  const videos = [
    { relPath: 'Dark/Season 1/Dark.S01E03.1080p.mkv', episodeCodes: ['S01E03'] },
    { relPath: 'Dark/Season 1/Dark.S01E04.1080p.mkv', episodeCodes: ['S01E04'] },
    { relPath: 'Filmes/Filme.2014/Filme.2014.mkv', episodeCodes: [] }
  ]
  it('associa por mesmo nome, por subpasta Subs e por código de episódio', () => {
    const subs = [
      'Dark/Season 1/Dark.S01E03.1080p.pt-BR.srt',
      'Dark/Season 1/Legendas/Dark.S01E04.1080p.eng.srt',
      'Dark/Season 1/dark_s01e04_legenda.por.srt',
      'Filmes/Filme.2014/Subs/Filme.2014/3_English.srt',
      'Outros/sem-video.srt'
    ].map(parseSubtitlePath)
    const { matches, unmatched } = matchSubtitles(videos, subs)
    expect(matches.get('Dark/Season 1/Dark.S01E03.1080p.mkv')!.map((s) => s.relPath)).toEqual(['Dark/Season 1/Dark.S01E03.1080p.pt-BR.srt'])
    expect(matches.get('Dark/Season 1/Dark.S01E04.1080p.mkv')!.map((s) => s.relPath).sort()).toEqual([
      'Dark/Season 1/Legendas/Dark.S01E04.1080p.eng.srt',
      'Dark/Season 1/dark_s01e04_legenda.por.srt'
    ])
    expect(matches.get('Filmes/Filme.2014/Filme.2014.mkv')!.map((s) => s.lang)).toEqual(['eng'])
    expect(unmatched.map((s) => s.relPath)).toEqual(['Outros/sem-video.srt'])
  })
  it('não associa por código de episódio quando dois vídeos têm o mesmo código', () => {
    const vids = [
      { relPath: 'X/S01E01.720p.mkv', episodeCodes: ['S01E01'] },
      { relPath: 'X/S01E01.1080p.mkv', episodeCodes: ['S01E01'] }
    ]
    const { unmatched } = matchSubtitles(vids, [parseSubtitlePath('X/legenda S01E01.srt')])
    expect(unmatched).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/parser/subtitle.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/main/parser/subtitle.ts`**

```ts
import { splitPath, stripExt, SXE } from './video'
import { episodeCode } from './keys'

// .sub de texto (MicroDVD) é raro e ambíguo com o .sub do VobSub; usamos o .idx.
export const SUB_EXTS = new Set(['.srt', '.ass', '.ssa', '.vtt', '.idx'])

const LANGS: Record<string, string> = {
  'pt-br': 'por', ptbr: 'por', pob: 'por', pb: 'por', por: 'por', pt: 'por', portuguese: 'por', portugues: 'por',
  'português': 'por', brazilian: 'por',
  en: 'eng', eng: 'eng', english: 'eng', ingles: 'eng', 'inglês': 'eng',
  es: 'spa', spa: 'spa', spanish: 'spa', espanol: 'spa', 'español': 'spa', espanhol: 'spa',
  fr: 'fra', fre: 'fra', fra: 'fra', french: 'fra', frances: 'fra', 'francês': 'fra',
  de: 'deu', ger: 'deu', deu: 'deu', german: 'deu', alemao: 'deu', 'alemão': 'deu',
  it: 'ita', ita: 'ita', italian: 'ita', italiano: 'ita',
  ja: 'jpn', jpn: 'jpn', japanese: 'jpn', japones: 'jpn', 'japonês': 'jpn'
}

export const LANG_LABEL: Record<string, string> = {
  por: 'Português', eng: 'Inglês', spa: 'Espanhol', fra: 'Francês', deu: 'Alemão', ita: 'Italiano', jpn: 'Japonês'
}

const FORCED = /^(forced|forcada|forçada)$/i
const SDH = /^(sdh|cc|hi)$/i
const SUBS_DIR = /^(subs?|legendas?|subtitles?)$/i

export function normalizeLang(code?: string): string | undefined {
  if (!code) return undefined
  const c = code.toLowerCase()
  if (c === 'und') return undefined
  return LANGS[c] ?? c
}

export interface ParsedSub {
  relPath: string
  dir: string
  base: string
  lang?: string
  forced: boolean
  sdh: boolean
  episodeCode?: string
}

export function parseSubtitlePath(relPath: string): ParsedSub {
  const parts = splitPath(relPath)
  const name = stripExt(parts[parts.length - 1] ?? '')
  const dirs = parts.slice(0, -1)
  const tokens = name.split('.')
  let lang: string | undefined
  let forced = false
  let sdh = false
  while (tokens.length > 1) {
    const t = tokens[tokens.length - 1]!.toLowerCase()
    if (FORCED.test(t)) forced = true
    else if (SDH.test(t)) sdh = true
    else if (!lang && LANGS[t]) lang = LANGS[t]
    else break
    tokens.pop()
  }
  const base = tokens.join('.')
  const inSubsDir = dirs.some((d, i) => SUBS_DIR.test(d) && i >= dirs.length - 2)
  if (!lang && inSubsDir) {
    for (const w of base.split(/[ ._-]+/).reverse()) {
      const l = LANGS[w.toLowerCase()]
      if (l && w.length > 2) {
        lang = l
        break
      }
    }
  }
  const sxe = name.match(SXE)
  const sub: ParsedSub = { relPath: parts.join('/'), dir: dirs.join('/'), base, forced, sdh }
  if (lang) sub.lang = lang
  if (sxe) sub.episodeCode = episodeCode(Number(sxe[1]), Number(sxe[2]))
  return sub
}

export interface VideoRef { relPath: string; episodeCodes: string[] }

export function matchSubtitles(videos: VideoRef[], subs: ParsedSub[]): { matches: Map<string, ParsedSub[]>; unmatched: ParsedSub[] } {
  const byDir = new Map<string, { video: VideoRef; base: string }[]>()
  for (const v of videos) {
    const parts = splitPath(v.relPath)
    const dir = parts.slice(0, -1).join('/').toLowerCase()
    const list = byDir.get(dir) ?? []
    list.push({ video: v, base: stripExt(parts[parts.length - 1]!).toLowerCase() })
    byDir.set(dir, list)
  }
  const matches = new Map<string, ParsedSub[]>()
  const unmatched: ParsedSub[] = []
  const add = (v: VideoRef, s: ParsedSub) => matches.set(v.relPath, [...(matches.get(v.relPath) ?? []), s])

  for (const s of subs) {
    const dirParts = splitPath(s.dir)
    const last = dirParts[dirParts.length - 1] ?? ''
    const secondLast = dirParts[dirParts.length - 2] ?? ''
    const candidateDirs = [dirParts.join('/')]
    if (SUBS_DIR.test(last)) candidateDirs.push(dirParts.slice(0, -1).join('/'))
    const base = s.base.toLowerCase()

    // 1. mesmo nome-base na pasta da legenda ou na pasta acima de Subs/Legendas
    let found = candidateDirs
      .flatMap((d) => byDir.get(d.toLowerCase()) ?? [])
      .find((c) => c.base === base)?.video

    // 2. Subs/<nome-do-vídeo>/qualquer.srt
    if (!found && SUBS_DIR.test(secondLast)) {
      const videoDir = dirParts.slice(0, -2).join('/').toLowerCase()
      found = (byDir.get(videoDir) ?? []).find((c) => c.base === last.toLowerCase())?.video
    }

    // 3. mesmo código de episódio, desde que só um vídeo da pasta tenha esse código
    if (!found && s.episodeCode) {
      const hits = candidateDirs
        .flatMap((d) => byDir.get(d.toLowerCase()) ?? [])
        .filter((c) => c.video.episodeCodes.includes(s.episodeCode!))
      if (hits.length === 1) found = hits[0]!.video
    }

    if (found) add(found, s)
    else unmatched.push(s)
  }
  return { matches, unmatched }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run tests/parser`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/parser/subtitle.ts tests/parser/subtitle.test.ts
git commit -m "feat(parser): associa legendas externas a vídeos e detecta idioma"
```

---

### Task 4: Leitura de faixas com ffprobe

**Files:**
- Create: `src/main/scanner/probe.ts`, `tests/fixtures/tiny.mkv`, `tests/helpers/ffprobe.ts`
- Test: `tests/scanner/probe.test.ts`

**Interfaces:**
- Consumes: `ProbeResult`, `ProbeTrack` (Task 2), `normalizeLang` (Task 3).
- Produces: `parseFfprobe(json: unknown): ProbeResult`, `probeFile(ffprobePath: string, absPath: string, timeoutMs?: number): Promise<ProbeResult>`; helper de teste `findFfprobe(): string | null`.

- [ ] **Step 1: Gerar o vídeo de teste (1 s, 1 áudio por, 1 legenda eng; poucos KB) e commitá-lo como fixture**

Run (PowerShell, precisa do `ffmpeg` local; só nesta etapa):
```powershell
Set-Content -Path $env:TEMP\t.srt -Value "1`r`n00:00:00,000 --> 00:00:01,000`r`nola`r`n"
ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=10 -f lavfi -i sine=frequency=440 -i $env:TEMP\t.srt -t 1 -map 0:v -map 1:a -map 2:s -c:v libx264 -c:a aac -c:s srt -metadata:s:a:0 language=por -metadata:s:s:0 language=eng -disposition:a:0 default tests/fixtures/tiny.mkv
```
Expected: `tests/fixtures/tiny.mkv` com menos de 50 KB.

- [ ] **Step 2: Criar o helper que encontra o ffprobe**

`tests/helpers/ffprobe.ts`:
```ts
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function findFfprobe(): string | null {
  const vendored = join(process.cwd(), 'vendor', 'bin', 'ffprobe.exe')
  if (existsSync(vendored)) return vendored
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return 'ffprobe'
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Escrever os testes**

`tests/scanner/probe.test.ts`:
```ts
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
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run tests/scanner/probe.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 5: Implementar `src/main/scanner/probe.ts`**

```ts
import { execFile } from 'node:child_process'
import type { ProbeResult, ProbeTrack } from '../../shared/types'
import { normalizeLang } from '../parser/subtitle'

interface FfStream {
  index: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  tags?: { language?: string; title?: string }
  disposition?: { default?: number; forced?: number; attached_pic?: number }
}

export function parseFfprobe(json: unknown): ProbeResult {
  const j = (json ?? {}) as { streams?: FfStream[]; format?: { duration?: string } }
  const streams = j.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const tracks: ProbeTrack[] = []
  let audio = 0
  let sub = 0
  for (const s of streams) {
    if (s.codec_type !== 'audio' && s.codec_type !== 'subtitle') continue
    const type = s.codec_type === 'audio' ? 'audio' : 'sub'
    tracks.push({
      type,
      streamIndex: s.index,
      typeIndex: type === 'audio' ? ++audio : ++sub,
      codec: s.codec_name ?? 'desconhecido',
      lang: normalizeLang(s.tags?.language),
      title: s.tags?.title,
      isDefault: s.disposition?.default === 1,
      isForced: s.disposition?.forced === 1
    })
  }
  const d = Number(j.format?.duration)
  return {
    durationS: Number.isFinite(d) ? d : undefined,
    width: video?.width,
    height: video?.height,
    videoCodec: video?.codec_name,
    tracks
  }
}

export function probeFile(ffprobePath: string, absPath: string, timeoutMs = 30000): Promise<ProbeResult> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absPath]
  return new Promise((resolve, reject) => {
    execFile(ffprobePath, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return reject(err)
      try {
        resolve(parseFfprobe(JSON.parse(stdout)))
      } catch (e) {
        reject(e)
      }
    })
  })
}
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/scanner/probe.test.ts`
Expected: PASS (os testes com ffprobe real rodam porque o ffprobe está no PATH desta máquina).

- [ ] **Step 7: Commit**

```bash
git add src/main/scanner/probe.ts tests/scanner/probe.test.ts tests/helpers tests/fixtures/tiny.mkv
git commit -m "feat(scanner): lê faixas, resolução e duração com ffprobe"
```

---

### Task 5: Banco de dados

**Files:**
- Create: `src/main/db/schema.ts`, `src/main/db/database.ts`, `src/main/db/repo.ts`
- Test: `tests/db/repo.test.ts`

**Interfaces:**
- Consumes: tipos de `src/shared/types.ts`.
- Produces:
  - `type Db = DatabaseSync`; `openDatabase(file: string): Db`; `tx<T>(db: Db, fn: () => T): T`
  - `upsertLibrary(db, lib: { id: string; label: string; rootPath: string }): void`
  - `setLibraryStatus(db, id: string, status: LibraryStatus, rootPath?: string): void`
  - `setAllLibrariesOffline(db): void`
  - `listLibraries(db): LibraryView[]`
  - `setLastScan(db, id: string): void`
  - `upsertTitle(db, t: { kind: 'series' | 'movie'; localKey: string; name: string; year?: number }): number`
  - `upsertItem(db, i: { key: string; titleId: number; season: number | null; episode: number | null }): void`
  - `interface FileRow { id: number; itemKey: string; relPath: string; size: number; mtimeMs: number; probedAt: string | null }`
  - `listLibraryFiles(db, libraryId: string): FileRow[]`
  - `upsertFile(db, f: { itemKey: string; libraryId: string; relPath: string; size: number; mtimeMs: number; probe?: ProbeResult | null }): number` (probe `undefined` mantém dados anteriores; `null` registra falha)
  - `interface ExternalSub { relPath: string; lang?: string; forced: boolean; sdh: boolean; codec: string }`
  - `replaceEmbeddedTracks(db, fileId: number, tracks: ProbeTrack[]): void`
  - `replaceExternalSubs(db, fileId: number, subs: ExternalSub[]): void`
  - `markMissing(db, libraryId: string, seenFileIds: Set<number>): void`
  - `replaceUnmatched(db, libraryId: string, entries: { relPath: string; reason: string }[]): void`
  - `librarySummary(db, libraryId: string): { series: number; movies: number; episodes: number; subtitles: number; unmatched: number }`
  - `getCatalog(db): Catalog`
  - `getTitleDetail(db, id: number): TitleDetail | null`

- [ ] **Step 1: Escrever os testes**

`tests/db/repo.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/main/db/database'
import * as repo from '../../src/main/db/repo'

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  repo.upsertLibrary(db, { id: 'lib1', label: 'HD Séries', rootPath: 'E:\\Videos\\Series' })
})

function addEpisode(code: string, relPath: string, libraryId = 'lib1') {
  const titleId = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark' })
  const key = `local:dark:${code}`
  repo.upsertItem(db, { key, titleId, season: Number(code.slice(1, 3)), episode: Number(code.slice(4)) })
  return repo.upsertFile(db, { itemKey: key, libraryId, relPath, size: 100, mtimeMs: 1, probe: { height: 1080, videoCodec: 'hevc', tracks: [] } })
}

describe('repo', () => {
  it('migra e lista bibliotecas', () => {
    expect(repo.listLibraries(db)).toEqual([
      { id: 'lib1', label: 'HD Séries', rootPath: 'E:\\Videos\\Series', status: 'online', lastScanAt: undefined }
    ])
  })

  it('upsertTitle é idempotente pela chave local', () => {
    const a = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'Dark' })
    const b = repo.upsertTitle(db, { kind: 'series', localKey: 'series:dark', name: 'dark' })
    expect(a).toBe(b)
  })

  it('upsertFile com probe undefined preserva os dados lidos antes', () => {
    const id = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    const again = repo.upsertFile(db, { itemKey: 'local:dark:S01E01', libraryId: 'lib1', relPath: 'Dark/S1/e1.mkv', size: 100, mtimeMs: 1 })
    expect(again).toBe(id)
    expect(repo.listLibraryFiles(db, 'lib1')[0]!.probedAt).not.toBeNull()
    expect(repo.getTitleDetail(db, repo.getCatalog(db).series[0]!.id)!.items[0]!.files[0]!.height).toBe(1080)
  })

  it('catálogo, detalhe e contagem de faixas', () => {
    const f1 = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    addEpisode('S01E02', 'Dark/S1/e2.mkv')
    repo.replaceEmbeddedTracks(db, f1, [
      { type: 'audio', streamIndex: 1, typeIndex: 1, codec: 'aac', lang: 'por', isDefault: true, isForced: false }
    ])
    repo.replaceExternalSubs(db, f1, [{ relPath: 'Dark/S1/e1.pt-BR.srt', lang: 'por', forced: false, sdh: false, codec: 'srt' }])
    const cat = repo.getCatalog(db)
    expect(cat.series).toEqual([{ id: expect.any(Number), kind: 'series', name: 'Dark', year: undefined, available: true, offlineLabels: [] }])
    const detail = repo.getTitleDetail(db, cat.series[0]!.id)!
    expect(detail.items.map((i) => [i.season, i.episode])).toEqual([[1, 1], [1, 2]])
    expect(detail.items[0]!.files[0]).toMatchObject({ audioCount: 1, subCount: 1, libraryLabel: 'HD Séries', available: true })
  })

  it('biblioteca offline: título continua visível, indisponível, com o apelido', () => {
    addEpisode('S01E01', 'Dark/S1/e1.mkv')
    repo.setLibraryStatus(db, 'lib1', 'offline')
    expect(repo.getCatalog(db).series[0]).toMatchObject({ available: false, offlineLabels: ['HD Séries'] })
  })

  it('markMissing esconde arquivos não vistos e mostra de novo quando voltam', () => {
    const f1 = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    const f2 = addEpisode('S01E02', 'Dark/S1/e2.mkv')
    repo.markMissing(db, 'lib1', new Set([f1]))
    expect(repo.getTitleDetail(db, repo.getCatalog(db).series[0]!.id)!.items).toHaveLength(1)
    repo.markMissing(db, 'lib1', new Set([f1, f2]))
    expect(repo.getTitleDetail(db, repo.getCatalog(db).series[0]!.id)!.items).toHaveLength(2)
  })

  it('setLibraryStatus atualiza o endereço quando a letra muda', () => {
    repo.setLibraryStatus(db, 'lib1', 'online', 'F:\\Videos\\Series')
    expect(repo.listLibraries(db)[0]!.rootPath).toBe('F:\\Videos\\Series')
  })

  it('resumo da biblioteca', () => {
    const f1 = addEpisode('S01E01', 'Dark/S1/e1.mkv')
    repo.replaceExternalSubs(db, f1, [{ relPath: 'Dark/S1/e1.srt', forced: false, sdh: false, codec: 'srt' }])
    repo.replaceUnmatched(db, 'lib1', [{ relPath: 'x.mkv', reason: 'nome não reconhecido' }])
    expect(repo.librarySummary(db, 'lib1')).toEqual({ series: 1, movies: 0, episodes: 1, subtitles: 1, unmatched: 1 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/db`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `src/main/db/schema.ts`**

```ts
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE libraries (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, root_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline', last_seen_at TEXT, last_scan_at TEXT
  );
  CREATE TABLE titles (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('movie','series')),
    local_key TEXT NOT NULL UNIQUE, tmdb_id INTEGER, name TEXT NOT NULL, year INTEGER,
    overview TEXT, poster_cache TEXT, backdrop_cache TEXT, matched_at TEXT
  );
  CREATE TABLE items (
    key TEXT PRIMARY KEY, title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season INTEGER, episode INTEGER, name TEXT, overview TEXT, runtime_s INTEGER
  );
  CREATE TABLE files (
    id INTEGER PRIMARY KEY, item_key TEXT NOT NULL REFERENCES items(key) ON DELETE CASCADE,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
    duration_s REAL, width INTEGER, height INTEGER, video_codec TEXT, probed_at TEXT,
    missing INTEGER NOT NULL DEFAULT 0,
    UNIQUE (library_id, rel_path, item_key)
  );
  CREATE TABLE tracks (
    id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('embedded','external')),
    type TEXT NOT NULL CHECK (type IN ('audio','sub')),
    stream_index INTEGER, type_index INTEGER, codec TEXT, lang TEXT, title TEXT,
    is_default INTEGER NOT NULL DEFAULT 0, is_forced INTEGER NOT NULL DEFAULT 0,
    is_sdh INTEGER NOT NULL DEFAULT 0, external_path TEXT
  );
  CREATE TABLE progress (
    item_key TEXT PRIMARY KEY, position_s REAL NOT NULL, duration_s REAL,
    watched INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, device_id TEXT
  );
  CREATE TABLE prefs (
    title_id INTEGER PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE, audio_lang TEXT, sub_lang TEXT
  );
  CREATE TABLE unmatched (
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (library_id, rel_path)
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE INDEX idx_files_item ON files(item_key);
  CREATE INDEX idx_files_library ON files(library_id);
  CREATE INDEX idx_items_title ON items(title_id);
  CREATE INDEX idx_tracks_file ON tracks(file_id);
  `
]
```

- [ ] **Step 4: Implementar `src/main/db/database.ts`**

```ts
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './schema'

export type Db = DatabaseSync

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function migrate(db: Db): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}
```

- [ ] **Step 5: Implementar `src/main/db/repo.ts`**

```ts
import type { Catalog, FileView, ItemView, LibraryStatus, LibraryView, ProbeResult, ProbeTrack, TitleCard, TitleDetail } from '../../shared/types'
import type { Db } from './database'

const now = () => new Date().toISOString()
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v)

export function upsertLibrary(db: Db, lib: { id: string; label: string; rootPath: string }): void {
  db.prepare(
    `INSERT INTO libraries (id, label, root_path, status, last_seen_at) VALUES (?, ?, ?, 'online', ?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, root_path = excluded.root_path,
       status = 'online', last_seen_at = excluded.last_seen_at`
  ).run(lib.id, lib.label, lib.rootPath, now())
}

export function setLibraryStatus(db: Db, id: string, status: LibraryStatus, rootPath?: string): void {
  if (rootPath) db.prepare('UPDATE libraries SET root_path = ? WHERE id = ?').run(rootPath, id)
  if (status === 'online') db.prepare(`UPDATE libraries SET status = 'online', last_seen_at = ? WHERE id = ?`).run(now(), id)
  else db.prepare(`UPDATE libraries SET status = 'offline' WHERE id = ?`).run(id)
}

export function setAllLibrariesOffline(db: Db): void {
  db.exec(`UPDATE libraries SET status = 'offline'`)
}

export function listLibraries(db: Db): LibraryView[] {
  const rows = db.prepare('SELECT id, label, root_path, status, last_scan_at FROM libraries ORDER BY label').all() as {
    id: string; label: string; root_path: string; status: LibraryStatus; last_scan_at: string | null
  }[]
  return rows.map((r) => ({ id: r.id, label: r.label, rootPath: r.root_path, status: r.status, lastScanAt: opt(r.last_scan_at) }))
}

export function setLastScan(db: Db, id: string): void {
  db.prepare('UPDATE libraries SET last_scan_at = ? WHERE id = ?').run(now(), id)
}

export function upsertTitle(db: Db, t: { kind: 'series' | 'movie'; localKey: string; name: string; year?: number }): number {
  db.prepare('INSERT INTO titles (kind, local_key, name, year) VALUES (?, ?, ?, ?) ON CONFLICT(local_key) DO NOTHING').run(
    t.kind, t.localKey, t.name, t.year ?? null
  )
  return (db.prepare('SELECT id FROM titles WHERE local_key = ?').get(t.localKey) as { id: number }).id
}

export function upsertItem(db: Db, i: { key: string; titleId: number; season: number | null; episode: number | null }): void {
  db.prepare('INSERT INTO items (key, title_id, season, episode) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING').run(
    i.key, i.titleId, i.season, i.episode
  )
}

export interface FileRow { id: number; itemKey: string; relPath: string; size: number; mtimeMs: number; probedAt: string | null }

export function listLibraryFiles(db: Db, libraryId: string): FileRow[] {
  const rows = db.prepare('SELECT id, item_key, rel_path, size, mtime_ms, probed_at FROM files WHERE library_id = ?').all(libraryId) as {
    id: number; item_key: string; rel_path: string; size: number; mtime_ms: number; probed_at: string | null
  }[]
  return rows.map((r) => ({ id: r.id, itemKey: r.item_key, relPath: r.rel_path, size: r.size, mtimeMs: r.mtime_ms, probedAt: r.probed_at }))
}

export function upsertFile(
  db: Db,
  f: { itemKey: string; libraryId: string; relPath: string; size: number; mtimeMs: number; probe?: ProbeResult | null }
): number {
  db.prepare(
    `INSERT INTO files (item_key, library_id, rel_path, size, mtime_ms) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(library_id, rel_path, item_key) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, missing = 0`
  ).run(f.itemKey, f.libraryId, f.relPath, f.size, f.mtimeMs)
  const { id } = db.prepare('SELECT id FROM files WHERE library_id = ? AND rel_path = ? AND item_key = ?').get(
    f.libraryId, f.relPath, f.itemKey
  ) as { id: number }
  if (f.probe !== undefined) {
    const p = f.probe
    db.prepare('UPDATE files SET duration_s = ?, width = ?, height = ?, video_codec = ?, probed_at = ? WHERE id = ?').run(
      p?.durationS ?? null, p?.width ?? null, p?.height ?? null, p?.videoCodec ?? null, now(), id
    )
  }
  return id
}

export function replaceEmbeddedTracks(db: Db, fileId: number, tracks: ProbeTrack[]): void {
  db.prepare(`DELETE FROM tracks WHERE file_id = ? AND source = 'embedded'`).run(fileId)
  const ins = db.prepare(
    `INSERT INTO tracks (file_id, source, type, stream_index, type_index, codec, lang, title, is_default, is_forced)
     VALUES (?, 'embedded', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const t of tracks) {
    ins.run(fileId, t.type, t.streamIndex, t.typeIndex, t.codec, t.lang ?? null, t.title ?? null, t.isDefault ? 1 : 0, t.isForced ? 1 : 0)
  }
}

export interface ExternalSub { relPath: string; lang?: string; forced: boolean; sdh: boolean; codec: string }

export function replaceExternalSubs(db: Db, fileId: number, subs: ExternalSub[]): void {
  db.prepare(`DELETE FROM tracks WHERE file_id = ? AND source = 'external'`).run(fileId)
  const ins = db.prepare(
    `INSERT INTO tracks (file_id, source, type, codec, lang, is_forced, is_sdh, external_path) VALUES (?, 'external', 'sub', ?, ?, ?, ?, ?)`
  )
  for (const s of subs) ins.run(fileId, s.codec, s.lang ?? null, s.forced ? 1 : 0, s.sdh ? 1 : 0, s.relPath)
}

export function markMissing(db: Db, libraryId: string, seenFileIds: Set<number>): void {
  db.prepare('UPDATE files SET missing = 1 WHERE library_id = ?').run(libraryId)
  const back = db.prepare('UPDATE files SET missing = 0 WHERE id = ?')
  for (const id of seenFileIds) back.run(id)
}

export function replaceUnmatched(db: Db, libraryId: string, entries: { relPath: string; reason: string }[]): void {
  db.prepare('DELETE FROM unmatched WHERE library_id = ?').run(libraryId)
  const ins = db.prepare('INSERT OR REPLACE INTO unmatched (library_id, rel_path, reason) VALUES (?, ?, ?)')
  for (const e of entries) ins.run(libraryId, e.relPath, e.reason)
}

export function librarySummary(db: Db, libraryId: string) {
  const count = (sql: string) => (db.prepare(sql).get(libraryId) as { n: number }).n
  const base = `FROM titles t JOIN items i ON i.title_id = t.id JOIN files f ON f.item_key = i.key WHERE f.library_id = ? AND f.missing = 0`
  return {
    series: count(`SELECT COUNT(DISTINCT t.id) AS n ${base} AND t.kind = 'series'`),
    movies: count(`SELECT COUNT(DISTINCT t.id) AS n ${base} AND t.kind = 'movie'`),
    episodes: count(`SELECT COUNT(DISTINCT i.key) AS n ${base} AND t.kind = 'series'`),
    subtitles: count(
      `SELECT COUNT(DISTINCT tr.external_path) AS n FROM tracks tr JOIN files f ON f.id = tr.file_id
       WHERE f.library_id = ? AND f.missing = 0 AND tr.source = 'external'`
    ),
    unmatched: count('SELECT COUNT(*) AS n FROM unmatched WHERE library_id = ?')
  }
}

interface CatalogRow { id: number; kind: 'series' | 'movie'; name: string; year: number | null; label: string; status: LibraryStatus; missing: number }

export function getCatalog(db: Db): Catalog {
  const rows = db.prepare(
    `SELECT t.id, t.kind, t.name, t.year, l.label, l.status, f.missing
     FROM titles t JOIN items i ON i.title_id = t.id JOIN files f ON f.item_key = i.key JOIN libraries l ON l.id = f.library_id`
  ).all() as unknown as CatalogRow[]
  const cards = new Map<number, TitleCard & { visible: boolean }>()
  for (const r of rows) {
    const c = cards.get(r.id) ?? { id: r.id, kind: r.kind, name: r.name, year: opt(r.year), available: false, offlineLabels: [], visible: false }
    if (r.status === 'online' && r.missing === 0) c.available = true
    if (r.status === 'offline' && !c.offlineLabels.includes(r.label)) c.offlineLabels.push(r.label)
    if (r.status === 'offline' || r.missing === 0) c.visible = true
    cards.set(r.id, c)
  }
  const list = [...cards.values()]
    .filter((c) => c.visible)
    .map(({ visible: _v, ...c }) => c)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return { series: list.filter((c) => c.kind === 'series'), movies: list.filter((c) => c.kind === 'movie') }
}

export function getTitleDetail(db: Db, id: number): TitleDetail | null {
  const t = db.prepare('SELECT id, kind, name, year FROM titles WHERE id = ?').get(id) as
    | { id: number; kind: 'series' | 'movie'; name: string; year: number | null }
    | undefined
  if (!t) return null
  const items = db.prepare('SELECT key, season, episode FROM items WHERE title_id = ? ORDER BY season, episode').all(id) as {
    key: string; season: number | null; episode: number | null
  }[]
  const files = db.prepare(
    `SELECT f.id, f.item_key, f.rel_path, f.height, f.video_codec, f.missing, l.label, l.status,
       (SELECT COUNT(*) FROM tracks tr WHERE tr.file_id = f.id AND tr.type = 'audio') AS audio_count,
       (SELECT COUNT(*) FROM tracks tr WHERE tr.file_id = f.id AND tr.type = 'sub') AS sub_count
     FROM files f JOIN libraries l ON l.id = f.library_id JOIN items i ON i.key = f.item_key
     WHERE i.title_id = ? AND (f.missing = 0 OR l.status = 'offline')
     ORDER BY f.height DESC`
  ).all(id) as {
    id: number; item_key: string; rel_path: string; height: number | null; video_codec: string | null; missing: number
    label: string; status: LibraryStatus; audio_count: number; sub_count: number
  }[]
  const byItem = new Map<string, FileView[]>()
  for (const f of files) {
    const view: FileView = {
      id: f.id, relPath: f.rel_path, libraryLabel: f.label, available: f.status === 'online' && f.missing === 0,
      height: opt(f.height), videoCodec: opt(f.video_codec), audioCount: f.audio_count, subCount: f.sub_count
    }
    byItem.set(f.item_key, [...(byItem.get(f.item_key) ?? []), view])
  }
  const itemViews: ItemView[] = items
    .filter((i) => byItem.has(i.key))
    .map((i) => ({ key: i.key, season: i.season, episode: i.episode, files: byItem.get(i.key)! }))
  return { id: t.id, kind: t.kind, name: t.name, year: opt(t.year), items: itemViews }
}
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/db tests/db
git commit -m "feat(db): esquema SQLite, catálogo e detalhe de título"
```

---

### Task 6: Bibliotecas: marcador, troca de letra e monitor

**Files:**
- Create: `src/main/libraries/marker.ts`, `src/main/libraries/resolve.ts`, `src/main/libraries/monitor.ts`
- Test: `tests/libraries/resolve.test.ts`, `tests/libraries/marker.test.ts`, `tests/libraries/monitor.test.ts`

**Interfaces:**
- Consumes: `LibraryStatus` (Task 2).
- Produces:
  - `MARKER = '.brammp4.json'`; `interface Marker { id: string; label: string; createdAt: string }`
  - `readMarker(dir: string): Promise<Marker | null>`; `writeMarker(dir: string, label: string): Promise<Marker>`
  - `type Resolved = { status: 'online'; rootPath: string } | { status: 'offline' }`
  - `resolveLibrary(lib: { id: string; rootPath: string }, deps?: { readMarker?: (dir: string) => Promise<Marker | null>; letters?: string[] }): Promise<Resolved>`
  - `class LibraryMonitor { constructor(opts: { intervalMs: number; list: () => { id: string; rootPath: string; status: LibraryStatus }[]; resolve: (lib: { id: string; rootPath: string }) => Promise<Resolved>; onChange: (id: string, r: Resolved) => void }); tick(): Promise<void>; start(): void; stop(): void }`

- [ ] **Step 1: Escrever os testes**

`tests/libraries/marker.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMarker, writeMarker } from '../../src/main/libraries/marker'

describe('marker', () => {
  it('grava e lê o marcador; pasta sem marcador retorna null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brammp4-'))
    expect(await readMarker(dir)).toBeNull()
    const m = await writeMarker(dir, 'HD Séries')
    expect(m.label).toBe('HD Séries')
    expect(await readMarker(dir)).toEqual(m)
  })
  it('pasta inexistente (disco desconectado) retorna null', async () => {
    expect(await readMarker('Q:\\nao\\existe')).toBeNull()
  })
})
```

`tests/libraries/resolve.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveLibrary } from '../../src/main/libraries/resolve'
import type { Marker } from '../../src/main/libraries/marker'

const marker = (id: string): Marker => ({ id, label: 'HD', createdAt: '' })
const fakeFs = (present: Record<string, string>) => async (dir: string) => (present[dir] ? marker(present[dir]!) : null)

describe('resolveLibrary', () => {
  const lib = { id: 'abc', rootPath: 'E:\\Videos\\Series' }
  it('online no endereço guardado', async () => {
    expect(await resolveLibrary(lib, { readMarker: fakeFs({ 'E:\\Videos\\Series': 'abc' }) })).toEqual({ status: 'online', rootPath: 'E:\\Videos\\Series' })
  })
  it('encontra a mesma pasta em outra letra', async () => {
    expect(await resolveLibrary(lib, { readMarker: fakeFs({ 'G:\\Videos\\Series': 'abc' }) })).toEqual({ status: 'online', rootPath: 'G:\\Videos\\Series' })
  })
  it('ignora pasta com mesmo caminho mas outro ID (outro disco)', async () => {
    expect(await resolveLibrary(lib, { readMarker: fakeFs({ 'F:\\Videos\\Series': 'outro' }) })).toEqual({ status: 'offline' })
  })
  it('offline quando não acha em lugar nenhum', async () => {
    expect(await resolveLibrary(lib, { readMarker: fakeFs({}) })).toEqual({ status: 'offline' })
  })
})
```

`tests/libraries/monitor.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { LibraryMonitor } from '../../src/main/libraries/monitor'
import type { Resolved } from '../../src/main/libraries/resolve'
import type { LibraryStatus } from '../../src/shared/types'

describe('LibraryMonitor.tick', () => {
  it('avisa só quando status ou endereço mudam', async () => {
    const libs = [
      { id: 'a', rootPath: 'E:\\S', status: 'offline' as LibraryStatus },
      { id: 'b', rootPath: 'F:\\F', status: 'online' as LibraryStatus },
      { id: 'c', rootPath: 'G:\\X', status: 'online' as LibraryStatus }
    ]
    const results: Record<string, Resolved> = {
      a: { status: 'online', rootPath: 'E:\\S' },
      b: { status: 'online', rootPath: 'F:\\F' },
      c: { status: 'online', rootPath: 'H:\\X' }
    }
    const changes: [string, Resolved][] = []
    const m = new LibraryMonitor({ intervalMs: 3000, list: () => libs, resolve: async (l) => results[l.id]!, onChange: (id, r) => changes.push([id, r]) })
    await m.tick()
    expect(changes).toEqual([['a', results.a], ['c', results.c]])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/libraries`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `src/main/libraries/marker.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const MARKER = '.brammp4.json'

export interface Marker { id: string; label: string; createdAt: string }

export async function readMarker(dir: string): Promise<Marker | null> {
  try {
    const j = JSON.parse(await readFile(join(dir, MARKER), 'utf8')) as Partial<Marker>
    return typeof j.id === 'string' ? { id: j.id, label: String(j.label ?? ''), createdAt: String(j.createdAt ?? '') } : null
  } catch {
    return null
  }
}

/** Grava o marcador uma única vez e o oculta no Windows (reescrever arquivo oculto falha com EPERM). */
export async function writeMarker(dir: string, label: string): Promise<Marker> {
  const m: Marker = { id: randomUUID(), label, createdAt: new Date().toISOString() }
  const file = join(dir, MARKER)
  await writeFile(file, JSON.stringify(m, null, 2), 'utf8')
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => execFile('attrib', ['+h', file], { windowsHide: true }, () => resolve()))
  }
  return m
}
```

- [ ] **Step 4: Implementar `src/main/libraries/resolve.ts`**

```ts
import { readMarker as realReadMarker, type Marker } from './marker'

export type Resolved = { status: 'online'; rootPath: string } | { status: 'offline' }

export const DEFAULT_LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export async function resolveLibrary(
  lib: { id: string; rootPath: string },
  deps: { readMarker?: (dir: string) => Promise<Marker | null>; letters?: string[] } = {}
): Promise<Resolved> {
  const read = deps.readMarker ?? realReadMarker
  const letters = deps.letters ?? DEFAULT_LETTERS
  if ((await read(lib.rootPath))?.id === lib.id) return { status: 'online', rootPath: lib.rootPath }
  const m = /^([A-Za-z]):(.*)$/.exec(lib.rootPath)
  if (!m) return { status: 'offline' }
  const current = m[1]!.toUpperCase()
  for (const letter of letters) {
    if (letter === current) continue
    const candidate = `${letter}:${m[2]}`
    if ((await read(candidate))?.id === lib.id) return { status: 'online', rootPath: candidate }
  }
  return { status: 'offline' }
}
```

- [ ] **Step 5: Implementar `src/main/libraries/monitor.ts`**

```ts
import type { LibraryStatus } from '../../shared/types'
import type { Resolved } from './resolve'

interface MonitorOpts {
  intervalMs: number
  list: () => { id: string; rootPath: string; status: LibraryStatus }[]
  resolve: (lib: { id: string; rootPath: string }) => Promise<Resolved>
  onChange: (id: string, r: Resolved) => void
}

export class LibraryMonitor {
  private timer: NodeJS.Timeout | undefined
  private running = false

  constructor(private readonly opts: MonitorOpts) {}

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const lib of this.opts.list()) {
        const r = await this.opts.resolve(lib)
        const changed = r.status !== lib.status || (r.status === 'online' && r.rootPath !== lib.rootPath)
        if (changed) this.opts.onChange(lib.id, r)
      }
    } finally {
      this.running = false
    }
  }

  start(): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/libraries`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/libraries tests/libraries
git commit -m "feat(libraries): marcador da pasta, troca de letra e monitor de conexão"
```

---

### Task 7: Varredura incremental

**Files:**
- Create: `src/main/scanner/walk.ts`, `src/main/scanner/scan.ts`
- Test: `tests/scanner/scan.test.ts`

**Interfaces:**
- Consumes: `parseVideoPath`, `isIgnored`, `extOf`, `VIDEO_EXTS` (Task 2); `titleOf`, `itemsOf`, `episodeCodesOf` (Task 2); `SUB_EXTS`, `parseSubtitlePath`, `matchSubtitles` (Task 3); repo e `tx` (Task 5); `ProbeResult`, `ScanProgress`, `ScanSummary` (Task 2).
- Produces:
  - `interface WalkEntry { relPath: string; size: number; mtimeMs: number }`
  - `walkLibrary(root: string): Promise<{ videos: WalkEntry[]; subs: string[] }>`
  - `interface ScanDeps { db: Db; probe: (absPath: string) => Promise<ProbeResult>; isOnline: () => Promise<boolean>; onProgress?: (p: ScanProgress) => void; concurrency?: number }`
  - `scanLibrary(lib: { id: string; rootPath: string }, deps: ScanDeps): Promise<ScanSummary>`

- [ ] **Step 1: Escrever os testes (pasta temporária com arquivos vazios e ffprobe falso)**

`tests/scanner/scan.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { openDatabase, type Db } from '../../src/main/db/database'
import * as repo from '../../src/main/db/repo'
import { scanLibrary } from '../../src/main/scanner/scan'
import type { ProbeResult } from '../../src/shared/types'

let root: string
let db: Db
const lib = () => ({ id: 'lib1', rootPath: root })
const touch = (rel: string, content = 'x') => {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
}
const okProbe = async (): Promise<ProbeResult> => ({
  height: 1080, videoCodec: 'hevc', durationS: 100,
  tracks: [{ type: 'audio', streamIndex: 1, typeIndex: 1, codec: 'aac', lang: 'por', isDefault: true, isForced: false }]
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brammp4-lib-'))
  db = openDatabase(':memory:')
  repo.upsertLibrary(db, { id: 'lib1', label: 'HD Séries', rootPath: root })
  touch('Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E01.mkv')
  touch('Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E01.pt-BR.srt')
  touch('Séries/La Casa de Papel/Temporada 1/La.Casa.de.Papel.S01E02.mkv')
  touch('Séries/La Casa de Papel/Extras/Making of.mkv')
  touch('Filmes/Interestelar (2014)/Interestelar.2014.1080p.mkv')
  touch('Filmes/Interestelar (2014)/Interestelar.2014.sample.mkv')
  touch('Filmes/aleatorio/Temporada 1/notas.mkv')
})

describe('scanLibrary', () => {
  it('varredura inicial: séries, filmes, legendas e não identificados', async () => {
    const progress: number[] = []
    const s = await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true, onProgress: (p) => progress.push(p.done) })
    expect(s).toMatchObject({ aborted: false, videos: 4, probed: 3, series: 1, movies: 1, episodes: 2, subtitles: 1, unmatched: 1 })
    expect(progress.at(-1)).toBe(3)
    const cat = repo.getCatalog(db)
    expect(cat.series.map((c) => c.name)).toEqual(['La Casa de Papel'])
    expect(cat.movies.map((c) => [c.name, c.year])).toEqual([['Interestelar', 2014]])
    const ep1 = repo.getTitleDetail(db, cat.series[0]!.id)!.items[0]!.files[0]!
    expect(ep1).toMatchObject({ height: 1080, audioCount: 1, subCount: 1 })
  })

  it('segunda varredura não roda ffprobe em arquivos inalterados', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    let calls = 0
    const s = await scanLibrary(lib(), { db, probe: async () => { calls++; return okProbe() }, isOnline: async () => true })
    expect(calls).toBe(0)
    expect(s.probed).toBe(0)
  })

  it('arquivo alterado é lido de novo', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    const f = join(root, 'Filmes/Interestelar (2014)/Interestelar.2014.1080p.mkv')
    writeFileSync(f, 'conteúdo maior')
    utimesSync(f, new Date(), new Date(Date.now() + 5000))
    let calls = 0
    await scanLibrary(lib(), { db, probe: async () => { calls++; return okProbe() }, isOnline: async () => true })
    expect(calls).toBe(1)
  })

  it('vídeo que o ffprobe não lê continua no catálogo, sem faixas', async () => {
    const s = await scanLibrary(lib(), { db, probe: async () => { throw new Error('corrompido') }, isOnline: async () => true })
    expect(s.aborted).toBe(false)
    const cat = repo.getCatalog(db)
    expect(repo.getTitleDetail(db, cat.movies[0]!.id)!.items[0]!.files[0]).toMatchObject({ audioCount: 0, height: undefined })
  })

  it('disco removido durante a leitura: nada é marcado como sumido', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    rmSync(join(root, 'Filmes'), { recursive: true, force: true })
    const s = await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => false })
    expect(s.aborted).toBe(true)
    expect(repo.getCatalog(db).movies).toHaveLength(1)
  })

  it('pasta raiz inacessível: aborta sem alterar o banco', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    const s = await scanLibrary({ id: 'lib1', rootPath: join(root, 'nao-existe') }, { db, probe: okProbe, isOnline: async () => true })
    expect(s.aborted).toBe(true)
    expect(repo.getCatalog(db).series).toHaveLength(1)
  })

  it('arquivo apagado com o disco conectado some do catálogo', async () => {
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    rmSync(join(root, 'Filmes'), { recursive: true, force: true })
    await scanLibrary(lib(), { db, probe: okProbe, isOnline: async () => true })
    expect(repo.getCatalog(db).movies).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/scanner/scan.test.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `src/main/scanner/walk.ts`**

```ts
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { extOf, isIgnored, VIDEO_EXTS } from '../parser/video'
import { SUB_EXTS } from '../parser/subtitle'

export interface WalkEntry { relPath: string; size: number; mtimeMs: number }

/** Lista vídeos e legendas da biblioteca. Lança erro se a pasta sumir no meio (disco removido). */
export async function walkLibrary(root: string): Promise<{ videos: WalkEntry[]; subs: string[] }> {
  const videos: WalkEntry[] = []
  const subs: string[] = []
  async function visit(relDir: string): Promise<void> {
    const entries = await readdir(join(root, relDir), { withFileTypes: true })
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (isIgnored(rel)) continue
      if (e.isDirectory()) await visit(rel)
      else if (e.isFile()) {
        const ext = extOf(e.name)
        if (VIDEO_EXTS.has(ext)) {
          const st = await stat(join(root, rel))
          videos.push({ relPath: rel, size: st.size, mtimeMs: Math.trunc(st.mtimeMs) })
        } else if (SUB_EXTS.has(ext)) subs.push(rel)
      }
    }
  }
  await visit('')
  return { videos, subs }
}
```

- [ ] **Step 4: Implementar `src/main/scanner/scan.ts`**

```ts
import { join } from 'node:path'
import type { ProbeResult, ScanProgress, ScanSummary } from '../../shared/types'
import type { Db } from '../db/database'
import { tx } from '../db/database'
import * as repo from '../db/repo'
import { parseVideoPath, extOf } from '../parser/video'
import { titleOf, itemsOf, episodeCodesOf } from '../parser/keys'
import { parseSubtitlePath, matchSubtitles } from '../parser/subtitle'
import { walkLibrary } from './walk'

export interface ScanDeps {
  db: Db
  probe: (absPath: string) => Promise<ProbeResult>
  isOnline: () => Promise<boolean>
  onProgress?: (p: ScanProgress) => void
  concurrency?: number
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!)
  })
  await Promise.all(workers)
}

const aborted = (libraryId: string): ScanSummary => ({
  libraryId, aborted: true, videos: 0, probed: 0, series: 0, movies: 0, episodes: 0, subtitles: 0, unmatched: 0
})

/**
 * Lê a biblioteca, roda ffprobe só no que é novo ou mudou e grava tudo numa transação.
 * Se o disco sumir no meio, aborta sem gravar: nada é marcado como sumido por engano.
 */
export async function scanLibrary(lib: { id: string; rootPath: string }, deps: ScanDeps): Promise<ScanSummary> {
  const { db } = deps
  let walked: Awaited<ReturnType<typeof walkLibrary>>
  try {
    walked = await walkLibrary(lib.rootPath)
  } catch {
    return aborted(lib.id)
  }

  const existing = new Map(repo.listLibraryFiles(db, lib.id).map((f) => [`${f.relPath}|${f.itemKey}`, f]))
  const parsed = walked.videos.map((v) => ({ ...v, parsed: parseVideoPath(v.relPath) }))
  const recognized = parsed.filter((v) => v.parsed !== null)
  const unmatchedVideos = parsed.filter((v) => v.parsed === null).map((v) => ({ relPath: v.relPath, reason: 'nome não reconhecido' }))

  // undefined = reaproveitar leitura anterior; null = ffprobe falhou
  const probes = new Map<string, ProbeResult | null | undefined>()
  let done = 0
  await pool(recognized, deps.concurrency ?? 4, async (v) => {
    const firstKey = itemsOf(v.parsed!)[0]!.key
    const prev = existing.get(`${v.relPath}|${firstKey}`)
    if (prev && prev.size === v.size && prev.mtimeMs === v.mtimeMs && prev.probedAt) probes.set(v.relPath, undefined)
    else {
      try {
        probes.set(v.relPath, await deps.probe(join(lib.rootPath, v.relPath)))
      } catch {
        probes.set(v.relPath, null)
      }
    }
    done++
    deps.onProgress?.({ libraryId: lib.id, done, total: recognized.length, current: v.relPath })
  })

  if (!(await deps.isOnline())) return aborted(lib.id)

  const subs = matchSubtitles(
    recognized.map((v) => ({ relPath: v.relPath, episodeCodes: episodeCodesOf(v.parsed!) })),
    walked.subs.map(parseSubtitlePath)
  )

  tx(db, () => {
    const seen = new Set<number>()
    for (const v of recognized) {
      const p = v.parsed!
      const titleId = repo.upsertTitle(db, titleOf(p))
      const probe = probes.get(v.relPath)
      for (const item of itemsOf(p)) {
        repo.upsertItem(db, { ...item, titleId })
        const fileId = repo.upsertFile(db, { itemKey: item.key, libraryId: lib.id, relPath: v.relPath, size: v.size, mtimeMs: v.mtimeMs, probe })
        seen.add(fileId)
        if (probe !== undefined) repo.replaceEmbeddedTracks(db, fileId, probe?.tracks ?? [])
        repo.replaceExternalSubs(
          db,
          fileId,
          (subs.matches.get(v.relPath) ?? []).map((s) => ({ relPath: s.relPath, lang: s.lang, forced: s.forced, sdh: s.sdh, codec: extOf(s.relPath).slice(1) }))
        )
      }
    }
    repo.markMissing(db, lib.id, seen)
    repo.replaceUnmatched(db, lib.id, [
      ...unmatchedVideos,
      ...subs.unmatched.map((s) => ({ relPath: s.relPath, reason: 'legenda sem vídeo correspondente' }))
    ])
    repo.setLastScan(db, lib.id)
  })

  const probed = [...probes.values()].filter((p) => p !== undefined).length
  return { libraryId: lib.id, aborted: false, videos: walked.videos.length, probed, ...repo.librarySummary(db, lib.id) }
}
```

- [ ] **Step 5: Rodar os testes**

Run: `npx vitest run tests/scanner`
Expected: PASS. Observação: `videos: 4` conta os 4 vídeos não ignorados (2 episódios, 1 filme, `notas.mkv`); o `sample` e o `Extras` não entram.

- [ ] **Step 6: Commit**

```bash
git add src/main/scanner tests/scanner/scan.test.ts
git commit -m "feat(scanner): varredura incremental segura contra disco removido"
```

---

### Task 8: Processo principal, IPC e preload

**Files:**
- Create: `src/main/paths.ts`, `src/main/ipc.ts`
- Modify: `src/main/index.ts` (substituir o provisório), `src/preload/index.ts` (substituir o provisório)

**Interfaces:**
- Consumes: tudo das Tasks 2 a 7; `BrammApi` (Task 2).
- Produces: canais IPC `libraries:list`, `libraries:add`, `libraries:rescan`, `catalog:get`, `title:get` (invoke) e `libraries:status`, `scan:progress`, `scan:done` (eventos); `window.api: BrammApi` no renderer.

- [ ] **Step 1: Criar `src/main/paths.ts`**

```ts
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function dbPath(): string {
  return join(app.getPath('userData'), 'brammp4.db')
}

/** Binário embutido no instalador; em desenvolvimento usa vendor/bin ou o PATH. */
export function binPath(exe: string): string {
  const p = app.isPackaged ? join(process.resourcesPath, 'bin', exe) : join(app.getAppPath(), 'vendor', 'bin', exe)
  return existsSync(p) ? p : exe.replace(/\.exe$/i, '')
}
```

- [ ] **Step 2: Criar `src/main/ipc.ts`**

```ts
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'node:path'
import type { ScanSummary } from '../shared/types'
import type { Db } from './db/database'
import * as repo from './db/repo'
import { readMarker, writeMarker } from './libraries/marker'

export interface IpcContext {
  db: Db
  window: () => BrowserWindow | null
  scan: (libraryId: string) => Promise<ScanSummary>
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle('libraries:list', () => repo.listLibraries(ctx.db))

  ipcMain.handle('libraries:add', async (_e, label: string) => {
    const win = ctx.window()
    const opts = { title: 'Escolha a pasta do catálogo', properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const dir = r.filePaths[0]
    if (r.canceled || !dir) return null
    const name = label.trim() || basename(dir)
    const marker = (await readMarker(dir)) ?? (await writeMarker(dir, name))
    repo.upsertLibrary(ctx.db, { id: marker.id, label: name, rootPath: dir })
    void ctx.scan(marker.id)
    return repo.listLibraries(ctx.db).find((l) => l.id === marker.id) ?? null
  })

  ipcMain.handle('libraries:rescan', (_e, id: string) => ctx.scan(id))
  ipcMain.handle('catalog:get', () => repo.getCatalog(ctx.db))
  ipcMain.handle('title:get', (_e, id: number) => repo.getTitleDetail(ctx.db, id))
}
```

- [ ] **Step 3: Substituir `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ScanSummary } from '../shared/types'
import { openDatabase } from './db/database'
import * as repo from './db/repo'
import { registerIpc } from './ipc'
import { LibraryMonitor } from './libraries/monitor'
import { readMarker } from './libraries/marker'
import { resolveLibrary } from './libraries/resolve'
import { binPath, dbPath } from './paths'
import { probeFile } from './scanner/probe'
import { scanLibrary } from './scanner/scan'

let win: BrowserWindow | null = null

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.once('ready-to-show', () => win?.maximize())
  win.once('ready-to-show', () => win?.show())
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

app.whenReady().then(() => {
  const db = openDatabase(dbPath())
  // ao abrir, tudo começa offline: o primeiro tick do monitor dispara a varredura do que estiver conectado
  repo.setAllLibrariesOffline(db)

  const running = new Map<string, Promise<ScanSummary>>()
  const scan = (id: string): Promise<ScanSummary> => {
    const current = running.get(id)
    if (current) return current
    const lib = repo.listLibraries(db).find((l) => l.id === id)
    if (!lib) return Promise.reject(new Error('biblioteca desconhecida'))
    const ffprobe = binPath('ffprobe.exe')
    const job = scanLibrary(lib, {
      db,
      probe: (abs) => probeFile(ffprobe, abs),
      isOnline: async () => (await readMarker(lib.rootPath))?.id === id,
      onProgress: (p) => send('scan:progress', p)
    })
      .then((s) => {
        send('scan:done', s)
        return s
      })
      .finally(() => running.delete(id))
    running.set(id, job)
    return job
  }

  registerIpc({ db, window: () => win, scan })

  const monitor = new LibraryMonitor({
    intervalMs: 3000,
    list: () => repo.listLibraries(db),
    resolve: (lib) => resolveLibrary(lib),
    onChange: (id, r) => {
      if (r.status === 'online') repo.setLibraryStatus(db, id, 'online', r.rootPath)
      else repo.setLibraryStatus(db, id, 'offline')
      const view = repo.listLibraries(db).find((l) => l.id === id)
      if (view) send('libraries:status', view)
      if (r.status === 'online') void scan(id)
    }
  })
  monitor.start()
  app.on('before-quit', () => monitor.stop())

  createWindow()
})

app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 4: Substituir `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { BrammApi } from '../shared/types'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: BrammApi = {
  listLibraries: () => ipcRenderer.invoke('libraries:list'),
  addLibrary: (label) => ipcRenderer.invoke('libraries:add', label),
  rescanLibrary: (id) => ipcRenderer.invoke('libraries:rescan', id),
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  getTitle: (id) => ipcRenderer.invoke('title:get', id),
  onLibraryStatus: (cb) => on('libraries:status', cb),
  onScanProgress: (cb) => on('scan:progress', cb),
  onScanDone: (cb) => on('scan:done', cb)
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 5: Verificar tipos, testes e build**

Run: `npm run typecheck && npm test && npm run build`
Expected: sem erros de tipo; todos os testes PASS; build gera `out/`.

- [ ] **Step 6: Commit**

```bash
git add src/main src/preload
git commit -m "feat(main): IPC, monitor de bibliotecas e varredura ligada à janela"
```

---

### Task 9: Interface: Bibliotecas, Início e Título

**Files:**
- Create: `src/renderer/src/env.d.ts`, `src/renderer/src/format.ts`, `src/renderer/src/styles.css`, `src/renderer/src/App.tsx`, `src/renderer/src/pages/Libraries.tsx`, `src/renderer/src/pages/Home.tsx`, `src/renderer/src/pages/TitlePage.tsx`, `src/renderer/src/components/TitleCardView.tsx`
- Modify: `src/renderer/src/main.tsx`
- Test: `tests/renderer/format.test.ts`

**Interfaces:**
- Consumes: `window.api: BrammApi` e tipos de `src/shared/types.ts`.
- Produces: `resolutionLabel(height?: number): string | undefined`, `codecLabel(codec?: string): string | undefined`, `itemLabel(season: number | null, episode: number | null): string`, `seasonsOf(items: ItemView[]): number[]`.

- [ ] **Step 1: Escrever o teste dos formatadores**

`tests/renderer/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolutionLabel, codecLabel, itemLabel, seasonsOf } from '../../src/renderer/src/format'

describe('format', () => {
  it('resolução', () => {
    expect(resolutionLabel(2160)).toBe('4K')
    expect(resolutionLabel(1080)).toBe('1080p')
    expect(resolutionLabel(800)).toBe('720p')
    expect(resolutionLabel(480)).toBe('480p')
    expect(resolutionLabel(undefined)).toBeUndefined()
  })
  it('codec', () => {
    expect(codecLabel('hevc')).toBe('x265')
    expect(codecLabel('h264')).toBe('x264')
    expect(codecLabel('av1')).toBe('AV1')
  })
  it('rótulo S01E03', () => {
    expect(itemLabel(1, 3)).toBe('S01E03')
    expect(itemLabel(null, null)).toBe('Filme')
  })
  it('temporadas distintas e ordenadas', () => {
    const it = (s: number | null) => ({ key: String(s), season: s, episode: 1, files: [] })
    expect(seasonsOf([it(2), it(1), it(2)])).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Criar `src/renderer/src/format.ts` e `env.d.ts`**

`format.ts`:
```ts
import type { ItemView } from '../../shared/types'

export function resolutionLabel(height?: number): string | undefined {
  if (!height) return undefined
  if (height >= 2000) return '4K'
  if (height >= 1000) return '1080p'
  if (height >= 700) return '720p'
  if (height >= 560) return '576p'
  return `${height}p`
}

export function codecLabel(codec?: string): string | undefined {
  if (!codec) return undefined
  const map: Record<string, string> = { hevc: 'x265', h264: 'x264', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4' }
  return map[codec] ?? codec.toUpperCase()
}

const pad = (n: number) => String(n).padStart(2, '0')

export function itemLabel(season: number | null, episode: number | null): string {
  return season === null || episode === null ? 'Filme' : `S${pad(season)}E${pad(episode)}`
}

export function seasonsOf(items: ItemView[]): number[] {
  return [...new Set(items.map((i) => i.season).filter((s): s is number => s !== null))].sort((a, b) => a - b)
}
```

`env.d.ts`:
```ts
import type { BrammApi } from '../../shared/types'

declare global {
  interface Window {
    api: BrammApi
  }
}
```

- [ ] **Step 4: Rodar o teste**

Run: `npx vitest run tests/renderer`
Expected: PASS.

- [ ] **Step 5: Criar `styles.css`**

```css
:root {
  --bg: #141414; --panel: #1f1f1f; --text: #e5e5e5; --muted: #8c8c8c;
  --accent: #e50914; --ok: #46d369; --off: #555; font-family: system-ui, 'Segoe UI', sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
button { font: inherit; cursor: pointer; border: 0; border-radius: 4px; padding: 8px 14px; background: #333; color: var(--text); }
button.primary { background: var(--accent); color: #fff; }
button:disabled { opacity: .5; cursor: default; }
input { font: inherit; padding: 8px 10px; border-radius: 4px; border: 1px solid #444; background: #000; color: var(--text); }
header.top { display: flex; align-items: center; gap: 16px; padding: 16px 48px; }
header.top .logo { color: var(--accent); font-weight: 800; font-size: 26px; letter-spacing: 1px; cursor: pointer; }
header.top .spacer { flex: 1; }
main { padding: 0 48px 48px; }
.banner { background: #2a2a2a; border-left: 4px solid #e5a00d; padding: 10px 14px; margin: 0 0 16px; }
.row h2 { font-size: 20px; margin: 24px 0 10px; }
.cards { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 8px; }
.card { flex: 0 0 180px; cursor: pointer; }
.card .poster { height: 260px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
  font-size: 44px; font-weight: 800; color: rgba(255,255,255,.85); }
.card .name { margin-top: 6px; font-size: 14px; }
.card .meta { font-size: 12px; color: var(--muted); }
.card.unavailable { opacity: .45; filter: grayscale(1); }
.title-head h1 { margin: 8px 0 4px; font-size: 36px; }
.seasons { display: flex; gap: 8px; margin: 16px 0; }
.seasons button.active { background: var(--text); color: #000; }
.episode { display: flex; align-items: center; gap: 14px; padding: 14px; border-bottom: 1px solid #2a2a2a; }
.episode .code { font-weight: 700; width: 80px; }
.episode .info { flex: 1; }
.episode.unavailable { opacity: .45; }
.badge { display: inline-block; font-size: 11px; border: 1px solid #555; border-radius: 3px; padding: 1px 5px; margin-right: 6px; color: var(--muted); }
.lib { background: var(--panel); padding: 14px 16px; border-radius: 6px; margin-bottom: 10px; display: flex; gap: 14px; align-items: center; }
.lib .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--off); }
.lib .dot.online { background: var(--ok); }
.lib .body { flex: 1; }
.lib .path { font-size: 12px; color: var(--muted); }
.bar { height: 6px; background: #444; border-radius: 3px; overflow: hidden; margin-top: 6px; }
.bar > div { height: 100%; background: var(--accent); }
.summary { font-size: 13px; color: var(--muted); margin-top: 6px; }
.add { display: flex; gap: 8px; margin: 20px 0; }
.error { color: #ff6b6b; }
```

- [ ] **Step 6: Criar `components/TitleCardView.tsx`**

```tsx
import type { TitleCard } from '../../../shared/types'

function hue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]!.toUpperCase()).join('')
}

export function TitleCardView({ card, onOpen }: { card: TitleCard; onOpen: (id: number) => void }) {
  const h = hue(card.name)
  return (
    <div className={`card${card.available ? '' : ' unavailable'}`} onClick={() => onOpen(card.id)} title={card.name}>
      <div className="poster" style={{ background: `linear-gradient(160deg, hsl(${h} 45% 35%), hsl(${(h + 40) % 360} 50% 15%))` }}>
        {initials(card.name)}
      </div>
      <div className="name">{card.name}</div>
      <div className="meta">
        {card.year ?? ''}
        {!card.available && card.offlineLabels.length > 0 && ` · conecte ${card.offlineLabels.join(' ou ')}`}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Criar `pages/Home.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { Catalog, LibraryView, TitleCard } from '../../../shared/types'
import { TitleCardView } from '../components/TitleCardView'

function Row({ title, cards, onOpen }: { title: string; cards: TitleCard[]; onOpen: (id: number) => void }) {
  if (cards.length === 0) return null
  return (
    <section className="row">
      <h2>{title}</h2>
      <div className="cards">{cards.map((c) => <TitleCardView key={c.id} card={c} onOpen={onOpen} />)}</div>
    </section>
  )
}

export function Home({ refresh, libraries, onOpen }: { refresh: number; libraries: LibraryView[]; onOpen: (id: number) => void }) {
  const [catalog, setCatalog] = useState<Catalog>({ series: [], movies: [] })
  useEffect(() => {
    void window.api.getCatalog().then(setCatalog)
  }, [refresh])
  const offline = libraries.filter((l) => l.status === 'offline')
  const empty = catalog.series.length === 0 && catalog.movies.length === 0
  return (
    <main>
      {offline.length > 0 && <div className="banner">Desconectado: {offline.map((l) => l.label).join(', ')}. Os títulos continuam aqui, acinzentados.</div>}
      {empty && <p>Nenhum título ainda. Se a varredura estiver em andamento, aguarde; senão, confira a pasta em Bibliotecas.</p>}
      <Row title="Séries" cards={catalog.series} onOpen={onOpen} />
      <Row title="Filmes" cards={catalog.movies} onOpen={onOpen} />
    </main>
  )
}
```

- [ ] **Step 8: Criar `pages/TitlePage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { FileView, TitleDetail } from '../../../shared/types'
import { codecLabel, itemLabel, resolutionLabel, seasonsOf } from '../format'

function FileBadges({ f }: { f: FileView }) {
  return (
    <>
      {resolutionLabel(f.height) && <span className="badge">{resolutionLabel(f.height)}</span>}
      {codecLabel(f.videoCodec) && <span className="badge">{codecLabel(f.videoCodec)}</span>}
      <span className="badge">{f.audioCount} áudio{f.audioCount === 1 ? '' : 's'}</span>
      <span className="badge">{f.subCount} legenda{f.subCount === 1 ? '' : 's'}</span>
      <span className="badge">{f.libraryLabel}</span>
    </>
  )
}

export function TitlePage({ id, refresh, onBack }: { id: number; refresh: number; onBack: () => void }) {
  const [detail, setDetail] = useState<TitleDetail | null>(null)
  const [season, setSeason] = useState<number | null>(null)
  useEffect(() => {
    void window.api.getTitle(id).then((d) => {
      setDetail(d)
      if (d && season === null) setSeason(seasonsOf(d.items)[0] ?? null)
    })
  }, [id, refresh])
  if (!detail) return <main><button onClick={onBack}>Voltar</button></main>
  const items = detail.kind === 'series' ? detail.items.filter((i) => i.season === season) : detail.items
  return (
    <main>
      <button onClick={onBack}>← Voltar</button>
      <div className="title-head">
        <h1>{detail.name}</h1>
        <div className="meta">{detail.year ?? ''}</div>
      </div>
      {detail.kind === 'series' && (
        <div className="seasons">
          {seasonsOf(detail.items).map((s) => (
            <button key={s} className={s === season ? 'active' : ''} onClick={() => setSeason(s)}>Temporada {s}</button>
          ))}
        </div>
      )}
      {items.map((item) => {
        const best = item.files.find((f) => f.available) ?? item.files[0]!
        const offline = !item.files.some((f) => f.available)
        return (
          <div key={item.key} className={`episode${offline ? ' unavailable' : ''}`}>
            <div className="code">{itemLabel(item.season, item.episode)}</div>
            <div className="info">
              <div>{item.episode !== null ? `Episódio ${item.episode}` : detail.name}</div>
              <div>
                <FileBadges f={best} />
                {item.files.length > 1 && <span className="badge">{item.files.length} versões</span>}
                {offline && <span className="badge">conecte {best.libraryLabel}</span>}
              </div>
            </div>
          </div>
        )
      })}
    </main>
  )
}
```

- [ ] **Step 9: Criar `pages/Libraries.tsx`**

```tsx
import { useState } from 'react'
import type { LibraryView, ScanProgress, ScanSummary } from '../../../shared/types'

interface Props {
  libraries: LibraryView[]
  progress: Record<string, ScanProgress>
  summaries: Record<string, ScanSummary>
  onChanged: () => void
}

function SummaryLine({ s }: { s: ScanSummary }) {
  if (s.aborted) return <div className="summary error">Varredura interrompida: o disco foi desconectado.</div>
  return (
    <div className="summary">
      {s.series} séries · {s.episodes} episódios · {s.movies} filmes · {s.subtitles} legendas
      {s.unmatched > 0 && ` · ${s.unmatched} não identificados`}
    </div>
  )
}

export function Libraries({ libraries, progress, summaries, onChanged }: Props) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const lib = await window.api.addLibrary(label)
      if (lib) setLabel('')
      onChanged()
    } catch (e) {
      setError(`Não foi possível usar essa pasta: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>Bibliotecas</h1>
      <p>Escolha a pasta do catálogo dentro do disco removível. O app lembra o endereço e confere a conexão sozinho.</p>
      <div className="add">
        <input placeholder="Apelido (ex.: HD Séries)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="primary" disabled={busy} onClick={add}>Escolher pasta…</button>
      </div>
      {error && <p className="error">{error}</p>}
      {libraries.map((l) => {
        const p = progress[l.id]
        const s = summaries[l.id]
        const scanning = p && p.done < p.total
        return (
          <div key={l.id} className="lib">
            <div className={`dot ${l.status}`} title={l.status === 'online' ? 'conectado' : 'desconectado'} />
            <div className="body">
              <div>{l.label} {l.status === 'offline' && <span className="badge">desconectado</span>}</div>
              <div className="path">{l.rootPath}</div>
              {scanning && (
                <>
                  <div className="summary">Lendo {p.done} de {p.total} arquivos…</div>
                  <div className="bar"><div style={{ width: `${Math.round((p.done / Math.max(p.total, 1)) * 100)}%` }} /></div>
                </>
              )}
              {!scanning && s && <SummaryLine s={s} />}
            </div>
            <button disabled={l.status === 'offline'} onClick={() => void window.api.rescanLibrary(l.id)}>Revarrer</button>
          </div>
        )
      })}
    </main>
  )
}
```

- [ ] **Step 10: Criar `App.tsx` e substituir `main.tsx`**

`App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { LibraryView, ScanProgress, ScanSummary } from '../../shared/types'
import { Home } from './pages/Home'
import { Libraries } from './pages/Libraries'
import { TitlePage } from './pages/TitlePage'

type View = { name: 'home' } | { name: 'title'; id: number } | { name: 'libraries' }

export function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const [libraries, setLibraries] = useState<LibraryView[]>([])
  const [progress, setProgress] = useState<Record<string, ScanProgress>>({})
  const [summaries, setSummaries] = useState<Record<string, ScanSummary>>({})
  const [refresh, setRefresh] = useState(0)

  const reloadLibraries = () => void window.api.listLibraries().then(setLibraries)

  useEffect(() => {
    void window.api.listLibraries().then((libs) => {
      setLibraries(libs)
      if (libs.length === 0) setView({ name: 'libraries' })
    })
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
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return (
    <>
      <header className="top">
        <span className="logo" onClick={() => setView({ name: 'home' })}>brammp4</span>
        <span className="spacer" />
        <button onClick={() => setView({ name: 'libraries' })}>Bibliotecas</button>
      </header>
      {view.name === 'home' && <Home refresh={refresh} libraries={libraries} onOpen={(id) => setView({ name: 'title', id })} />}
      {view.name === 'title' && <TitlePage id={view.id} refresh={refresh} onBack={() => setView({ name: 'home' })} />}
      {view.name === 'libraries' && (
        <Libraries libraries={libraries} progress={progress} summaries={summaries} onChanged={reloadLibraries} />
      )}
    </>
  )
}
```

`main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 11: Verificação manual com uma pasta de teste**

Criar a pasta de teste:
```powershell
$r = "$env:TEMP\brammp4-demo"
New-Item -ItemType Directory -Force "$r\Dark\Season 1","$r\Filmes" | Out-Null
Copy-Item tests\fixtures\tiny.mkv "$r\Dark\Season 1\Dark.S01E01.mkv"
Copy-Item tests\fixtures\tiny.mkv "$r\Dark\Season 1\Dark.S01E02.mkv"
Set-Content "$r\Dark\Season 1\Dark.S01E01.pt-BR.srt" "1`r`n00:00:00,000 --> 00:00:01,000`r`nola"
Copy-Item tests\fixtures\tiny.mkv "$r\Filmes\Interestelar (2014).mkv"
```
Run: `npm run typecheck && npm run dev`
Checklist:
1. Primeira abertura vai direto para Bibliotecas.
2. Apelido "Demo", "Escolher pasta…", selecionar `%TEMP%\brammp4-demo`: aparece "Lendo X de 3" e depois "1 séries · 2 episódios · 1 filmes · 1 legendas".
3. Início mostra Dark em Séries e Interestelar (2014) em Filmes.
4. Dark mostra Temporada 1 com S01E01 (240p, 1 áudio, 2 legendas) e S01E02 (1 legenda).
5. Renomear `%TEMP%\brammp4-demo` para `brammp4-demo-x`: em até 3 s aparece o banner de desconectado e os cards ficam cinza. Renomear de volta: voltam ao normal.

- [ ] **Step 12: Commit**

```bash
git add src/renderer tests/renderer
git commit -m "feat(ui): telas de Bibliotecas, Início e Título"
```

---

### Task 10: Binários, instalador e release no GitHub

**Files:**
- Create: `scripts/binaries.json`, `scripts/fetch-binaries.mjs`, `scripts/install.ps1`, `electron-builder.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm run build`; `binPath` (Task 8) espera `resources/bin/ffprobe.exe` no app instalado.
- Produces: `npm run binaries [-- --lock]`, `npm run dist` gera `dist/brammp4-Setup-0.1.0.exe`; tag `v0.1.0` publica a release.

- [ ] **Step 1: Criar o manifesto `scripts/binaries.json`**

```json
{
  "ffmpeg": {
    "url": "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
    "sha256": "",
    "files": ["ffprobe.exe"],
    "license": "GPL-3.0 (build gyan.dev, https://www.gyan.dev/ffmpeg/builds/)"
  }
}
```

- [ ] **Step 2: Criar `scripts/fetch-binaries.mjs`**

```js
#!/usr/bin/env node
// Baixa os binários fixados em scripts/binaries.json para vendor/bin e confere o SHA-256.
// Uso: node scripts/fetch-binaries.mjs          (falha se o hash não conferir)
//      node scripts/fetch-binaries.mjs --lock   (grava o hash de entradas com sha256 vazio)
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'scripts', 'binaries.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const lock = process.argv.includes('--lock')
const vendor = join(root, 'vendor')
const bin = join(vendor, 'bin')
// tar do Windows (bsdtar) abre zip e 7z; o tar do Git Bash não abre zip.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
await mkdir(bin, { recursive: true })

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

let changed = false
for (const [name, entry] of Object.entries(manifest)) {
  const stamp = join(vendor, `${name}.sha256`)
  const present = entry.files.every((f) => existsSync(join(bin, f)))
  if (entry.sha256 && present && existsSync(stamp) && (await readFile(stamp, 'utf8')).trim() === entry.sha256) {
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
  const tmp = join(vendor, `${name}-tmp`)
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  const archive = join(tmp, `pacote${entry.url.slice(entry.url.lastIndexOf('.'))}`)
  await writeFile(archive, buf)
  execFileSync(tar, ['-xf', archive, '-C', tmp], { stdio: 'inherit' })
  for (const f of entry.files) {
    const found = await findFile(tmp, f)
    if (!found) throw new Error(`${name}: ${f} não encontrado no pacote`)
    await copyFile(found, join(bin, f))
  }
  await rm(tmp, { recursive: true, force: true })
  await writeFile(stamp, entry.sha256)
  console.log(`${name}: ok (${entry.files.join(', ')})`)
}
if (changed) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
```

- [ ] **Step 3: Fixar o hash e conferir**

Run: `node scripts/fetch-binaries.mjs --lock`
Expected: `ffmpeg: ok (ffprobe.exe)`, `scripts/binaries.json` agora com `sha256` preenchido, `vendor/bin/ffprobe.exe` presente.

Run: `node scripts/fetch-binaries.mjs`
Expected: `ffmpeg: já presente`.

Run: `npm test`
Expected: PASS, agora usando `vendor/bin/ffprobe.exe` nos testes reais.

- [ ] **Step 4: Criar `electron-builder.yml`**

```yaml
appId: io.github.lukdoto.brammp4
productName: brammp4
directories:
  output: dist
  buildResources: build
files:
  - out/**
  - package.json
extraResources:
  - from: vendor/bin
    to: bin
asar: true
win:
  target:
    - target: nsis
      arch: [x64]
  artifactName: brammp4-Setup-${version}.${ext}
nsis:
  oneClick: true
  perMachine: false
  createDesktopShortcut: always
  createStartMenuShortcut: true
  deleteAppDataOnUninstall: false
publish: null
```

- [ ] **Step 5: Gerar o instalador localmente e testar**

Run: `npm run dist`
Expected: `dist/brammp4-Setup-0.1.0.exe`.

Run (PowerShell): `Start-Process .\dist\brammp4-Setup-0.1.0.exe -ArgumentList '/S' -Wait`
Checklist: atalho "brammp4" no Menu Iniciar e na área de trabalho; o app abre em Bibliotecas; repetir os itens 2 a 4 da Task 9 com `%TEMP%\brammp4-demo` (prova que o ffprobe embutido funciona: as badges de resolução aparecem).

- [ ] **Step 6: Criar `scripts/install.ps1`**

```powershell
# Instala ou atualiza o brammp4 a partir da última release do GitHub.
# Uso: irm https://raw.githubusercontent.com/lukdoto/brammp4/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/lukdoto/brammp4/releases/latest' -Headers @{ 'User-Agent' = 'brammp4-install' }
$asset = $release.assets | Where-Object { $_.name -like 'brammp4-Setup-*.exe' } | Select-Object -First 1
if (-not $asset) { throw "Release $($release.tag_name) sem instalador." }
$file = Join-Path $env:TEMP $asset.name
Write-Host "Baixando $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -UseBasicParsing
Write-Host 'Instalando...'
Start-Process -FilePath $file -ArgumentList '/S' -Wait
Remove-Item $file -Force
Write-Host "brammp4 $($release.tag_name) instalado. Abra pelo atalho 'brammp4' no Menu Iniciar."
```

- [ ] **Step 7: Criar os workflows**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run binaries
      - run: npm run typecheck
      - run: npm test
```

`.github/workflows/release.yml`:
```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - name: Conferir versão da tag
        shell: bash
        run: |
          v="v$(node -p "require('./package.json').version")"
          if [ "$v" != "$GITHUB_REF_NAME" ]; then echo "tag $GITHUB_REF_NAME diferente de package.json $v"; exit 1; fi
      - run: npm ci
      - run: npm run binaries
      - run: npm run typecheck
      - run: npm test
      - run: npm run dist
      - name: Publicar release
        shell: bash
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" dist/brammp4-Setup-*.exe --title "brammp4 $GITHUB_REF_NAME" --generate-notes
```

- [ ] **Step 8: Atualizar a seção de instalação do `README.md`**

Substituir o bloco "## Instalação (Windows)" inteiro por:
````markdown
## Instalação (Windows)

Um comando no PowerShell (não precisa de Node, git nem login no GitHub):

```powershell
irm https://raw.githubusercontent.com/lukdoto/brammp4/main/scripts/install.ps1 | iex
```

O script baixa o instalador da última release (que já contém o ffprobe) e instala em modo silencioso para o usuário atual.
Na primeira abertura, o app pede a pasta do catálogo no disco removível. Para atualizar, rode o mesmo comando.
Os dados (banco, progresso) ficam em `%APPDATA%\brammp4` e não são apagados na atualização.

## Desenvolvimento

```powershell
npm ci
npm run binaries   # baixa ffprobe para vendor/bin
npm run dev
npm test
```
````

- [ ] **Step 9: Commit**

```bash
git add scripts electron-builder.yml .github README.md
git commit -m "build: binários com hash, instalador NSIS, CI e release no GitHub"
```

- [ ] **Step 10: Push, PR e CI**

```bash
git push -u origin feat/m1-catalogo-local
gh pr create --base main --title "M1: catálogo local instalável" --body-file -
```
Corpo do PR: resumo das tasks, checklist manual da Task 9, e o rodapé de atribuição. Esperar o CI do PR passar.

- [ ] **Step 11: Release v0.1.0 (depois do merge do PR)**

```bash
git checkout main && git pull
git tag v0.1.0
git push origin v0.1.0
```
Expected: workflow "Release" verde e release `v0.1.0` com `brammp4-Setup-0.1.0.exe` anexado. Verificar em outra pasta: `irm https://raw.githubusercontent.com/lukdoto/brammp4/main/scripts/install.ps1 | iex` instala sem erros.
