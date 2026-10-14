# brammp4

Reprodutor pessoal estilo streaming para filmes e séries guardados em HDs externos.
Funciona offline, lembra episódio e posição de cada vídeo e faz backup do progresso
no Google Drive (pasta oculta do app).

Status: em especificação. Veja `docs/superpowers/specs/`.

## Instalação (Windows)

Ainda não há release publicada. Quando houver, o processo será (para pessoa ou agente seguir sem decisões):

```powershell
gh auth login
gh release download --repo lukdoto/brammp4 --pattern "brammp4-Setup-*.exe" --dir $env:TEMP
Get-ChildItem "$env:TEMP\brammp4-Setup-*.exe" | Sort-Object LastWriteTime | Select-Object -Last 1 | ForEach-Object { & $_.FullName /S }
```

O instalador já contém mpv, ffprobe, ffmpeg e uosc. Na primeira abertura, o app pede a pasta do catálogo no disco removível.

Stack prevista: Electron + TypeScript + React, SQLite local, mpv (reprodução), ffprobe (leitura de faixas), TMDB (metadados).

Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.
