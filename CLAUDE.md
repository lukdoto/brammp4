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
