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
