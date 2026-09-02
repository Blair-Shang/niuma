#Requires -Version 5.1
<#
.SYNOPSIS
  将商用合规文件（CEF 许可、第三方声明、版本清单）复制到发布目录。
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$DestDir,

    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

if (-not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
}

$licensesDir = Join-Path $DestDir 'licenses'
New-Item -ItemType Directory -Force -Path $licensesDir | Out-Null

$cefLicense = Join-Path $RepoRoot 'third_party/cef/LICENSE.txt'
if (Test-Path $cefLicense) {
    Copy-Item -Force $cefLicense (Join-Path $licensesDir 'CEF-LICENSE.txt')
}

$cefReadme = Join-Path $RepoRoot 'third_party/cef/README.txt'
if (Test-Path $cefReadme) {
    Copy-Item -Force $cefReadme (Join-Path $licensesDir 'CEF-README.txt')
}

foreach ($pair in @(
        @{ Src = 'LICENSE'; Dest = 'LICENSE' }
        @{ Src = 'NOTICE'; Dest = 'NOTICE' }
    )) {
    $src = Join-Path $RepoRoot $pair.Src
    if (Test-Path $src) {
        Copy-Item -Force $src (Join-Path $licensesDir $pair.Dest)
    }
}

$notices = Join-Path $RepoRoot 'docs/compliance/NOTICES.txt'
if (Test-Path $notices) {
    Copy-Item -Force $notices (Join-Path $licensesDir 'NOTICES.txt')
}

foreach ($eulaName in @(
        'DISCLAIMER.zh-CN.txt'
        'DISCLAIMER.en-US.txt'
        'EULA.zh-CN.txt'
        'EULA.en-US.txt'
    )) {
    $eulaSrc = Join-Path $RepoRoot "docs/legal/$eulaName"
    if (Test-Path $eulaSrc) {
        Copy-Item -Force $eulaSrc (Join-Path $licensesDir $eulaName)
    }
}

$versionManifest = Join-Path $RepoRoot 'build/version.json'
if (Test-Path $versionManifest) {
    Copy-Item -Force $versionManifest (Join-Path $DestDir 'version.json')
}

Write-Host "==> compliance files staged -> $licensesDir" -ForegroundColor Cyan
