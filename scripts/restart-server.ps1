# 一键重启主服务：先杀光所有 server/index.js 实例再启动，保证端口上跑的是磁盘最新代码。
# 用法：pwsh -File scripts/restart-server.ps1 [端口]
# 端口默认取 config/app.json 的 port，其次 3010。
param(
  [int]$Port = 0
)

$ErrorActionPreference = 'SilentlyContinue'

# 仓库根 = 本脚本所在目录的上一级，避免写死绝对路径
$root = Split-Path -Parent $PSScriptRoot

if (-not $Port) {
  $appJson = Join-Path $root 'config/app.json'
  if (Test-Path $appJson) {
    try { $Port = [int](Get-Content $appJson -Raw | ConvertFrom-Json).port } catch { $Port = 0 }
  }
  if (-not $Port) { $Port = 3010 }
}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server[/\\]index\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 等端口释放
for ($i = 0; $i -lt 20; $i++) {
  $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $busy) { break }
  Start-Sleep -Milliseconds 500
}

Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden

# 等服务就绪（TCP 可连即算起来，HTTP 层由调用方再验）
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  $tcp = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $tcp.BeginConnect('127.0.0.1', $Port, $null, $null)
    if ($iar.AsyncWaitHandle.WaitOne(1500) -and $tcp.Connected) {
      Write-Output "OK: $Port 已用最新代码重启"
      exit 0
    }
  } catch { } finally { $tcp.Close() }
}
Write-Output "WARN: 等待 $Port 就绪超时，请手动检查"
exit 1
