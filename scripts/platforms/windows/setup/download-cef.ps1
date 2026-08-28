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
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string]$Tool
    )
    $started = Get-Date
    try {
        while (-not $Process.WaitForExit(15000)) {
            $sec = [int]((Get-Date) - $started).TotalSeconds
            Write-Host "  still extracting... ${sec}s"
        }
        # 带超时的 WaitForExit 返回后须再调无参重载，ExitCode 才稳定可读
        $Process.WaitForExit()
        $code = $Process.ExitCode
        if ($null -eq $code -or $code -ne 0) {
            throw "$Tool extract failed with exit code $code"
        }
        Write-Host "Extract finished in $([int]((Get-Date) - $started).TotalSeconds)s ($Tool)"
    } finally {
        $Process.Dispose()
    }
}

function Start-CefCmdProcess {
    param([Parameter(Mandatory = $true)][string]$CommandLine)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    # /S 去掉包裹引号后执行整行。不要用 Start-Process -ArgumentList：它会把内层引号逃成 \"，
    # cmd 随即报 The filename, directory name, or volume label syntax is incorrect。
    $psi.Arguments = '/S /C "' + $CommandLine + '"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $false
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    if (-not $p.Start()) {
        throw 'failed to start cmd.exe for CEF extract'
    }
    return $p
}

function Get-CefExtractInner {
    param([Parameter(Mandatory = $true)][string]$ExtractDir)
    return Get-ChildItem -LiteralPath $ExtractDir -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Write-CefExtractListing {
    param([Parameter(Mandatory = $true)][string]$ExtractDir)
    $entries = @(Get-ChildItem -LiteralPath $ExtractDir -Force -ErrorAction SilentlyContinue)
    if ($entries.Count -eq 0) {
        Write-Host '  (extract dir empty)'
        return
    }
    foreach ($e in $entries) {
        $kind = if ($e.PSIsContainer) { '[dir]' } else { '[file]' }
        Write-Host ("  {0} {1}" -f $kind, $e.Name)
    }
}

function Invoke-CefSevenZipExtract {
    param(
        [Parameter(Mandatory = $true)][string]$SevenZip,
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$ExtractDir
    )
    # 写成 .cmd 再交给 cmd.exe：避免 Start-Process 转义引号，也避免把 -so 写到 -- 后面
    # （-- 之后的参数会被当成文件名，338MB 包会在 0 秒内“解压成功”且目录是空的）
    $batchPath = Join-Path $TempDir 'extract-cef.cmd'
    $batch = @"
@echo off
"$SevenZip" x -y -so "$ArchivePath" | "$SevenZip" x -y -aoa -si -ttar -o"$ExtractDir"
exit /b %ERRORLEVEL%
"@
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($batchPath, $batch, $utf8NoBom)
    $quotedBatch = '"{0}"' -f $batchPath.Replace('"', '""')
    $p = Start-CefCmdProcess -CommandLine $quotedBatch
    Wait-CefExtractProcess -Process $p -Tool '7-Zip'
}

function Invoke-CefWindowsTarExtract {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$ExtractDir
    )
    $tar = (Get-Command tar.exe -ErrorAction Stop).Source
    $mode = if ($ArchivePath -match '\.tar\.xz$') { '-xJf' } else { '-xjf' }
    $sizeMb = [math]::Round((Get-Item -LiteralPath $ArchivePath).Length / 1MB, 1)
    Write-Host "Extracting ${sizeMb} MB with tar.exe ($mode)."
    $p = Start-Process -FilePath $tar -ArgumentList @($mode, $ArchivePath, '-C', $ExtractDir) -NoNewWindow -PassThru
    Wait-CefExtractProcess -Process $p -Tool 'tar.exe'
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
        Invoke-CefSevenZipExtract -SevenZip $sevenZip -ArchivePath $ArchivePath -ExtractDir $ExtractDir
        if (Get-CefExtractInner -ExtractDir $ExtractDir) {
            return
        }
        Write-Warning '7-Zip finished but extract dir has no inner folder; listing:'
        Write-CefExtractListing -ExtractDir $ExtractDir
        if (Test-Path -LiteralPath $ExtractDir) {
            Remove-Item -LiteralPath $ExtractDir -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
    }

    Invoke-CefWindowsTarExtract -ArchivePath $ArchivePath -ExtractDir $ExtractDir
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

$Inner = Get-CefExtractInner -ExtractDir $ExtractDir
if (-not $Inner) {
    Write-Host "Extract dir listing for $ExtractDir"
    Write-CefExtractListing -ExtractDir $ExtractDir
    throw "CEF archive extracted but no inner directory found in $ExtractDir"
}
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
Move-Item -LiteralPath $Inner.FullName -Destination $Dest
Write-Host "CEF installed to $Dest" -ForegroundColor Green
