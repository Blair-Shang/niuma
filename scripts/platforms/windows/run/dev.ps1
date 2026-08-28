#Requires -Version 5.1
<#
.SYNOPSIS
  启动真实 CEF 桌面应用（Layer 3 + Layer 4）。
.PARAMETER HotReload
  后台 Vite + CEF 加载 http://localhost:5173，跳过 web 生产构建。
.PARAMETER Configuration
  Release（默认）或 Debug（壳层/Go 保留调试符号，供 VS / delve 附加）。
.PARAMETER SkipServices
  跳过 Go 服务构建与 stage；platform 已用 pnpm dev:platform 前台运行时配合使用。
.PARAMETER SkipShellBuild
  不编译壳层，直接启动已有 niuma.exe。
#>
param(
    [switch]$SkipSetup,
    [switch]$HotReload,
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$SkipServices,
    [switch]$SkipShellBuild
)

$ErrorActionPreference = 'Stop'
try {
    chcp 65001 | Out-Null
} catch {
    # ignore
}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
. (Join-Path $Root 'scripts\shared\lib\matrix.ps1')
$CefRoot = Join-Path $Root 'third_party/cef'
$DevPlatform = 'windows'
$DevArch = Get-MatrixHostArch
$Exe = Resolve-ShellExePath -RepoRoot $Root -Platform $DevPlatform -Arch $DevArch -Configuration $Configuration
$viteProc = $null
$viteProcStartedByUs = $false
$isDebug = $Configuration -eq 'Debug'
$BuildShellScript = Join-Path $Root 'scripts\platforms\windows\build\build-shell.ps1'
$SetupScript = Join-Path $Root 'scripts\platforms\windows\setup\setup-desktop.ps1'

$env:NIUMMA_LOG_ROOT = Join-Path $Root 'logs'

function Write-DevBanner {
    param([string]$Title)
    Write-Host "==> $Title" -ForegroundColor Cyan
}

function Write-DevDebugHints {
    param(
        [string]$ExePath,
        [bool]$Hot,
        [bool]$DebugMode,
        [bool]$ExtPlatform
    )
    if (-not $DebugMode -and -not $ExtPlatform) {
        return
    }
    Write-Host ''
    Write-Host '--- Debug hints ---' -ForegroundColor Yellow
    if ($Hot) {
        Write-Host '  Web:     F12 in CEF, or Chrome -> http://localhost:9222' -ForegroundColor Gray
    }
    Write-Host '  Logs:    logs/<session>/{shell,niuma-platform-core,niuma-ftp-service}.log' -ForegroundColor Gray
    if ($DebugMode) {
        Write-Host "  Shell:   attach VS to PID or open build/shell-$DevPlatform-$DevArch/$Configuration/niuma.vcxproj" -ForegroundColor Gray
        Write-Host '  Go:      pnpm dev:platform / dev:platform:delve (then -SkipServices)' -ForegroundColor Gray
    }
    if ($ExtPlatform) {
        Write-Host '  Platform: external - pipe reuse, no spawn from shell' -ForegroundColor Gray
    }
    Write-Host '  VS Code: Run and Debug -> Platform Core / FTP Service' -ForegroundColor Gray
    Write-Host '-------------------' -ForegroundColor Yellow
    Write-Host ''
}

function Test-ViteDepsReady {
    param([string]$BaseUrl)
    try {
        $null = Invoke-WebRequest -Uri "$BaseUrl/node_modules/.vite/deps/vue.js" -UseBasicParsing -TimeoutSec 3
        $null = Invoke-WebRequest -Uri "$BaseUrl/node_modules/.vite/deps/codemirror.js" -UseBasicParsing -TimeoutSec 3
        $null = Invoke-WebRequest -Uri "$BaseUrl/node_modules/.vite/deps/@codemirror_lang-sql.js" -UseBasicParsing -TimeoutSec 3
        return $true
    } catch {
        return $false
    }
}

function Stop-ListenProcessOnPort {
    param([int]$Port)
    $seen = @{}
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $owningPid = $c.OwningProcess
        if (-not $owningPid -or $owningPid -eq 0 -or $seen.ContainsKey($owningPid)) {
            continue
        }
        $seen[$owningPid] = $true
        Write-Host "==> stopping process on port $Port (PID $owningPid)" -ForegroundColor Yellow
        Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
    }
    if ($seen.Count -gt 0) {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $SkipSetup -and -not (Test-Path (Join-Path $CefRoot 'CMakeLists.txt'))) {
    Write-Host 'CEF missing - running setup:desktop' -ForegroundColor Yellow
    & $SetupScript
}

if ($HotReload) {
    $url = 'http://localhost:5173'
    $ready = $false

    if (Test-ViteDepsReady -BaseUrl $url) {
        Write-DevBanner 'Hot reload: reusing existing Vite on :5173'
        $ready = $true
    } else {
        Stop-ListenProcessOnPort -Port 5173
        Write-DevBanner 'Hot reload: starting Vite (pnpm dev:web)'

        $viteProc = Start-Process -FilePath 'pnpm' -ArgumentList 'dev:web' `
            -WorkingDirectory $Root -PassThru -WindowStyle Hidden
        $viteProcStartedByUs = $true

        foreach ($i in 1..120) {
            if ($viteProc.HasExited) {
                $portHint = ' Port 5173 may still be in use - close other Vite instances.'
                throw "Vite exited early (code $($viteProc.ExitCode)).$portHint Run: pnpm dev:web"
            }
            if (Test-ViteDepsReady -BaseUrl $url) {
                $ready = $true
                break
            }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) {
            Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue
            throw "Vite deps not ready at $url within 120s. Run: pnpm dev:web"
        }
    }

    $env:NIUMMA_DEV_URL = $url
    $env:NIUMMA_PLUGINS_DIR = Join-Path $Root 'plugins'
    Write-Host "    Vite ready: $url" -ForegroundColor Gray
}

if (-not $SkipShellBuild) {
    $runningNiuma = Get-Process -Name 'niuma' -ErrorAction SilentlyContinue
    if ($runningNiuma) {
        Write-Host '==> stopping running niuma.exe (shell rebuild)' -ForegroundColor Yellow
        $runningNiuma | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600
    }

    $buildArgs = @{
        Platform      = $DevPlatform
        Arch          = $DevArch
        Configuration = $Configuration
    }
    if ($HotReload) {
        $buildArgs['SkipWebBuild'] = $true
    }
    if ($SkipServices) {
        $buildArgs['SkipServices'] = $true
    }

    Write-DevBanner "build shell ($Configuration)"
    $builtExe = & $BuildShellScript @buildArgs | Select-Object -Last 1
    if ($builtExe -and (Test-Path $builtExe)) {
        $Exe = $builtExe
    }
} else {
    Write-Host '==> skip shell build (SkipShellBuild)' -ForegroundColor Gray
}

if (-not (Test-Path $Exe)) {
    throw "niuma.exe not found at $Exe"
}

$env:NIUMMA_PLUGINS_DIR = Join-Path $Root 'plugins'

Write-DevBanner "Launch $Exe"
Write-Host "    Configuration: $Configuration" -ForegroundColor Gray

$launchArgs = @()
if ($env:NIUMMA_DEV_URL) {
    Write-Host "    NIUMMA_DEV_URL=$($env:NIUMMA_DEV_URL)" -ForegroundColor Gray
    $launchArgs += "--url=$($env:NIUMMA_DEV_URL)"
}
Write-Host "    NIUMMA_LOG_ROOT=$($env:NIUMMA_LOG_ROOT)" -ForegroundColor Gray
if ($SkipServices) {
    Write-Host '    SkipServices: on (use with pnpm dev:platform)' -ForegroundColor Gray
}

Write-DevDebugHints -ExePath $Exe -Hot $HotReload -DebugMode $isDebug -ExtPlatform:$SkipServices

$proc = Start-Process -FilePath $Exe -ArgumentList $launchArgs `
    -WorkingDirectory (Split-Path $Exe) -PassThru

Start-Sleep -Milliseconds 800
if ($proc.HasExited) {
    $log = Join-Path (Split-Path $Exe) 'debug.log'
    $hint = if (Test-Path $log) { Get-Content $log -Tail 20 -ErrorAction SilentlyContinue } else { @() }
    if ($hint) {
        Write-Host '--- debug.log (tail) ---' -ForegroundColor Yellow
        $hint | ForEach-Object { Write-Host $_ }
    }
    throw "niuma.exe exited immediately (code $($proc.ExitCode))"
}

if ($HotReload) {
    Write-Host 'Hot reload active - edit web/ and save to refresh CEF window' -ForegroundColor Gray
    Write-Host 'Close the NiuMa window to stop' -ForegroundColor Gray
    try {
        Wait-Process -Id $proc.Id
    } finally {
        if ($viteProcStartedByUs -and $viteProc -and -not $viteProc.HasExited) {
            Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item Env:NIUMMA_DEV_URL -ErrorAction SilentlyContinue
        Remove-Item Env:NIUMMA_PLUGINS_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:NIUMMA_LOG_ROOT -ErrorAction SilentlyContinue
    }
} else {
    Write-Host 'Desktop app running - close the NiuMa window to exit' -ForegroundColor Gray
    try {
        Wait-Process -Id $proc.Id
    } finally {
        Remove-Item Env:NIUMMA_DEV_URL -ErrorAction SilentlyContinue
        Remove-Item Env:NIUMMA_PLUGINS_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:NIUMMA_LOG_ROOT -ErrorAction SilentlyContinue
    }
}
