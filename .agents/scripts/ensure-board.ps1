# ensure-board.ps1 — workflow 看板按需手动拉起（默认不自动开启；只起不关：Windows 重启即天然回收，无需 stop/status）
# 行为：探活（端口占用者须响应 /api/board 才认定为看板，否则不动手、报占用者并 exit 1）
#       → 前端或服务端任一代码早于进程 = 旧代码自动 kill 重启 → 全新启动成功后弹浏览器（重启/已运行不弹，SSE 自动重连）
# 用法：powershell -NoProfile -File .agents/scripts/ensure-board.ps1 [-Port 8933] [-NoOpen]
param(
  [int]$Port = 8933,
  [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$agentsDir = Split-Path -Parent $PSScriptRoot
$server = Join-Path $PSScriptRoot 'workflow-board-server.mjs'
$boardHtml = Join-Path $agentsDir 'board\index.html'
$codeFiles = @($boardHtml, $server)   # 前端 + 服务端：任一更新都算「旧代码」
$url = "http://127.0.0.1:$Port"

$proc = $null
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue }

$action = 'fresh start'
if ($proc) {
  # 身份校验：只有能返回带 cards 字段 JSON 的才是看板，否则绝不 kill（可能误杀用户自己的服务）
  $isBoard = $false
  try {
    $body = (Invoke-WebRequest -Uri "$url/api/board" -TimeoutSec 2).Content
    $isBoard = $null -ne ($body | ConvertFrom-Json).PSObject.Properties['cards']
  } catch { $isBoard = $false }
  if (-not $isBoard) {
    Write-Output "board: 端口 $Port 被非看板进程占用（pid $($proc.Id) $($proc.ProcessName)），未做任何改动；请确认该进程后自行处理"
    exit 1
  }
  $newest = ($codeFiles | ForEach-Object { (Get-Item $_).LastWriteTime } | Sort-Object -Descending)[0]
  $stale = $newest -gt $proc.StartTime.AddSeconds(2)
  if (-not $stale) {
    Write-Output "board: already up-to-date at $url (pid $($proc.Id))"
    exit 0
  }
  Stop-Process -Id $proc.Id -Force
  Start-Sleep -Milliseconds 500
  $action = 'restarted (stale code detected)'
}

Start-Process -FilePath 'node' -ArgumentList "`"$server`" --port $Port" -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(8)
do { Start-Sleep -Milliseconds 300; $up = [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) } while (-not $up -and (Get-Date) -lt $deadline)
if (-not $up) { Write-Output "board: FAILED to start on $Port"; exit 1 }
Write-Output "board: $action -> $url"
if (-not $NoOpen -and $action -eq 'fresh start') { Start-Process $url }
