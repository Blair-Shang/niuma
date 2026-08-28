#Requires -Version 5.1
<#
.SYNOPSIS
  按 cef-pin.txt 下载 CEF Standard Binary 到 third_party/cef/
#>
param(
    [string]$Channel = 'stable',
    [string]$CefPlatform = ''
)

$ErrorActionPreference = 'Stop'

$allowedPlatforms = @('windows64', 'windows32', 'windowsarm64')
if (-not $CefPlatform) {
    $CefPlatform = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'windowsarm64' } else { 'windows64' }
} elseif ($allowedPlatforms -notcontains $CefPlatform) {
    throw "Unsupported CefPlatform: $CefPlatform (allowed: $($allowedPlatforms -join ', '))"
}

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$Dest = Join-Path $Root 'third_party/cef'
$TempDir = Join-Path $Root 'third_party/cef-cache'

if (Test-Path (Join-Path $Dest 'CMakeLists.txt')) {
    Write-Host "CEF already exists at $Dest - delete to re-download" -ForegroundColor Yellow
    exit 0
}

$PinFile = Join-Path $Root 'scripts/shared/setup/cef-pin.txt'
if (-not (Test-Path -LiteralPath $PinFile)) {
    throw "missing CEF pin file: $PinFile"
}
$CefVersion = $null
Get-Content -LiteralPath $PinFile | ForEach-Object {
    if ($_ -match '^cef_version=(.+)$') { $CefVersion = $Matches[1].Trim() }
}
if (-not $CefVersion) {
    throw "cef_version missing in $PinFile"
}

$ArchiveName = "cef_binary_${CefVersion}_${CefPlatform}.tar.bz2"
$Url = "https://cef-builds.spotifycdn.com/$ArchiveName"

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$ArchivePath = Join-Path $TempDir $ArchiveName

function Resolve-SevenZip {
    $cmd = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($candidate in @(
            (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
            (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')
        )) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }
    return $null
}

function Invoke-CefDefenderRelax {
    param(
        [string[]]$Paths,
        [string[]]$Processes
    )
    if (-not $env:CI) { return }
    if (-not (Get-Command Add-MpPreference -ErrorAction SilentlyContinue)) { return }

    foreach ($path in $Paths) {
        if ($path) {
            Add-MpPreference -ExclusionPath $path -ErrorAction SilentlyContinue
        }
    }
    foreach ($proc in $Processes) {
        Add-MpPreference -ExclusionProcess $proc -ErrorAction SilentlyContinue
    }
    # 托管 runner 常开 Tamper Protection，失败则忽略，不作为硬依赖
    if (Get-Command Set-MpPreference -ErrorAction SilentlyContinue) {
        Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction SilentlyContinue
    }
}

function Wait-CefExtractProcess {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][string]$Tool
    )
    $started = Get-Date
    while (-not $Process.WaitForExit(15000)) {
        $sec = [int]((Get-Date) - $started).TotalSeconds
        Write-Host "  still extracting... ${sec}s"
    }
    if ($Process.ExitCode -ne 0) {
        throw "$Tool extract failed with exit code $($Process.ExitCode)"
    }
    Write-Host "Extract finished in $([int]((Get-Date) - $started).TotalSeconds)s ($Tool)"
}

function Invoke-CefTarExtract {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$ExtractDir
    )
    $sizeMb = [math]::Round((Get-Item -LiteralPath $ArchivePath).Length / 1MB, 1)
    $sevenZip = Resolve-SevenZip

    Invoke-CefDefenderRelax -Paths @(
        $ExtractDir
        (Split-Path -Parent $ArchivePath)
        $Dest
        $TempDir
        $env:GITHUB_WORKSPACE
        $env:RUNNER_TEMP
    ) -Processes @('7z.exe', 'tar.exe')

    if ($sevenZip) {
        Write-Host "Extracting ${sizeMb} MB with 7-Zip (piped; no intermediate .tar)."
        # 必须走 cmd 管道：PowerShell 管道会把整段 tar 缓冲进内存
        $z = $sevenZip.Replace('"', '""')
        $archive = $ArchivePath.Replace('"', '""')
        $out = $ExtractDir.Replace('"', '""')
        $line = '"{0}" x "{1}" -so | "{0}" x -aoa -si -ttar "-o{2}"' -f $z, $archive, $out
        $p = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" `
            -ArgumentList @('/C', $line) -NoNewWindow -PassThru
        Wait-CefExtractProcess -Process $p -Tool '7-Zip'
        return
    }

    $tar = (Get-Command tar.exe -ErrorAction Stop).Source
    $mode = if ($ArchivePath -match '\.tar\.xz$') { '-xJf' } else { '-xjf' }
    Write-Host "7-Zip not found; falling back to tar.exe ($mode, ${sizeMb} MB)."
    $p = Start-Process -FilePath $tar -ArgumentList @($mode, $ArchivePath, '-C', $ExtractDir) -NoNewWindow -PassThru
    Wait-CefExtractProcess -Process $p -Tool 'tar.exe'
}

Write-Host "CEF $($CefVersion)"
if (Test-Path $ArchivePath) {
    Write-Host "Reusing cached archive $ArchivePath"
} else {
    Write-Host "Downloading $Url ..."
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    $ok = $false
    foreach ($attempt in 1..3) {
        Write-Host "download attempt $attempt/3"
        if ($curl) {
            & $curl.Source -fL --retry 5 --retry-delay 2 -C - --progress-bar --output $ArchivePath $Url
            if ($LASTEXITCODE -eq 0) { $ok = $true; break }
            Write-Warning "curl.exe failed with exit code $LASTEXITCODE"
        } else {
            try {
                Invoke-WebRequest -Uri $Url -OutFile $ArchivePath -UseBasicParsing
                $ok = $true
                break
            } catch {
                Write-Warning $_
            }
        }
        if ($attempt -lt 3) { Start-Sleep -Seconds (10 * $attempt) }
    }
    if (-not $ok) {
        throw "CEF archive download failed after 3 attempts"
    }
}

$ExtractDir = Join-Path $TempDir 'cef_extract'
if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
Invoke-CefTarExtract -ArchivePath $ArchivePath -ExtractDir $ExtractDir

$Inner = Get-ChildItem -LiteralPath $ExtractDir -Directory | Select-Object -First 1
if (-not $Inner) {
    throw "CEF archive extracted but no inner directory found in $ExtractDir"
}
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
Move-Item -LiteralPath $Inner.FullName -Destination $Dest
Write-Host "CEF installed to $Dest" -ForegroundColor Green
