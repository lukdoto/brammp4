# brammp4

Reprodutor pessoal estilo streaming para filmes e séries guardados em HDs externos.
Funciona offline, lembra episódio e posição de cada vídeo e faz backup do progresso
no Google Drive (pasta oculta do app).

Status: M1 (catálogo local) e M2 (reprodução e progresso com mpv + uosc) estão implementados. Backup (M4), metadados (M3) e acabamento (M5) vêm depois. A instalação abaixo funciona assim que houver uma release publicada. Especificação em `docs/superpowers/specs/`.

## Instalação (Windows)

Um comando no PowerShell (não precisa de Node, git nem login no GitHub):

```powershell
irm https://raw.githubusercontent.com/lukdoto/brammp4/main/scripts/install.ps1 | iex
```

O script baixa o instalador da última release e instala em modo silencioso para o usuário atual. O instalador já contém ffprobe, mpv e uosc (licenças em `resources/`): o texto da licença GPL do ffmpeg/ffprobe fica em `resources/bin/LICENSE`, o do mpv em `resources/mpv/LICENSE.GPL` e o do uosc em `resources/mpv-config/LICENSE-uosc.txt`.
Origem dos players embutidos: o mpv é o build de CI oficial do projeto mpv (GPL; código-fonte em github.com/mpv-player/mpv (commit 41f6a64, build de 2025-12-21 distribuído como asset da release v0.41.0); o executável se identifica como `v0.41.0-dev-g41f6a6450`); o uosc 5.13.0 vem de github.com/tomasklaen/uosc (LGPL; mesmo repositório e tag); o ffprobe vem do FFmpeg essentials build 9.0.2 do Gyan (GPL; código-fonte na página da mesma release, github.com/GyanD/codexffmpeg).
Na primeira abertura, o app pede a pasta do catálogo no disco removível. Para atualizar, rode o mesmo comando.
Os dados (banco, progresso) ficam em `%APPDATA%\brammp4` e não são apagados na atualização.

## Desenvolvimento

```powershell
npm ci
npm run binaries   # baixa ffprobe, mpv e uosc para vendor/
npm run dev
npm test
```

Stack prevista: Electron + TypeScript + React, SQLite local, mpv + uosc (reprodução), ffprobe (leitura de faixas), TMDB (metadados).

Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.
