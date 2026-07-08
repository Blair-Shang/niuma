#Requires -Version 5.1
<#
.SYNOPSIS
  从官方 index.json 下载 CEF Standard Binary Distribution 到 third_party/cef/
#>
$ErrorActionPreference = 'Stop'
param(
    [string]$Channel = 'stable',
    [string]$CefPlatform = ''
)

$allowedPlatforms = @('windows64', 'windows32', 'windowsarm64')
if (-not $CefPlatform) {
    $CefPlatform = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'windowsarm64' } else { 'windows64' }
} elseif ($allowedPlatforms -notcontains $CefPlatform) {
    throw "Unsupported CefPlatform: $CefPlatform (allowed: $($allowedPlatforms -join ', '))"
}

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$Dest = Join-Path $Root 'third_party/cef'
$TempDir = Join-Path $Root 'third_party/.cache'

if (Test-Path $Dest) {
    Write-Host "CEF already exists at $Dest — delete to re-download" -ForegroundColor Yellow
    exit 0
}

Write-Host "Fetching CEF build index..."
$index = Invoke-RestMethod -Uri 'https://cef-builds.spotifycdn.com/index.json'
$platform = $index.PSObject.Properties[$CefPlatform].Value
if (-not $platform) {
    throw "Platform not found in index: $CefPlatform"
}

$version = $platform.versions |
    Where-Object { $_.channel -eq $Channel } |
    Sort-Object { [version]$_.chromium_version } |
    Select-Object -Last 1
if (-not $version) {
    throw "No CEF version for channel=$Channel platform=$CefPlatform"
}

$file = $version.files | Where-Object { $_.type -eq 'standard' } | Select-Object -First 1
if (-not $file) {
    throw "No standard distribution for $($version.cef_version)"
}

$CefVersion = $version.cef_version
$ArchiveName = $file.name
$Url = "https://cef-builds.spotifycdn.com/$ArchiveName"

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$ArchivePath = Join-Path $TempDir $ArchiveName

Write-Host "CEF $($CefVersion)"
Write-Host "Downloading $Url ..."
Invoke-WebRequest -Uri $Url -OutFile $ArchivePath -UseBasicParsing

Write-Host 'Extracting (tar)...'
$ExtractDir = Join-Path $TempDir 'cef_extract'
if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null

if ($ArchiveName -match '\.tar\.xz$') {
    tar -xJf $ArchivePath -C $ExtractDir
} else {
    tar -xjf $ArchivePath -C $ExtractDir
}

$Inner = Get-ChildItem $ExtractDir -Directory | Select-Object -First 1
Move-Item -Force $Inner.FullName $Dest
Write-Host "CEF installed to $Dest" -ForegroundColor Green
