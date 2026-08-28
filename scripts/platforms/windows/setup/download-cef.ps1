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

function Invoke-CefTarExtract {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$ExtractDir
    )
    $tar = (Get-Command tar.exe -ErrorAction Stop).Source
    $mode = if ($ArchivePath -match '\.tar\.xz$') { '-xJf' } else { '-xjf' }
    $sizeMb = [math]::Round((Get-Item -LiteralPath $ArchivePath).Length / 1MB, 1)
    Write-Host "Extracting ${sizeMb} MB ($mode). Windows tar prints no progress; typically 2-10 minutes on CI."

    if ($env:CI -and (Get-Command Add-MpPreference -ErrorAction SilentlyContinue)) {
        Add-MpPreference -ExclusionPath $ExtractDir -ErrorAction SilentlyContinue
        Add-MpPreference -ExclusionPath (Split-Path -Parent $ArchivePath) -ErrorAction SilentlyContinue
    }

    $p = Start-Process -FilePath $tar -ArgumentList @($mode, $ArchivePath, '-C', $ExtractDir) -NoNewWindow -PassThru
    $started = Get-Date
    while (-not $p.WaitForExit(15000)) {
        $sec = [int]((Get-Date) - $started).TotalSeconds
        Write-Host "  still extracting... ${sec}s"
    }
    if ($p.ExitCode -ne 0) {
        throw "tar extract failed with exit code $($p.ExitCode)"
    }
    Write-Host "Extract finished in $([int]((Get-Date) - $started).TotalSeconds)s"
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
