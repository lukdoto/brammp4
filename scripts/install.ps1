# Instala ou atualiza o brammp4 a partir da última release do GitHub.
# Uso: irm https://raw.githubusercontent.com/lukdoto/brammp4/main/scripts/install.ps1 | iex
& {
  $ErrorActionPreference = 'Stop'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  try {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/lukdoto/brammp4/releases/latest' -Headers @{ 'User-Agent' = 'brammp4-install' }
  } catch {
    throw "Não foi possível obter a última versão do brammp4 (ainda não existe release publicada ou sem internet): $($_.Exception.Message)"
  }
  $asset = $release.assets | Where-Object { $_.name -like 'brammp4-Setup-*.exe' } | Select-Object -First 1
  if (-not $asset) { throw "Release $($release.tag_name) sem instalador." }
  $file = Join-Path $env:TEMP $asset.name
  try {
    Write-Host "Baixando $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -UseBasicParsing
    Write-Host 'Instalando...'
    $p = Start-Process -FilePath $file -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "O instalador terminou com erro (código $($p.ExitCode))." }
    Write-Host "brammp4 $($release.tag_name) instalado. Abra pelo atalho 'brammp4' no Menu Iniciar."
  } finally {
    Remove-Item $file -Force -ErrorAction SilentlyContinue
  }
}
