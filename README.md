# brammp4

Reprodutor pessoal estilo streaming para filmes e séries guardados em HDs externos.
Funciona offline, lembra episódio e posição de cada vídeo e faz backup do progresso
no Google Drive (pasta oculta do app).

Status: M1 (catálogo local) em desenvolvimento. A instalação abaixo funciona assim que houver uma release publicada. Especificação em `docs/superpowers/specs/`.

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

Stack prevista: Electron + TypeScript + React, SQLite local, mpv (reprodução, entra no M2), ffprobe (leitura de faixas), TMDB (metadados).

Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.
