#Requires -Version 5.1
<#
.SYNOPSIS
  前台启动 platform-core，供 Go 调试；壳层检测到管道已监听后不会重复 spawn。
#>
param(
    [switch]$Delve,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

try { chcp 65001 | Out-Null } catch { }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$PlatformDir = Join-Path $Root 'platform'
$LogRoot = Join-Path $Root 'logs'
$sessionDir = Join-Path $LogRoot ("platform-dev-{0:yyyyMMdd-HHmmss}" -f (Get-Date))

New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null
$env:NIUMMA_LOG_ROOT = $LogRoot
$env:NIUMMA_LOG_DIR = $sessionDir

Write-Host '==> platform-core (foreground)' -ForegroundColor Cyan
Write-Host "    pipe:    \\.\pipe\niuma.platform" -ForegroundColor Gray
Write-Host "    logs:    $sessionDir" -ForegroundColor Gray
Write-Host '    shell:   pnpm dev:hot -SkipServices  (another terminal)' -ForegroundColor Gray
if ($Delve) {
    Write-Host '    debugger: delve (breakpoints enabled)' -ForegroundColor Gray
}

Push-Location $PlatformDir
try {
    if ($Delve) {
        $dlv = Get-Command dlv -ErrorAction SilentlyContinue
        if (-not $dlv) {
            throw 'delve not found. Install: go install github.com/go-delve/delve/cmd/dlv@latest'
        }
        & dlv debug ./cmd/platform-core --headless=false --api-version=2 --listen=127.0.0.1:2345
    } elseif ($SkipBuild) {
        $exe = Join-Path $Root 'services/bin/niuma-platform-core.exe'
        if (-not (Test-Path $exe)) {
            throw "niuma-platform-core.exe not found at $exe — run: pnpm build:services"
        }
        & $exe
    } else {
        & go run ./cmd/platform-core
    }
    if ($LASTEXITCODE -ne 0) {
        throw "platform-core exited with code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}
